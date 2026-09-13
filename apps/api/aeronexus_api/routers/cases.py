"""Validation endpoints (Plan §17): the hand-crafted case suite and the benchmark ladder.

GET  /cases                list the case definitions (no engine run)
POST /cases/run            run all (or selected) cases against the *current* configuration
GET  /cases/latest         last case-suite result held in memory (per API process)
GET  /benchmark/latest     the committed ladder result (data/benchmarks/latest.json)
POST /benchmark/run        a small ladder run on the current configuration (capped so it finishes in a request)
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aeronexus_core.benchmark import BENCH_DIR, run_benchmark
from aeronexus_core.cases import CASES_DIR, CaseResult, load_case, run_case
from aeronexus_core.config.registry import config_hash

from .. import storage
from .engine import surrogate

router = APIRouter(tags=["validation"])

_LATEST_CASES: dict[str, Any] | None = None


def _case_files() -> list[Path]:
    return sorted(CASES_DIR.glob("case_*.yaml"))


def _expected_summary(exp: dict[str, Any]) -> list[str]:
    def act(a: dict[str, Any]) -> str:
        p = a.get("params") or {}
        extra = f" {p['delay_min']}m" if "delay_min" in p else f" -> {p['swap_tail']}" if "swap_tail" in p else ""
        return f"{a['type']}({'+'.join(a.get('target_flights', []))}{extra})"

    out: list[str] = []
    if "top1" in exp:
        t = exp["top1"]
        items = [t] if isinstance(t, dict) else t or []
        out.append("top-1: " + (" + ".join(act(a) for a in items) or "do nothing"))
    for m in exp.get("must_include") or []:
        out.append("includes " + act(m))
    if exp.get("must_not_cancel"):
        out.append("keeps " + ", ".join(exp["must_not_cancel"]))
    for m in exp.get("must_exclude") or []:
        out.append(f"excludes {act(m)}" + (f" by {m['constraint']}" if m.get("constraint") else ""))
    for m in exp.get("plan_metrics") or []:
        out.append(f"{m['metric']} {m.get('op', '<=')} {m['value']}")
    return out


@router.get("/cases")
def list_cases() -> list[dict]:
    rows = []
    for p in _case_files():
        c = load_case(p)
        rows.append({
            "id": c["id"], "title": c.get("title", c["id"]), "rationale": c.get("rationale", ""),
            "base": (c.get("instance") or {}).get("base", "tiny"), "disruptions": c.get("disruptions") or [],
            "decision_time": int(c.get("decision_time", 0)), "expected": _expected_summary(c.get("expected") or {}),
        })
    return rows


def _serialise(r: CaseResult) -> dict[str, Any]:
    d = {k: v for k, v in asdict(r).items() if k != "run"}
    run = r.run
    top = run.plans[0] if run and run.plans else None
    d["top_reasons"] = top.explanation.get("reasons", [])[:4] if top else []
    d["plans"] = [{"rank": p.rank, "actions": p.explanation["actions"], "nis": p.nis} for p in (run.plans if run else [])][:5]
    d["excluded"] = [{"key": a.key(), "reasons": a.feasibility.reasons} for a in (run.excluded if run else [])][:12]
    d["plans_evaluated"] = run.plans_evaluated if run else 0
    return d


class CasesRunRequest(BaseModel):
    ids: list[str] = Field(default_factory=list, description="subset of case ids; empty = all")
    use_surrogate: bool = False


@router.post("/cases/run")
def run_cases(req: CasesRunRequest) -> dict:
    global _LATEST_CASES
    cfg, row = storage.get_config()
    files = _case_files()
    if req.ids:
        files = [p for p in files if load_case(p)["id"] in set(req.ids)]
        if not files:
            raise HTTPException(status_code=404, detail="no matching cases")
    t0 = time.perf_counter()
    results = [_serialise(run_case(load_case(p), cfg, surrogate() if req.use_surrogate else None)) for p in files]
    out = {
        "config_hash": row.hash, "config_version": row.version, "use_surrogate": req.use_surrogate,
        "passed": sum(1 for r in results if r["passed"]), "total": len(results),
        "elapsed_ms": round((time.perf_counter() - t0) * 1000), "results": results,
    }
    if not req.ids:
        _LATEST_CASES = out
    return out


@router.get("/cases/latest")
def latest_cases() -> dict:
    if _LATEST_CASES is None:
        raise HTTPException(status_code=404, detail="no case run yet")
    return _LATEST_CASES


@router.get("/benchmark/latest")
def latest_benchmark() -> dict:
    p = BENCH_DIR / "latest.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="no benchmark result committed yet")
    d = json.loads(p.read_text(encoding="utf-8"))
    cfg, _ = storage.get_config()
    d["current_config_hash"] = config_hash(cfg)
    d["stale"] = d.get("config_hash") != d["current_config_hash"]
    return d


class BenchmarkRunRequest(BaseModel):
    scenarios: int = Field(default=4, ge=1, le=10)
    s_eval: int = Field(default=20, ge=5, le=40)
    seed: int = 2026
    use_surrogate: bool = True
    save: bool = False


@router.post("/benchmark/run")
def run_bench(req: BenchmarkRunRequest) -> dict:
    """Small ladder run so the current configuration can be checked from the UI; the full 30-scenario run
    stays a CLI job (python -m aeronexus_core.benchmark)."""
    cfg, _ = storage.get_config()
    res = run_benchmark(cfg, scenarios=req.scenarios, seed=req.seed, s_eval=req.s_eval,
                        surrogate=surrogate() if req.use_surrogate else None, verbose=False)
    if req.save:
        BENCH_DIR.mkdir(parents=True, exist_ok=True)
        (BENCH_DIR / "latest.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    res["current_config_hash"] = res["config_hash"]
    res["stale"] = False
    return res
