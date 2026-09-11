"""At-risk detection and candidate action generation (Plan §9).

At-risk flights come from the *baseline* simulation of the current state (do nothing): anything that
is forced-cancelled, delayed beyond the threshold, or explicitly targeted by a disruption. Candidate
actions per at-risk flight: CANCEL_LEG, CANCEL_CYCLE (through the next hub arrival on the effective
rotation), DELAY steps, and SWAP with any compatible aircraft that the baseline puts at the origin.
"""
from __future__ import annotations

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


def cycle_from(state: State, fid: str) -> list[str]:
    """Legs from ``fid`` up to and including the next arrival at a hub on the effective rotation."""
    inst = state.instance
    f = inst.flight(fid)
    tail = state.decisions.tail_override.get(fid, f.tail)
    if tail is None:
        return [fid]
    legs = effective_rotations(state).get(tail, [])
    ids: list[str] = []
    started = False
    for leg in legs:
        if leg.id == fid:
            started = True
        if started:
            ids.append(leg.id)
            if leg.dest in inst.hubs:
                break
    return ids or [fid]


def _tail_position_at(baseline: SimResult, state: State, tail: str, t: int) -> str | None:
    """Where the baseline simulation puts ``tail`` at time t (last operated arrival before t)."""
    inst = state.instance
    loc = inst.aircraft_by_tail[tail].location
    busy_until = 0
    for leg in effective_rotations(state).get(tail, []):
        o = baseline.legs[leg.id]
        if not o.operated or o.arr is None or o.dep is None:
            continue
        if o.arr <= t:
            loc = leg.dest
            busy_until = o.arr
        elif o.dep <= t < o.arr:
            return None  # airborne
        else:
            break
    _ = busy_until
    return loc


def generate_candidates(state: State, at_risk: list[AtRisk], baseline: SimResult, config: EngineConfig) -> list[Action]:
    inst = state.instance
    s = config.search
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
        cyc = cycle_from(state, f.id)
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
            if _tail_position_at(baseline, state, ac.tail, f.std) != f.origin:
                continue
            add(Action(type="SWAP", target_flights=[f.id], params={"swap_tail": ac.tail}))
    return out
