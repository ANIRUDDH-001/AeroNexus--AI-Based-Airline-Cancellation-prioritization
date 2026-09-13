"""Precompute the demo fallback bundle (Plan §20 "static-runs", §22 P7).

Produces data/static-runs/ - a set of plain JSON files the web UI can serve when the API is asleep or
unreachable on pitch day: the demo day, its baseline timeline and a full recommendation at several
decision times, the case-suite result, the benchmark ladder and the configuration snapshot.

    python scripts/precompute_demo.py                       # default demo day (medium, fog at DEL + AOG)
    python scripts/precompute_demo.py --instance data/instances/demo-medium.json --times 360 420 480 540

vite.config.ts serves the folder at /static-runs/ in dev and copies it into dist/ on build.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for p in ("packages/core", "packages/datagen", "packages/ml", "apps/api"):
    sys.path.insert(0, str(REPO / p))

from aeronexus_api.routers.cases import _expected_summary, _serialise  # noqa: E402
from aeronexus_api.routers.edit import build_table  # noqa: E402
from aeronexus_api.routers.engine import build_timeline  # noqa: E402
from aeronexus_core import ENGINE_VERSION  # noqa: E402
from aeronexus_core.cases import CASES_DIR, load_case, run_all  # noqa: E402
from aeronexus_core.config import load_config  # noqa: E402
from aeronexus_core.config.registry import config_hash  # noqa: E402
from aeronexus_core.model import Instance  # noqa: E402
from aeronexus_core.search import recommend  # noqa: E402

OUT = REPO / "data" / "static-runs"
INSTANCE_ID = "static-demo"


def demo_instance(path: str | None) -> Instance:
    if path:
        return Instance.model_validate_json(Path(path).read_text(encoding="utf-8"))
    from aeronexus_datagen import generate_size
    from aeronexus_datagen.disruptions import aog, inject, lvp

    inst = generate_size("medium", seed=1)
    tail = inst.aircraft[3].tail
    return inject(inst, lvp("DEL", 300, 240, 0.5), aog(tail, 520))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="precompute_demo")
    ap.add_argument("--instance", default=None, help="instance JSON to use (default: generate the demo day)")
    ap.add_argument("--times", type=int, nargs="*", default=[300, 360, 420, 480, 540, 600])
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--no-surrogate", action="store_true")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # arrows in action labels on a cp1252 console

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cfg = load_config(REPO / "configs")
    chash = config_hash(cfg)
    sur = None
    if not args.no_surrogate:
        try:
            from aeronexus_ml import load_default

            sur = load_default()
            if sur is not None:
                sur.warm()
        except ImportError:
            sur = None

    inst = demo_instance(args.instance)
    print(f"instance {inst.name}: {len(inst.flights)} flights, {len(inst.disruptions)} disruption(s); config {chash}")
    (out / "instance.json").write_text(inst.model_dump_json(), encoding="utf-8")
    for entity in ("flights", "aircraft", "crews", "airports", "itineraries"):
        (out / f"table_{entity}.json").write_text(json.dumps(build_table(inst, entity)), encoding="utf-8")

    runs = []
    for t in args.times:
        tl = build_timeline(inst, cfg, t, INSTANCE_ID)
        (out / f"timeline_{t}.json").write_text(json.dumps(tl), encoding="utf-8")
        run = recommend(inst, cfg, clock=t, seed=1, surrogate=sur)
        (out / f"run_{t}.json").write_text(run.model_dump_json(), encoding="utf-8")
        top = run.plans[0] if run.plans else None
        runs.append({
            "id": run.id, "created_at": run.created_at, "instance_id": INSTANCE_ID, "decision_time": t,
            "config_hash": run.config_hash, "engine_version": run.engine_version, "accepted_plan": None,
            "override_reason": None, "latency_ms": run.latency_ms,
            "top_plan": top.explanation["actions"] if top else [], "top_nis": top.nis if top else None,
            "at_risk": len(run.at_risk), "plans_evaluated": run.plans_evaluated,
        })
        print(f"  t={t:4d}  at-risk {len(run.at_risk):3d}  forced {tl['summary']['forced_cancellations']:2d} -> "
              f"{(top.metrics.get('forced_downstream_cancellations') if top else 0):g}  "
              f"top-1 {' + '.join(top.explanation['actions']) if top and top.actions else 'do nothing'}  ({run.latency_ms:.0f} ms)")

    # configuration snapshot in the API envelope shape
    (out / "config.json").write_text(json.dumps({
        "version": 1, "hash": chash, "updated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "config": cfg.model_dump(mode="json")}), encoding="utf-8")

    # case suite (heuristic pre-rank, the committed reference) + case definitions
    defs = []
    for p in sorted(CASES_DIR.glob("case_*.yaml")):
        c = load_case(p)
        defs.append({"id": c["id"], "title": c.get("title", c["id"]), "rationale": c.get("rationale", ""),
                     "base": (c.get("instance") or {}).get("base", "tiny"), "disruptions": c.get("disruptions") or [],
                     "decision_time": int(c.get("decision_time", 0)), "expected": _expected_summary(c.get("expected") or {})})
    (out / "case_defs.json").write_text(json.dumps(defs), encoding="utf-8")
    results = [_serialise(r) for r in run_all(cfg)]
    (out / "cases.json").write_text(json.dumps({
        "config_hash": chash, "config_version": 1, "use_surrogate": False,
        "passed": sum(1 for r in results if r["passed"]), "total": len(results),
        "elapsed_ms": round(sum(r["latency_ms"] for r in results)), "results": results}), encoding="utf-8")
    print(f"  cases {sum(1 for r in results if r['passed'])}/{len(results)} passed")

    bench = REPO / "data" / "benchmarks" / "latest.json"
    if bench.exists():
        b = json.loads(bench.read_text(encoding="utf-8"))
        b["current_config_hash"] = chash
        b["stale"] = b.get("config_hash") != chash
        (out / "benchmark.json").write_text(json.dumps(b), encoding="utf-8")

    index = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"), "engine_version": ENGINE_VERSION,
        "config_hash": chash, "decision_times": list(args.times),
        "instance": {"id": INSTANCE_ID, "name": inst.name, "size": inst.size, "seed": inst.seed,
                     "created_at": datetime.now(UTC).isoformat(timespec="seconds"), "summary": inst.summary()},
        "runs": sorted(runs, key=lambda r: r["decision_time"]),
        "files": sorted(p.name for p in out.glob("*.json") if p.name != "index.json"),
    }
    (out / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in out.glob("*.json")) / 1e6
    print(f"wrote {len(index['files']) + 1} files ({size:.1f} MB) to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
