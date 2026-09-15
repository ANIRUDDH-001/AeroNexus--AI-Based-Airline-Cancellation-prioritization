"""Verify the precomputed demo bundle against the engine (spec §10.3).

The competition demo runs on data/static-runs when the hosted engine is asleep, so the bundle must say exactly
what the engine would say. This replays the bundle's day through the engine in audit mode (deterministic, same
seed) and compares what is deterministic by construction:

* the baseline timeline at each bundled decision time (statuses, delays, tails, at-risk flags, summary),
* the plans' actions, ranking, explanation reasons and forced-cancellation lists, the excluded actions,
* the configuration hash and the instance content hash.

Metrics and scores are compared strictly when both runs used the same number of sampled futures; otherwise
the difference is reported as a warning with the two sample counts (a latency budget cut samples somewhere).

    python scripts/check_static_parity.py                       # in-process, all bundled decision times
    python scripts/check_static_parity.py --times 300           # one decision time
    python scripts/check_static_parity.py --engine http://127.0.0.1:8000 [--key K]   # against a running API
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
for p in ("packages/core", "packages/datagen", "packages/ml", "apps/api"):
    sys.path.insert(0, str(REPO / p))

BUNDLE = REPO / "data" / "static-runs"


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def ok(self) -> bool:
        return not self.errors


def _load(name: str) -> Any:
    return json.loads((BUNDLE / name).read_text(encoding="utf-8"))


def _action_key(a: dict) -> tuple:
    params = a.get("params") or {}
    return (a["type"], tuple(sorted(a.get("target_flights") or [])),
            tuple(sorted((k, json.dumps(v, sort_keys=True)) for k, v in params.items())))


def compare_timeline(t: int, bundle: dict, live: dict, rep: Report) -> None:
    keys = ("status", "delay_min", "tail", "at_risk", "dep", "arr", "reason")
    b = {f["id"]: f for f in bundle["flights"]}
    lv = {f["id"]: f for f in live["flights"]}
    if set(b) != set(lv):
        rep.errors.append(f"t={t}: timeline flight sets differ ({len(b)} vs {len(lv)})")
        return
    for fid, bf in b.items():
        for k in keys:
            if bf.get(k) != lv[fid].get(k):
                rep.errors.append(f"t={t}: flight {fid} {k}: bundle {bf.get(k)!r} vs engine {lv[fid].get(k)!r}")
    if bundle["summary"] != live["summary"]:
        rep.errors.append(f"t={t}: timeline summary differs: {bundle['summary']} vs {live['summary']}")
    bf_forced = sorted(r["flight"] for r in bundle["at_risk"] if r["forced"])
    lv_forced = sorted(r["flight"] for r in live["at_risk"] if r["forced"])
    if bf_forced != lv_forced:
        rep.errors.append(f"t={t}: forced set differs: {bf_forced} vs {lv_forced}")


def compare_run(t: int, bundle: dict, live: dict, rep: Report) -> None:
    if bundle.get("config_hash") != live.get("config_hash"):
        rep.errors.append(f"t={t}: config hash {bundle.get('config_hash')} vs {live.get('config_hash')}")
    if bundle.get("instance_hash") != live.get("instance_hash"):
        rep.errors.append(f"t={t}: instance hash {bundle.get('instance_hash')} vs {live.get('instance_hash')}")
    bp = [[_action_key(a) for a in p["actions"]] for p in bundle["plans"]]
    lp = [[_action_key(a) for a in p["actions"]] for p in live["plans"]]
    if bp != lp:
        rep.errors.append(f"t={t}: plans (actions and ranking) differ:\n  bundle {bp}\n  engine {lp}")
        return
    sb = (bundle.get("effective") or {}).get("samples")
    sl = (live.get("effective") or {}).get("samples")
    for i, (pb, pl) in enumerate(zip(bundle["plans"], live["plans"], strict=True), start=1):
        eb, el = pb["explanation"], pl["explanation"]
        if eb.get("reasons") != el.get("reasons"):
            rep.errors.append(f"t={t} plan {i}: reasons differ:\n  bundle {eb.get('reasons')}\n  engine {el.get('reasons')}")
        if eb.get("forced_cancellations") != el.get("forced_cancellations"):
            rep.errors.append(f"t={t} plan {i}: forced cancellations differ")
        if sb == sl:
            if abs(pb["nis"] - pl["nis"]) > 1e-6 or pb["metrics"] != pl["metrics"]:
                rep.errors.append(f"t={t} plan {i}: metrics differ with equal samples ({sb}): nis {pb['nis']} vs {pl['nis']}")
        elif abs(pb["nis"] - pl["nis"]) > 1e-6:
            rep.warnings.append(f"t={t} plan {i}: nis {pb['nis']} vs {pl['nis']} with {sb} vs {sl} sampled futures (budget cut)")
    if [_action_key(a) for a in bundle.get("excluded", [])] != [_action_key(a) for a in live.get("excluded", [])]:
        rep.errors.append(f"t={t}: excluded actions differ")


def check_in_process(times: list[int]) -> Report:
    from aeronexus_api.routers.engine import build_timeline
    from aeronexus_core.config import load_config
    from aeronexus_core.config.registry import config_hash
    from aeronexus_core.model import Instance
    from aeronexus_core.search import recommend

    rep = Report()
    idx = _load("index.json")
    cfg = load_config(REPO / "configs")
    cfg = cfg.model_copy(update={"search": cfg.search.model_copy(update={"deterministic": True})})
    if config_hash(cfg) != idx["config_hash"]:
        rep.errors.append(f"bundle built with configuration {idx['config_hash']}, repo configs/ give "
                          f"{config_hash(cfg)}: regenerate the bundle")
        return rep
    inst = Instance.model_validate_json((BUNDLE / "instance.json").read_text(encoding="utf-8"))
    sur = None
    first = _load(f"run_{times[0]}.json")
    if (first.get("effective") or {}).get("surrogate"):
        from aeronexus_ml import load_default

        sur = load_default()
    for t in times:
        compare_timeline(t, _load(f"timeline_{t}.json"), build_timeline(inst, cfg, t, "static-demo"), rep)
        live = json.loads(recommend(inst, cfg, clock=t, seed=idx.get("seed", 1), surrogate=sur).model_dump_json())
        compare_run(t, _load(f"run_{t}.json"), live, rep)
    return rep


def check_engine(url: str, key: str | None, times: list[int]) -> Report:
    import urllib.request

    def call(method: str, path: str, body: dict | None = None) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}
        if key:
            headers["X-AeroNexus-Key"] = key
        req = urllib.request.Request(url.rstrip("/") + path, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())

    rep = Report()
    idx = _load("index.json")
    health = call("GET", "/health")
    if health["config_hash"] != idx["config_hash"]:
        rep.errors.append(f"engine configuration {health['config_hash']} differs from the bundle ({idx['config_hash']})")
        return rep
    iid = call("POST", "/data/import", json.loads((BUNDLE / "instance.json").read_text(encoding="utf-8")))["id"]
    try:
        for t in times:
            compare_timeline(t, _load(f"timeline_{t}.json"), call("GET", f"/timeline?instance_id={iid}&t={t}"), rep)
            live = call("POST", "/recommend", {"instance_id": iid, "decision_time": t, "seed": idx.get("seed", 1)})
            compare_run(t, _load(f"run_{t}.json"), live, rep)
    finally:
        call("DELETE", f"/data/instances/{iid}")
    return rep


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="check_static_parity")
    ap.add_argument("--engine", default=None, help="API base URL; default replays the engine in this process")
    ap.add_argument("--key", default=None, help="write key for --engine (import/delete need it when the API requires one)")
    ap.add_argument("--times", type=int, nargs="*", default=None)
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    times = args.times or _load("index.json")["decision_times"]
    rep = check_engine(args.engine, args.key, times) if args.engine else check_in_process(times)
    for w in rep.warnings:
        print(f"warning: {w}")
    for e in rep.errors:
        print(f"error: {e}")
    status = "OK" if rep.ok() else "FAILED"
    print(f"parity {status}: {len(times)} decision time(s), {len(rep.errors)} error(s), {len(rep.warnings)} warning(s)")
    return 0 if rep.ok() else 1


if __name__ == "__main__":
    raise SystemExit(main())
