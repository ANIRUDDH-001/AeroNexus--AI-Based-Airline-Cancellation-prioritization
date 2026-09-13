"""Feature extraction for the surrogate (Plan §13).

One row per (state, candidate action). Features describe the targeted flight, its position in the
rotation, the crew, the local resource situation at the origin, the active disruptions and the action
itself. The target is the *change in NIS* the simulator reports for that action versus doing nothing.

A ``FeatureContext`` is built once per (state, baseline) and reused for every candidate, so scoring a few
hundred candidates costs milliseconds, not seconds.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field

from aeronexus_core.model import Action, Flight, State
from aeronexus_core.simulator.engine import SimResult

FEATURE_NAMES: list[str] = [
    # action
    "act_cancel_leg", "act_cancel_cycle", "act_delay", "act_swap", "delay_min", "cycle_len", "swap_same_type",
    # flight
    "booked_pax", "pax_connecting", "pax_special", "pax_high_value", "pax_partner", "block_min", "std_hour",
    "origin_is_hub", "dest_is_hub", "load_factor",
    # baseline situation of the flight
    "base_forced", "base_delay_min", "base_standby_called", "minutes_to_departure",
    # rotation / crew
    "legs_after_on_tail", "pax_after_on_tail", "legs_before_on_tail", "crew_sectors_after", "crew_fdp_margin_min",
    # local resources
    "spare_tails_at_origin", "standby_crews_at_origin", "same_od_alternatives_later", "spare_seats_same_od_later",
    # disruption context
    "origin_capacity_cut", "dest_capacity_cut", "origin_lvp", "dest_lvp", "tail_aog", "n_at_risk_total",
]


def _in_window(t: int, start: int, end: int | None) -> bool:
    return start <= t < (end if end is not None else 48 * 60)


@dataclass
class FeatureContext:
    state: State
    baseline: SimResult
    n_at_risk: int
    rot: dict[str, list[Flight]] = field(default_factory=dict)          # effective tail -> legs
    pos: dict[str, tuple[list[int], list[str], list[tuple[int, int]]]] = field(default_factory=dict)  # tail -> (arr times, dest after, airborne windows)
    od: dict[tuple[str, str], list[Flight]] = field(default_factory=dict)
    standby: dict[tuple[str, str], int] = field(default_factory=dict)  # (station, type) -> count
    crew_seq: dict[str, list[Flight]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        inst = self.state.instance
        dec = self.state.decisions
        for g in inst.flights:
            tail = dec.tail_override.get(g.id, g.tail)
            if tail:
                self.rot.setdefault(tail, []).append(g)
            if self.baseline.legs[g.id].operated:
                self.od.setdefault((g.origin, g.dest), []).append(g)
        for legs in self.rot.values():
            legs.sort(key=lambda x: x.std)
        for tail, legs in self.rot.items():
            arrs: list[int] = []
            dests: list[str] = []
            air: list[tuple[int, int]] = []
            for g in legs:
                o = self.baseline.legs[g.id]
                if o.operated and o.dep is not None and o.arr is not None:
                    arrs.append(o.arr)
                    dests.append(g.dest)
                    air.append((o.dep, o.arr))
            self.pos[tail] = (arrs, dests, air)
        for c in inst.crews:
            if c.is_standby:
                for t in c.type_ratings:
                    self.standby[(c.location, t)] = self.standby.get((c.location, t), 0) + 1
            elif c.pairing:
                self.crew_seq[c.id] = [inst.flight(x) for x in c.pairing if x in inst.flights_by_id]

    def tail_location(self, tail: str, t: int) -> str | None:
        inst = self.state.instance
        loc = inst.aircraft_by_tail[tail].location
        arrs, dests, air = self.pos.get(tail, ([], [], []))
        for dep, arr in air:
            if dep <= t < arr:
                return None
        i = bisect_right(arrs, t)
        return dests[i - 1] if i else loc

    def spare_tails(self, f: Flight, tail: str | None) -> int:
        inst = self.state.instance
        n = 0
        for ac in inst.aircraft:
            if ac.tail == tail or ac.status == "AOG":
                continue
            if self.tail_location(ac.tail, f.std) == f.origin:
                n += 1
        return n


def build_context(state: State, baseline: SimResult, n_at_risk: int) -> FeatureContext:
    return FeatureContext(state, baseline, n_at_risk)


def features_for(state: State, action: Action, baseline: SimResult, n_at_risk: int,
                 ctx: FeatureContext | None = None) -> list[float]:
    ctx = ctx or build_context(state, baseline, n_at_risk)
    inst = state.instance
    f = inst.flight(action.target_flights[0])
    tail = state.decisions.tail_override.get(f.id, f.tail)
    o = baseline.legs[f.id]
    hubs = inst.hubs
    rot = ctx.rot.get(tail or "", [])
    idx = next((i for i, g in enumerate(rot) if g.id == f.id), 0)
    after = rot[idx + 1:]
    crew_after = 0
    fdp_margin = 0.0
    crew = inst.crews_by_id.get(f.crew_id or "")
    if crew and crew.id in ctx.crew_seq:
        seq = ctx.crew_seq[crew.id]
        j = next((i for i, g in enumerate(seq) if g.id == f.id), len(seq))
        crew_after = max(0, len(seq) - j - 1)
        if crew.duty_start is not None and seq:
            fdp_margin = float(crew.fdp_limit_min - (seq[-1].sta + 30 - crew.duty_start))
    later = [g for g in ctx.od.get((f.origin, f.dest), []) if g.id != f.id and g.std >= f.std]
    cap_o = cap_d = lvp_o = lvp_d = aog = 0
    for d in inst.disruptions:
        if d.type in ("AIRPORT_CAPACITY", "ATC_FLOW", "CLOSURE", "LVP"):
            if d.target == f.origin and _in_window(f.std, d.start, d.end_nominal):
                cap_o = 1
                lvp_o |= int(d.type == "LVP")
            if d.target == f.dest and _in_window(f.sta, d.start, d.end_nominal):
                cap_d = 1
                lvp_d |= int(d.type == "LVP")
        if d.type == "AOG" and d.target == tail:
            aog = 1
    swap_tail = inst.aircraft_by_tail.get(str(action.params.get("swap_tail"))) if action.type == "SWAP" else None
    return [
        float(action.type == "CANCEL_LEG"), float(action.type == "CANCEL_CYCLE"), float(action.type == "DELAY"),
        float(action.type == "SWAP"), float(action.params.get("delay_min", 0)), float(len(action.target_flights)),
        float(swap_tail is not None and swap_tail.type_code == f.aircraft_type),
        float(f.booked_pax), float(f.pax_connecting), float(f.pax_special_assistance), float(f.pax_high_value), float(f.pax_partner),
        float(f.block_min), float((f.std % 1440) // 60), float(f.origin in hubs), float(f.dest in hubs), f.booked_pax / max(1, f.seats),
        float(o.status == "CANCELLED_FORCED"), float(o.delay_min), float(o.standby_called), float(f.std - state.clock),
        float(len(after)), float(sum(g.booked_pax for g in after)), float(idx), float(crew_after), fdp_margin,
        float(ctx.spare_tails(f, tail)), float(ctx.standby.get((f.origin, f.aircraft_type), 0)),
        float(len(later)), float(sum(g.seats - g.booked_pax for g in later)),
        float(cap_o), float(cap_d), float(lvp_o), float(lvp_d), float(aog), float(n_at_risk),
    ]
