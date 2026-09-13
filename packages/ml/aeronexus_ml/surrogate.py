"""Surrogate model (Plan §13): predicts ΔNIS of a candidate action from features, without simulating.

Used only to *order* candidates before the simulator judges them (pre-ranking, `search.M`) and to
explain "what drives this score" via SHAP. It never makes the final decision (principle P1, D9).

    python -m aeronexus_ml.surrogate build   --scenarios 60 --out packages/ml/models/surrogate.joblib
    python -m aeronexus_ml.surrogate evaluate --model packages/ml/models/surrogate.joblib --scenarios 12
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from aeronexus_core.config import EngineConfig, load_config
from aeronexus_core.constraints import build_constraints, check_all
from aeronexus_core.model import Action, State
from aeronexus_core.scoring import compute_nis
from aeronexus_core.search.candidates import detect_at_risk, generate_candidates
from aeronexus_core.simulator import Simulator
from aeronexus_datagen import generate_size
from aeronexus_datagen.disruptions import airport_capacity_cut, aog, atc_flow, crew_unavailable, inject, lvp

from .features import FEATURE_NAMES, build_context, features_for

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "surrogate.joblib"


# ---------------------------------------------------------------- data generation


def random_disruptions(inst, rng: np.random.Generator) -> list:
    hubs = [a.code for a in inst.airports if a.is_hub]
    kinds = rng.choice(["fog", "capacity", "aog", "crew", "atc", "mixed"])
    out = []
    hub = str(rng.choice(hubs))
    start = int(rng.integers(280, 700))
    if kinds in ("fog", "mixed"):
        out.append(lvp(hub, start, int(rng.integers(120, 360)), float(rng.uniform(0.3, 0.6))))
    if kinds in ("capacity",):
        out.append(airport_capacity_cut(hub, start, int(rng.integers(90, 300)), float(rng.uniform(0.2, 0.6))))
    if kinds in ("aog", "mixed"):
        tail = inst.aircraft[int(rng.integers(0, len(inst.aircraft)))].tail
        out.append(aog(tail, int(rng.integers(360, 900))))
    if kinds in ("crew",):
        out.append(crew_unavailable(hub, int(rng.integers(2, 6)), int(rng.integers(300, 600))))
    if kinds in ("atc",):
        out.append(atc_flow(hub, start, int(rng.integers(60, 240)), int(rng.integers(6, 14))))
    return out


@dataclass
class Dataset:
    X: list[list[float]] = field(default_factory=list)
    y: list[float] = field(default_factory=list)
    groups: list[int] = field(default_factory=list)  # node id, for rank-correlation evaluation

    def arrays(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return np.array(self.X, dtype=float), np.array(self.y, dtype=float), np.array(self.groups)


def build_dataset(config: EngineConfig, scenarios: int = 40, seed: int = 0, sizes=("small", "medium"),
                  max_candidates: int = 60, verbose: bool = True) -> Dataset:
    rng = np.random.default_rng(seed)
    ds = Dataset()
    static_rules = build_constraints(config, phase="static")
    group = 0
    t0 = time.perf_counter()
    for k in range(scenarios):
        size = str(rng.choice(list(sizes)))
        inst = generate_size(size, seed=int(rng.integers(1, 10_000)))
        inst = inject(inst, *random_disruptions(inst, rng))
        clock = int(rng.integers(240, 600))
        sim = Simulator(inst, config)
        state = State(clock=clock, instance=inst)
        base = sim.run(state.decisions, clock=clock)
        base_nis = compute_nis(base.metrics, config, []).total
        risk = detect_at_risk(state, base, config)
        if not risk:
            continue
        cands = generate_candidates(state, risk, base, config, limit=max_candidates)
        ctx = build_context(state, base, len(risk))
        n = 0
        for a in cands:
            if check_all(static_rules, state, a):
                continue
            st2 = state.apply(a)
            res = sim.run(st2.decisions, clock=clock)
            nis = compute_nis(res.metrics, config, []).total
            ds.X.append(features_for(state, a, base, len(risk), ctx))
            ds.y.append(nis - base_nis)
            ds.groups.append(group)
            n += 1
        group += 1
        if verbose:
            print(f"  scenario {k + 1}/{scenarios} ({size}, {len(inst.disruptions)} disruptions): {n} samples, "
                  f"{time.perf_counter() - t0:.1f}s total", flush=True)
    return ds


# ---------------------------------------------------------------- model


class Surrogate:
    def __init__(self, model: Any, feature_names: list[str], meta: dict[str, Any] | None = None):
        self.model = model
        self.feature_names = feature_names
        self.meta = meta or {}
        self._explainer: Any = None

    def predict(self, X: list[list[float]] | np.ndarray) -> np.ndarray:
        return np.asarray(self.model.predict(np.asarray(X, dtype=float)))

    def score_actions(self, state: State, actions: list[Action], baseline, n_at_risk: int) -> list[float]:
        if not actions:
            return []
        ctx = build_context(state, baseline, n_at_risk)
        X = [features_for(state, a, baseline, n_at_risk, ctx) for a in actions]
        return [float(v) for v in self.predict(X)]

    def drivers(self, state: State, action: Action, baseline, n_at_risk: int, top: int = 5) -> list[dict[str, float | str]]:
        """SHAP contributions for one action (positive = pushes predicted impact up = worse)."""
        try:
            import shap  # noqa
        except ImportError:  # pragma: no cover
            return []
        x = np.array([features_for(state, action, baseline, n_at_risk)], dtype=float)
        if self._explainer is None:
            self._explainer = shap.TreeExplainer(self.model)
        vals = np.asarray(self._explainer.shap_values(x))[0]
        order = np.argsort(-np.abs(vals))[:top]
        return [{"feature": self.feature_names[i], "value": float(x[0, i]), "contribution": float(vals[i])} for i in order]

    def warm(self) -> None:
        """Pay the one-time SHAP import/explainer cost up front (API startup) instead of on the first run."""
        try:
            import shap

            if self._explainer is None:
                self._explainer = shap.TreeExplainer(self.model)
            self.predict([[0.0] * len(self.feature_names)])
        except ImportError:  # pragma: no cover
            pass

    def save(self, path: Path | str) -> None:
        import joblib

        Path(path).parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"model": self.model, "feature_names": self.feature_names, "meta": self.meta}, path)

    @classmethod
    def load(cls, path: Path | str) -> Surrogate:
        import joblib

        d = joblib.load(path)
        return cls(d["model"], d["feature_names"], d.get("meta"))


def train(ds: Dataset, seed: int = 0) -> Surrogate:
    X, y, _ = ds.arrays()
    try:
        import lightgbm as lgb

        model = lgb.LGBMRegressor(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=10,
                                  subsample=0.9, colsample_bytree=0.9, random_state=seed, verbose=-1)
    except ImportError:  # pragma: no cover
        from sklearn.ensemble import HistGradientBoostingRegressor

        model = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, random_state=seed)
    model.fit(X, y)
    return Surrogate(model, list(FEATURE_NAMES), {"n_samples": int(len(y)), "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S")})


def evaluate(model: Surrogate, ds: Dataset) -> dict[str, float]:
    """Held-out quality: RMSE on ΔNIS and, more importantly, mean per-node Spearman rank correlation
    between predicted and simulated ΔNIS (how well the surrogate *orders* candidates), plus top-1 hit rate."""
    from scipy.stats import spearmanr

    X, y, g = ds.arrays()
    pred = model.predict(X)
    rmse = float(np.sqrt(np.mean((pred - y) ** 2)))
    rhos, hits, n = [], 0, 0
    for gid in np.unique(g):
        m = g == gid
        if m.sum() < 3:
            continue
        r = spearmanr(pred[m], y[m]).correlation
        if not np.isnan(r):
            rhos.append(float(r))
        hits += int(np.argmin(pred[m]) == np.argmin(y[m]))
        n += 1
    return {"rmse": rmse, "spearman_mean": float(np.mean(rhos)) if rhos else float("nan"),
            "top1_hit_rate": hits / max(1, n), "nodes": n, "samples": int(len(y))}


def load_default() -> Surrogate | None:
    p = Path(__import__("os").environ.get("AERONEXUS_SURROGATE_PATH", str(DEFAULT_MODEL_PATH)))
    if not p.exists():
        return None
    try:
        return Surrogate.load(p)
    except Exception:  # noqa: BLE001 - a broken model must never break recommendations
        return None


# ---------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="aeronexus_ml.surrogate")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--scenarios", type=int, default=60)
    b.add_argument("--seed", type=int, default=0)
    b.add_argument("--config", default="configs")
    b.add_argument("--out", default=str(DEFAULT_MODEL_PATH))
    e = sub.add_parser("evaluate")
    e.add_argument("--model", default=str(DEFAULT_MODEL_PATH))
    e.add_argument("--scenarios", type=int, default=12)
    e.add_argument("--seed", type=int, default=999)
    e.add_argument("--config", default="configs")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    if args.cmd == "build":
        print(f"building dataset from {args.scenarios} scenarios …")
        ds = build_dataset(cfg, scenarios=args.scenarios, seed=args.seed)
        print(f"{len(ds.y)} samples; training …")
        model = train(ds, seed=args.seed)
        model.meta["train_metrics"] = evaluate(model, ds)
        held = build_dataset(cfg, scenarios=max(8, args.scenarios // 5), seed=args.seed + 100_000, verbose=False)
        model.meta["heldout_metrics"] = evaluate(model, held)
        model.save(args.out)
        print(json.dumps(model.meta, indent=2))
        print(f"saved {args.out}")
        return 0
    model = Surrogate.load(args.model)
    ds = build_dataset(cfg, scenarios=args.scenarios, seed=args.seed, verbose=False)
    print(json.dumps(evaluate(model, ds), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
