"""At-risk detection and candidate action generation (Plan §9).

At-risk flights come from the *baseline* simulation of the current state (do nothing): anything that
is forced-cancelled, delayed beyond the threshold, or explicitly targeted by a disruption. Candidate
actions per at-risk flight: CANCEL_LEG, CANCEL_CYCLE (through the next hub arrival on the effective
rotation), DELAY steps, and SWAP with any compatible aircraft that the baseline puts at the origin.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ..config.registry import EngineConfig
from ..model import Action, Flight, State
from ..simulator.engine import SimResult


@dataclass
class AtRisk:
    flight_id: str
    reasons: list[str] = field(default_factory=list)
    delay_min: int = 0
    forced: bool = False


def effective_rotations(state: State) -> dict[str, list[Flight]]:
    inst = state.instance
    rot: dict[str, list[Flight]] = {}
    for f in inst.flights:
        tail = state.decisions.tail_override.get(f.id, f.tail)
        if tail:
            rot.setdefault(tail, []).append(f)
    for legs in rot.values():
        legs.sort(key=lambda x: (x.std, x.id))
    return rot


def detect_at_risk(state: State, baseline: SimResult, config: EngineConfig) -> list[AtRisk]:
    inst = state.instance
    thr = config.search.at_risk_delay_threshold_min
    cancelled = set(state.decisions.cancelled)
    targeted = {d.target for d in inst.disruptions if d.type == "FLIGHT_DELAY"}
    out: list[AtRisk] = []
    for f in inst.flights:
        if f.id in cancelled or f.std < state.clock:
            continue  # already decided or already departed
        o = baseline.legs[f.id]
        r = AtRisk(flight_id=f.id, delay_min=o.delay_min)
        if o.status == "CANCELLED_FORCED":
            r.forced = True
            r.reasons.append(f"cannot operate: {o.reason}")
        elif o.delay_min >= thr:
            r.reasons.append(f"expected delay {o.delay_min} min")
        if f.id in targeted:
            r.reasons.append("disruption reported on this flight")
        if o.operated and o.standby_called:
            r.reasons.append("needs a standby crew")
        if r.reasons:
            out.append(r)
    out.sort(key=lambda r: (not r.forced, -r.delay_min, r.flight_id))
    return out


def cycle_from(state: State, fid: str, rot: dict[str, list[Flight]] | None = None, max_legs: int = 4) -> list[str]:
    """The out-and-back cycle starting at ``fid``: legs until the aircraft is back at ``fid``'s origin
    (bounded by ``max_legs``). If it never returns within the bound, stop at the next hub arrival."""
    inst = state.instance
    f = inst.flight(fid)
    tail = state.decisions.tail_override.get(fid, f.tail)
    if tail is None:
        return [fid]
    legs = (rot if rot is not None else effective_rotations(state)).get(tail, [])
    ids: list[str] = []
    started = False
    fallback: list[str] | None = None
    for leg in legs:
        if leg.id == fid:
            started = True
        if not started:
            continue
        ids.append(leg.id)
        if leg.dest == f.origin:
            return ids
        if fallback is None and leg.dest in inst.hubs and leg.id != fid:
            fallback = list(ids)
        if len(ids) >= max_legs:
            break
    return fallback or ids or [fid]


def _tail_position_at(baseline: SimResult, state: State, tail: str, t: int, rot: dict[str, list[Flight]]) -> str | None:
    """Where the baseline simulation puts ``tail`` at time t (last operated arrival before t)."""
    inst = state.instance
    loc = inst.aircraft_by_tail[tail].location
    for leg in rot.get(tail, []):
        o = baseline.legs[leg.id]
        if not o.operated or o.arr is None or o.dep is None:
            continue
        if o.arr <= t:
            loc = leg.dest
        elif o.dep <= t < o.arr:
            return None  # airborne
        else:
            break
    return loc


_TYPE_ORDER = {"SWAP": 0, "CANCEL_CYCLE": 1, "CANCEL_LEG": 2, "DELAY": 3, "WAIT": 4}


Ranker = Callable[[State, list[Action], SimResult, int], list[float]]
"""Optional learned pre-ranker: (state, actions, baseline, n_at_risk) -> predicted delta-NIS per action (lower = better)."""


def prerank(cands: list[Action], state: State, at_risk: list[AtRisk], limit: int,
            baseline: SimResult | None = None, ranker: Ranker | None = None) -> list[Action]:
    """Ordering before simulation (Plan §11.2, M). With a learned ``ranker`` (Phase 5 surrogate) candidates are
    ordered by predicted delta-NIS; otherwise by a heuristic: forced flights first (they need a decision), swaps
    before cancellations before delays, fewer passengers before more. The simulator is the judge; this only
    decides which candidates get simulated when there are more than ``limit``."""
    forced = {r.flight_id for r in at_risk if r.forced}
    delay_of = {r.flight_id: r.delay_min for r in at_risk}
    inst = state.instance

    def key(a: Action) -> tuple:
        f = inst.flight(a.target_flights[0])
        pax = sum(inst.flight(x).booked_pax for x in a.target_flights)
        return (0 if f.id in forced else 1, _TYPE_ORDER.get(a.type, 9), -delay_of.get(f.id, 0), pax, a.key())

    if ranker is not None and baseline is not None and cands:
        try:
            scores = ranker(state, cands, baseline, len(at_risk))
            ordered = [a for _, a in sorted(zip(scores, cands, strict=True), key=lambda t: (t[0], key(t[1])))]
        except Exception:  # noqa: BLE001 - a failing model must never break the search
            ordered = sorted(cands, key=key)
    else:
        ordered = sorted(cands, key=key)
    if len(ordered) <= limit:
        return ordered
    # keep diversity: at most 3 actions per flight within the cap
    per_flight: dict[str, int] = {}
    kept: list[Action] = []
    for a in ordered:
        fid = a.target_flights[0]
        if per_flight.get(fid, 0) >= 3:
            continue
        per_flight[fid] = per_flight.get(fid, 0) + 1
        kept.append(a)
        if len(kept) >= limit:
            break
    return kept


def generate_candidates(state: State, at_risk: list[AtRisk], baseline: SimResult, config: EngineConfig,
                        limit: int | None = None, ranker: Ranker | None = None) -> list[Action]:
    inst = state.instance
    s = config.search
    rot = effective_rotations(state)
    seen: set[str] = set()
    out: list[Action] = []

    def add(a: Action) -> None:
        k = a.key()
        if k not in seen:
            seen.add(k)
            out.append(a)

    for r in at_risk:
        f = inst.flight(r.flight_id)
        add(Action(type="CANCEL_LEG", target_flights=[f.id]))
        cyc = cycle_from(state, f.id, rot)
        if len(cyc) > 1:
            add(Action(type="CANCEL_CYCLE", target_flights=cyc))
        if not r.forced:
            for d in s.delay_steps_min:
                if d <= s.max_delay_min and d > r.delay_min:
                    add(Action(type="DELAY", target_flights=[f.id], params={"delay_min": d}))
        # swaps: same type (or bigger), parked at the origin at departure time, not the current tail
        cur_tail = state.decisions.tail_override.get(f.id, f.tail)
        for ac in inst.aircraft:
            if ac.tail == cur_tail or ac.status == "AOG":
                continue
            typ = inst.aircraft_type(ac.type_code)
            if ac.type_code != f.aircraft_type and typ.seats < f.booked_pax:
                continue
            if _tail_position_at(baseline, state, ac.tail, f.std, rot) != f.origin:
                continue
            add(Action(type="SWAP", target_flights=[f.id], params={"swap_tail": ac.tail}))
    return prerank(out, state, at_risk, limit if limit is not None else s.M, baseline, ranker)
