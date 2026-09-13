"""Benchmark ladder (Plan §17.2, decision D12).

Policies:
  B0  naive              cancel the at-risk flight with the fewest passengers when something is forced
  B1  weighted heuristic static score = a*pax + b*downstream legs + c*crew risk; cancel the lowest-score cycle
  B2  AeroNexus          the full engine (heuristic pre-rank)
  B2s AeroNexus+surrogate the full engine with the learned pre-ranker (if a model is available)

Every policy's chosen plan is scored on the same *evaluation* simulator configuration: S_eval sampled
futures with a different seed AND block-time noise the search never sees, so the engine cannot grade its
own homework. Reported per policy: mean NIS, mean forced cancellations, passengers cancelled/stranded,
misconnects, win rate against B0, and engine latency.

    python -m aeronexus_core.benchmark --scenarios 30 --out data/benchmarks/latest.json
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from .config.registry import EngineConfig, config_hash, load_config
from .model import Action, Instance, State
from .scoring import compute_nis
from .search import detect_at_risk, recommend
from .search.candidates import cycle_from
from .simulator import Simulator, sample_scenarios

BENCH_DIR = Path(__file__).resolve().parents[3] / "data" / "benchmarks"


@dataclass
class PolicyOutcome:
    nis_mean: float
    nis_p90: float
    forced: float
    pax_cancelled: float
    pax_stranded: float
    misconnects: float
    delay_min: float
    latency_ms: float
    actions: list[str]


@dataclass
class ScenarioRecord:
    name: str
    size: str
    disruption: str
    clock: int
    at_risk: int
    baseline_forced: float
    policies: dict[str, PolicyOutcome] = field(default_factory=dict)


# ---------------------------------------------------------------- policies


def policy_b0(inst: Instance, config: EngineConfig, clock: int) -> list[Action]:
    st = State(clock=clock, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=clock)
    risk = detect_at_risk(st, base, config)
    if not any(r.forced for r in risk):
        return []
    f = min((inst.flight(r.flight_id) for r in risk), key=lambda x: (x.booked_pax, x.id))
    return [Action(type="CANCEL_LEG", target_flights=[f.id])]


def policy_b1(inst: Instance, config: EngineConfig, clock: int, a: float = 1.0, b: float = 60.0, c: float = 80.0) -> list[Action]:
    st = State(clock=clock, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=clock)
    risk = detect_at_risk(st, base, config)
    if not any(r.forced for r in risk):
        return []
    rot = inst.rotations()
    best = None
    for r in risk:
        f = inst.flight(r.flight_id)
        legs = rot.get(f.tail or "", [])
        i = next((k for k, g in enumerate(legs) if g.id == f.id), 0)
        downstream = max(0, len(legs) - i - 1)
        crew = inst.crews_by_id.get(f.crew_id or "")
        crew_risk = 1.0 if (crew and base.legs[f.id].standby_called) else 0.0
        score = a * (f.booked_pax + 2 * f.pax_connecting) + b * downstream + c * crew_risk
        if best is None or score < best[0]:
            best = (score, f.id)
    assert best is not None
    return [Action(type="CANCEL_CYCLE", target_flights=cycle_from(st, best[1]))]


def policy_engine(inst: Instance, config: EngineConfig, clock: int, surrogate: Any | None = None) -> tuple[list[Action], float]:
    run = recommend(inst, config, clock=clock, seed=1, surrogate=surrogate)
    return (run.plans[0].actions if run.plans else []), run.latency_ms


# ---------------------------------------------------------------- evaluation


def evaluate_plan(inst: Instance, config: EngineConfig, clock: int, actions: list[Action], samples, sim: Simulator) -> dict[str, float]:
    st = State(clock=clock, instance=inst)
    for a in actions:
        st = st.apply(a)
    nis, forced, pc, ps, mc, dl = [], [], [], [], [], []
    for smp in samples:
        r = sim.run(st.decisions, clock=clock, sample=smp)
        m = r.metrics
        nis.append(compute_nis(m, config, []).total)
        forced.append(m.forced_downstream_cancellations)
        pc.append(m.pax_cancelled)
        ps.append(m.pax_stranded_overnight)
        mc.append(m.misconnects)
        dl.append(m.total_delay_min)
    arr = np.array(nis)
    return {"nis_mean": float(arr.mean()), "nis_p90": float(np.percentile(arr, 90)), "forced": float(np.mean(forced)),
            "pax_cancelled": float(np.mean(pc)), "pax_stranded": float(np.mean(ps)), "misconnects": float(np.mean(mc)),
            "delay_min": float(np.mean(dl))}


def run_benchmark(config: EngineConfig, scenarios: int = 30, seed: int = 2026, s_eval: int = 40, block_sigma: float = 0.05,
                  surrogate: Any | None = None, verbose: bool = True) -> dict[str, Any]:
    from aeronexus_datagen import generate_size
    from aeronexus_datagen.disruptions import inject
    from aeronexus_ml.surrogate import random_disruptions  # reuse the scenario templates

    from .search.explain import describe_plan

    rng = np.random.default_rng(seed)
    records: list[ScenarioRecord] = []
    t0 = time.perf_counter()
    for k in range(scenarios):
        size = str(rng.choice(["small", "medium"]))
        inst = generate_size(size, seed=int(rng.integers(1, 10_000)))
        ds = random_disruptions(inst, rng)
        inst = inject(inst, *ds)
        clock = int(rng.integers(240, 600))
        st = State(clock=clock, instance=inst)
        search_sim = Simulator(inst, config)
        base = search_sim.run(st.decisions, clock=clock)
        risk = detect_at_risk(st, base, config)
        if not risk:
            continue
        # evaluation simulator: different seed + block-time noise the search never sees
        samples = sample_scenarios(inst, s_eval, seed=seed + 7919 * (k + 1), block_sigma=block_sigma)
        rec = ScenarioRecord(name=inst.name, size=size, disruption="+".join(d.type for d in ds), clock=clock,
                             at_risk=len(risk), baseline_forced=float(base.metrics.forced_downstream_cancellations))
        plans: dict[str, tuple[list[Action], float]] = {
            "do_nothing": ([], 0.0),
            "B0_naive": (policy_b0(inst, config, clock), 0.0),
            "B1_weighted": (policy_b1(inst, config, clock), 0.0),
            "B2_aeronexus": policy_engine(inst, config, clock),
        }
        if surrogate is not None:
            plans["B2s_surrogate"] = policy_engine(inst, config, clock, surrogate)
        for name, (acts, lat) in plans.items():
            ev = evaluate_plan(inst, config, clock, acts, samples, search_sim)
            rec.policies[name] = PolicyOutcome(latency_ms=lat, actions=describe_plan(acts, inst), **ev)
        records.append(rec)
        if verbose:
            b2 = rec.policies["B2_aeronexus"]
            print(f"  {k + 1}/{scenarios} {size:6s} {rec.disruption:24s} at-risk {len(risk):3d} | do-nothing {rec.policies['do_nothing'].nis_mean:9,.0f} "
                  f"B0 {rec.policies['B0_naive'].nis_mean:9,.0f} B1 {rec.policies['B1_weighted'].nis_mean:9,.0f} B2 {b2.nis_mean:9,.0f} "
                  f"({b2.latency_ms:.0f} ms) [{time.perf_counter() - t0:.0f}s]", flush=True)

    # ---- aggregate
    names = list(records[0].policies) if records else []
    summary: dict[str, Any] = {}
    for n in names:
        outs = [r.policies[n] for r in records]
        ref = [r.policies["B0_naive"].nis_mean for r in records]
        mine = [o.nis_mean for o in outs]
        summary[n] = {
            "nis_mean": float(np.mean(mine)), "nis_p90_mean": float(np.mean([o.nis_p90 for o in outs])),
            "forced_mean": float(np.mean([o.forced for o in outs])),
            "pax_cancelled_mean": float(np.mean([o.pax_cancelled for o in outs])),
            "pax_stranded_mean": float(np.mean([o.pax_stranded for o in outs])),
            "misconnects_mean": float(np.mean([o.misconnects for o in outs])),
            "delay_min_mean": float(np.mean([o.delay_min for o in outs])),
            "win_rate_vs_B0": float(np.mean([m < b - 1e-9 for m, b in zip(mine, ref, strict=True)])),
            "tie_rate_vs_B0": float(np.mean([abs(m - b) <= 1e-9 for m, b in zip(mine, ref, strict=True)])),
            "improvement_vs_B0_pct": float(100 * (1 - np.mean(mine) / max(np.mean(ref), 1e-9))),
            "latency_ms_mean": float(np.mean([o.latency_ms for o in outs])),
            "latency_ms_p95": float(np.percentile([o.latency_ms for o in outs], 95)),
        }
    return {
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"), "config_hash": config_hash(config),
        "scenarios": len(records), "s_eval": s_eval, "block_sigma": block_sigma, "seed": seed,
        "summary": summary, "records": [
            {**{k: v for k, v in asdict(r).items() if k != "policies"}, "policies": {n: asdict(p) for n, p in r.policies.items()}}
            for r in records],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="aeronexus_core.benchmark")
    ap.add_argument("--scenarios", type=int, default=30)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--s-eval", type=int, default=40)
    ap.add_argument("--config", default="configs")
    ap.add_argument("--out", default=str(BENCH_DIR / "latest.json"))
    ap.add_argument("--no-surrogate", action="store_true")
    args = ap.parse_args(argv)
    cfg = load_config(args.config)
    sur = None
    if not args.no_surrogate:
        try:
            from aeronexus_ml import load_default

            sur = load_default()
        except ImportError:
            sur = None
    res = run_benchmark(cfg, scenarios=args.scenarios, seed=args.seed, s_eval=args.s_eval, surrogate=sur)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(json.dumps(res["summary"], indent=2))
    print(f"saved {args.out}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
