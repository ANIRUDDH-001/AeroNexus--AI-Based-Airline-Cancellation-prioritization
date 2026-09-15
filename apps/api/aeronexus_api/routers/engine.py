"""Engine endpoints (Plan §19): recommend, what-if, timeline, runs (audit log)."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aeronexus_core.model import Action, Instance, Run, State, fmt_time
from aeronexus_core.search import detect_at_risk, recommend
from aeronexus_core.simulator import Simulator
from aeronexus_core.validate import validate_instance

from .. import settings, storage
from ..narration import narrate
from ..schemas import CommittedOut, RunRowOut, TimelineOut

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


def _check_actions(inst: Instance, actions: list[Action]) -> None:
    """Reject references the engine cannot resolve (unknown flights / tails) with a 422 instead of a 500."""
    problems = []
    for a in actions:
        if not a.target_flights:
            problems.append(f"{a.type}: no target flight")
        for fid in a.target_flights:
            if fid not in inst.flights_by_id:
                problems.append(f"{a.type}: unknown flight {fid}")
        if a.type == "SWAP" and a.params.get("swap_tail") not in inst.aircraft_by_tail:
            problems.append(f"SWAP {'+'.join(a.target_flights)}: unknown aircraft {a.params.get('swap_tail')}")
        if a.type == "DELAY" and not isinstance(a.params.get("delay_min"), int | float):
            problems.append(f"DELAY {'+'.join(a.target_flights)}: delay_min missing")
    if problems:
        raise HTTPException(status_code=422, detail={"reason": "invalid actions", "problems": problems})


def _finish(run: Run, inst: Instance, instance_id: str) -> Run:
    run.instance_hash = inst.content_hash()
    issues = validate_instance(inst)
    if issues:
        run.notes.append(f"instance has {len(issues)} validation issue(s); results may be unreliable: "
                         + "; ".join(issues[:3]))
    if settings.NARRATION_ENABLED and run.plans:
        run.narrative = narrate(run)
    storage.save_run(run, instance_id)
    return run


@router.post("/recommend", response_model=Run)
def post_recommend(req: RecommendRequest) -> Run:
    inst = storage.get_instance(req.instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    for plan in req.whatif:
        _check_actions(inst, plan)
    cfg, _ = storage.get_config()
    run = recommend(
        inst, cfg, clock=req.decision_time, seed=req.seed,
        previous_top_key=_previous_top_key(req.previous_run_id, req.instance_id, req.decision_time),
        extra_plans=req.whatif or None, surrogate=surrogate(),
    )
    return _finish(run, inst, req.instance_id)


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
    _check_actions(inst, req.actions)
    cfg, _ = storage.get_config()
    run = recommend(inst, cfg, clock=req.decision_time, seed=req.seed, extra_plans=[req.actions], surrogate=surrogate())
    run.notes.append("what-if evaluation")
    if not run.whatif:
        raise HTTPException(status_code=422, detail={"reason": "what-if plan infeasible",
                                                    "actions": [a.model_dump() for a in req.actions]})
    return _finish(run, inst, req.instance_id)


@router.get("/timeline", response_model=TimelineOut)
def timeline(instance_id: str, t: int = 0) -> dict:
    """Baseline ("do nothing") propagation at decision time t: per-flight outcomes for the rotation view."""
    inst = storage.get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    cfg, _ = storage.get_config()
    return build_timeline(inst, cfg, t, instance_id)


def committed_summary(inst: Instance) -> dict:
    """The decisions already taken today, in the shape the UI shows next to the clock."""
    from aeronexus_core.search.explain import describe_plan

    c = inst.committed
    actions = [Action(type="CANCEL_LEG", target_flights=[f]) for f in c.cancelled]
    actions += [Action(type="DELAY", target_flights=[f], params={"delay_min": m}) for f, m in c.delays.items()]
    actions += [Action(type="SWAP", target_flights=[f], params={"swap_tail": c.tail_override.get(f, "?")}) for f in c.swaps]
    return {"cancelled": list(c.cancelled), "delays": dict(c.delays), "swaps": list(c.swaps),
            "tail_override": dict(c.tail_override), "labels": describe_plan(actions, inst) if actions else [],
            "count": len(c.cancelled) + len(c.delays) + len(c.swaps)}


def build_timeline(inst, cfg, t: int, instance_id: str, actions: list[Action] | None = None) -> dict:
    """Pure builder shared by the endpoint and the static-runs precompute script. Starts from the day's
    committed decisions, so accepted plans show up as cancelled-by-plan legs and are not re-proposed.
    With ``actions`` it shows the day *after* that plan (the board's before/after view)."""
    st = State(clock=t, instance=inst, decisions=inst.committed)
    for a in actions or []:
        st = st.apply(a)
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
        "committed": committed_summary(inst),
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


class PlanTimelineRequest(BaseModel):
    instance_id: str
    decision_time: int = Field(default=0, ge=0)
    actions: list[Action]


@router.post("/timeline/plan", response_model=TimelineOut)
def plan_timeline(req: PlanTimelineRequest) -> dict:
    """Per-flight outcomes of the day once ``actions`` are applied at ``decision_time`` (the after view)."""
    inst = storage.get_instance(req.instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    _check_actions(inst, req.actions)
    cfg, _ = storage.get_config()
    return build_timeline(inst, cfg, req.decision_time, req.instance_id, req.actions)


@router.get("/runs", response_model=list[RunRowOut])
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
    got = storage.get_run(run_id)
    if got is None:
        raise HTTPException(status_code=404, detail="run not found")
    if req.accepted_plan is not None and req.accepted_plan > len(got[0].plans):
        raise HTTPException(status_code=422, detail=f"run has {len(got[0].plans)} plan(s); cannot accept #{req.accepted_plan}")
    if req.accepted_plan is None and not (req.override_reason or "").strip():
        raise HTTPException(status_code=422, detail="an override needs a reason")
    prev, iid = got
    if prev.committed_at and req.accepted_plan != prev.accepted_plan:
        raise HTTPException(status_code=409, detail=f"plan #{prev.accepted_plan} of this run is already committed to the "
                                                    "day; reset the day's committed decisions before choosing differently")
    committed_at = None
    if req.accepted_plan is not None and not prev.committed_at:
        # accepting a plan makes it part of the day: later recommendations start from it (Plan §7 / §18)
        inst = storage.get_instance(iid)
        if inst is None:
            raise HTTPException(status_code=404, detail="instance not found")
        st = State(clock=prev.decision_time, instance=inst, decisions=inst.committed)
        for a in prev.plans[req.accepted_plan - 1].actions:
            st = st.apply(a)
        storage.replace_instance(iid, inst.model_copy(update={"committed": st.decisions}))
        committed_at = datetime.now(UTC).isoformat(timespec="seconds")
    run = storage.decide_run(run_id, req.accepted_plan, req.override_reason, committed_at)
    assert run is not None
    return run


@router.get("/data/instances/{iid}/committed", response_model=CommittedOut)
def get_committed(iid: str) -> dict:
    inst = storage.get_instance(iid)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    return committed_summary(inst)


@router.post("/data/instances/{iid}/committed/reset", response_model=CommittedOut)
def reset_committed(iid: str) -> dict:
    """Clear today's committed decisions (undo all accepted plans); runs keep their record."""
    inst = storage.get_instance(iid)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    from aeronexus_core.model import Decisions

    storage.replace_instance(iid, inst.model_copy(update={"committed": Decisions()}))
    return committed_summary(storage.get_instance(iid))  # type: ignore[arg-type]
