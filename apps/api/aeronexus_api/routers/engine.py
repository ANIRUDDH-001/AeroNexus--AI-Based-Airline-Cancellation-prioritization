"""Engine endpoints (Plan §19): recommend, what-if, timeline, runs (audit log)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aeronexus_core.model import Action, Run, State, fmt_time
from aeronexus_core.search import detect_at_risk, recommend
from aeronexus_core.simulator import Simulator

from .. import settings, storage
from ..narration import narrate

try:
    from aeronexus_ml import load_default as _load_surrogate
except ImportError:  # pragma: no cover - ml package optional
    _load_surrogate = None  # type: ignore[assignment]

_SURROGATE: Any = None
_SURROGATE_LOADED = False


def surrogate() -> Any:
    """Lazily load the Phase 5 model once; None (heuristic pre-rank) if absent or broken."""
    global _SURROGATE, _SURROGATE_LOADED
    if not _SURROGATE_LOADED:
        _SURROGATE = _load_surrogate() if _load_surrogate else None
        _SURROGATE_LOADED = True
    return _SURROGATE

router = APIRouter(tags=["engine"])


class RecommendRequest(BaseModel):
    instance_id: str
    decision_time: int = Field(default=0, ge=0)
    seed: int = 0
    previous_run_id: str | None = None
    whatif: list[list[Action]] = Field(default_factory=list)


def _previous_top_key(run_id: str | None, instance_id: str, clock: int) -> str | None:
    if not run_id:
        return None
    got = storage.get_run(run_id)
    if not got:
        return None
    prev, prev_iid = got
    if prev_iid != instance_id or not prev.plans:
        return None
    inst = storage.get_instance(instance_id)
    if inst is None:
        return None
    st = State(clock=clock, instance=inst)
    for a in prev.plans[0].actions:
        st = st.apply(a)
    return st.decisions.key()


@router.post("/recommend", response_model=Run)
def post_recommend(req: RecommendRequest) -> Run:
    inst = storage.get_instance(req.instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    cfg, _ = storage.get_config()
    run = recommend(
        inst, cfg, clock=req.decision_time, seed=req.seed,
        previous_top_key=_previous_top_key(req.previous_run_id, req.instance_id, req.decision_time),
        extra_plans=req.whatif or None, surrogate=surrogate(),
    )
    if settings.NARRATION_ENABLED and run.plans:
        run.narrative = narrate(run)
    storage.save_run(run, req.instance_id)
    return run


class WhatIfRequest(BaseModel):
    instance_id: str
    decision_time: int = Field(default=0, ge=0)
    seed: int = 0
    actions: list[Action]


@router.post("/whatif", response_model=Run)
def post_whatif(req: WhatIfRequest) -> Run:
    """Evaluate a controller-chosen plan on the same engine and compare it with the recommendation."""
    inst = storage.get_instance(req.instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    cfg, _ = storage.get_config()
    run = recommend(inst, cfg, clock=req.decision_time, seed=req.seed, extra_plans=[req.actions], surrogate=surrogate())
    run.notes.append("what-if evaluation")
    if not run.whatif:
        raise HTTPException(status_code=422, detail={"reason": "what-if plan infeasible",
                                                    "actions": [a.model_dump() for a in req.actions]})
    storage.save_run(run, req.instance_id)
    return run


@router.get("/timeline")
def timeline(instance_id: str, t: int = 0) -> dict:
    """Baseline ("do nothing") propagation at decision time t: per-flight outcomes for the rotation view."""
    inst = storage.get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    cfg, _ = storage.get_config()
    return build_timeline(inst, cfg, t, instance_id)


def build_timeline(inst, cfg, t: int, instance_id: str) -> dict:
    """Pure builder shared by the endpoint and the static-runs precompute script."""
    st = State(clock=t, instance=inst)
    res = Simulator(inst, cfg).run(st.decisions, clock=t)
    risk = {r.flight_id: r for r in detect_at_risk(st, res, cfg)}
    flights = []
    for f in inst.flights:
        o = res.legs[f.id]
        flights.append({
            "id": f.id, "number": f.number, "origin": f.origin, "dest": f.dest, "std": f.std, "sta": f.sta,
            "std_hhmm": fmt_time(f.std), "sta_hhmm": fmt_time(f.sta), "tail": o.tail or f.tail, "crew_id": o.crew_id,
            "aircraft_type": f.aircraft_type, "booked_pax": f.booked_pax, "pax_connecting": f.pax_connecting,
            "status": o.status, "dep": o.dep, "arr": o.arr, "delay_min": o.delay_min, "reason": o.reason,
            "standby_called": o.standby_called, "at_risk": f.id in risk,
            "risk_reasons": risk[f.id].reasons if f.id in risk else [],
            "protected": f.protected,
        })
    rotations = {t_: [f.id for f in legs] for t_, legs in inst.rotations().items()}
    m = res.metrics
    return {
        "instance_id": instance_id, "clock": t, "clock_hhmm": fmt_time(t),
        "flights": flights, "rotations": rotations,
        "disruptions": [d.model_dump() for d in inst.disruptions],
        "at_risk": [{"flight": r.flight_id, "reasons": r.reasons, "delay_min": r.delay_min, "forced": r.forced}
                    for r in risk.values()],
        "summary": {
            "flights": len(inst.flights), "at_risk": len(risk),
            "forced_cancellations": int(m.forced_downstream_cancellations),
            "delayed_flights": sum(1 for o in res.legs.values() if o.operated and o.delay_min > 0),
            "total_delay_min": int(m.total_delay_min), "misconnects": int(m.misconnects),
            "stranded_overnight": int(m.pax_stranded_overnight), "standby_used": int(m.crew_standby_used),
            "aircraft_available": sum(1 for a in inst.aircraft if a.status == "OK"),
            "standby_crews": sum(1 for c in inst.crews if c.is_standby),
        },
    }


@router.get("/runs")
def list_runs(instance_id: str | None = None, limit: int = 50) -> list[dict]:
    return storage.list_runs(instance_id, limit)


@router.get("/runs/{run_id}", response_model=Run)
def get_run(run_id: str) -> Run:
    got = storage.get_run(run_id)
    if not got:
        raise HTTPException(status_code=404, detail="run not found")
    return got[0]


class DecisionRequest(BaseModel):
    accepted_plan: int | None = Field(default=None, ge=1)
    override_reason: str | None = None


@router.post("/runs/{run_id}/decision", response_model=Run)
def decide(run_id: str, req: DecisionRequest) -> Run:
    run = storage.decide_run(run_id, req.accepted_plan, req.override_reason)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run
