"""Digital-twin simulator (Plan §7).

A discrete-event propagation over one operational day. Legs are processed in order of their earliest
possible departure; each leg waits for its aircraft (previous leg + turnaround), its crew (location,
FDP, rest, qualification), airport capacity (hourly slots after disruption curves), curfews and
closures. Anything that cannot operate becomes a *forced cancellation with a reason* - this is how a
cascade shows up, and it is exactly the "downstream cancellations triggered" KPI.

Inputs are immutable: the ``Instance``, a ``Decisions`` overlay (what the plan has chosen so far), the
active disruptions (optionally with sampled end times) and the decision clock. Output is a ``SimResult``
with per-leg outcomes, passenger outcomes and the ``Metrics`` namespace consumed by the scorer.
"""
from __future__ import annotations

import heapq
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from ..config.registry import EngineConfig
from ..fdtl import DEFAULT_FDP_TABLE, fdp_limit, normalise_table
from ..model import Aircraft, Crew, Decisions, Disruption, Flight, Instance, Itinerary, TimeWindow
from ..scoring.metrics import Metrics

LegStatus = Literal["OPERATED", "CANCELLED_DECISION", "CANCELLED_FORCED", "PAST"]


@dataclass
class LegOutcome:
    flight_id: str
    status: LegStatus
    dep: int | None = None
    arr: int | None = None
    delay_min: int = 0
    reason: str | None = None
    tail: str | None = None
    crew_id: str | None = None
    standby_called: bool = False

    @property
    def operated(self) -> bool:
        return self.status in ("OPERATED", "PAST")


@dataclass
class ItineraryOutcome:
    itinerary_id: str
    pax: int
    status: Literal["ok", "cancelled", "misconnect"]
    reprotected_on: list[str] = field(default_factory=list)
    reprotected_pax: int = 0
    stranded_pax: int = 0
    delay_min: int = 0  # arrival delay at final destination for the re-protected passengers


@dataclass
class ScenarioSample:
    """One sampled future: disruption end times and optional block-time noise (Plan §12)."""

    disruption_end: dict[str, int] = field(default_factory=dict)
    block_factor: dict[str, float] = field(default_factory=dict)
    label: str = "nominal"


@dataclass
class SimResult:
    legs: dict[str, LegOutcome]
    itineraries: list[ItineraryOutcome]
    metrics: Metrics
    tail_end_location: dict[str, str]
    crew_end_location: dict[str, str]
    standby_used: list[str]

    def cancelled_ids(self) -> list[str]:
        return [k for k, v in self.legs.items() if not v.operated]

    def forced_ids(self) -> list[str]:
        return [k for k, v in self.legs.items() if v.status == "CANCELLED_FORCED"]


# ---------------------------------------------------------------- internal state


@dataclass
class _AircraftState:
    tail: str
    location: str | None
    ready_at: int = 0
    aog: list[tuple[int, int | None]] = field(default_factory=list)


@dataclass
class _CrewState:
    crew: Crew
    location: str
    duty_start: int | None
    sectors: int = 0
    ready_at: int = 0
    used: bool = False        # standby: has been called out
    unavailable: bool = False  # CREW_UNAVAILABLE disruption
    flight_time: int = 0


def _in(t: int, windows: list[TimeWindow]) -> TimeWindow | None:
    for w in windows:
        if w.start <= t < w.end:
            return w
    return None


class Simulator:
    def __init__(self, instance: Instance, config: EngineConfig):
        self.inst = instance
        self.cfg = config
        s = config.search
        self.forced_cancel_delay = s.forced_cancel_delay_min
        self.standby_hold = s.standby_hold_min
        self.post_flight = s.post_flight_duty_min
        params = config.parameter_values()
        self.reprotect_window = int(params.get("reprotection_window_min", 720))
        self.overnight_cutoff = int(params.get("overnight_cutoff_min", 1440))
        self.comp = (
            float(params.get("compensation_block_le_1h_inr", 5000)),
            float(params.get("compensation_block_1_2h_inr", 7500)),
            float(params.get("compensation_block_gt_2h_inr", 10000)),
        )
        # FDTL parameters from the H3a/H3b/H3c constraint configs (editable in the UI)
        self.fdp_table = DEFAULT_FDP_TABLE
        self.report_before = 60
        self.callout_lead = 90
        for c in config.constraints:
            if c.plugin == "crew_fdtl" and c.enabled:
                self.fdp_table = c.config.get("fdp_table", self.fdp_table)
                self.report_before = int(c.config.get("report_before_std_min", 60))
            if c.plugin == "crew_location" and c.enabled:
                self.callout_lead = int(c.config.get("standby_callout_lead_min", 90))
        self.fdp_table = normalise_table(self.fdp_table)  # normalised once; fdp_limit accepts this form
        self.lvp_required = ["CAT3"]
        for c in config.constraints:
            if c.plugin == "crew_qualification" and c.enabled:
                self.lvp_required = list(c.config.get("lvp_requires", ["CAT3"]))
        self._hub = {a.code: a.is_hub for a in instance.airports}
        self._mct = {a.code: a.min_connection_time_min for a in instance.airports}
        self._airports = instance.airports_by_code
        self._types = instance.types_by_code
        self._flights = instance.flights_by_id
        self._planned_tail_end = {t: legs[-1].dest for t, legs in instance.rotations().items()}
        self._planned_crew_end = {c.id: (instance.flight(c.pairing[-1]).dest if c.pairing else c.location) for c in instance.crews}
        self._itins: dict[str, Itinerary] = {i.id: i for i in instance.itineraries}

    # ------------------------------------------------------------ disruption effects

    def _effects(self, disruptions: list[Disruption], sample: ScenarioSample | None):
        cap: dict[str, dict[int, int]] = {}  # airport -> hour -> capacity (dep+arr share one cap for simplicity)
        lvp: dict[str, list[TimeWindow]] = defaultdict(list)
        closure: dict[str, list[TimeWindow]] = defaultdict(list)
        aog: dict[str, list[tuple[int, int | None]]] = defaultdict(list)
        source_delay: dict[str, int] = {}
        crew_unavail_req: list[tuple[str, int, int]] = []  # (base, n, at)
        for a in self.inst.airports:
            lvp[a.code].extend(a.lvp_windows)
            closure[a.code].extend(a.closure_windows)
        for d in disruptions:
            end = d.end_nominal
            if sample and d.id in sample.disruption_end:
                end = sample.disruption_end[d.id]
            if d.type in ("AIRPORT_CAPACITY", "LVP", "ATC_FLOW", "CLOSURE"):
                ap = self._airports.get(d.target)
                if ap is None:
                    continue
                base = ap.slot_capacity_per_hour.dep
                e = end if end is not None else 48 * 60
                if d.type == "CLOSURE":
                    closure[d.target].append(TimeWindow(start=d.start, end=e))
                    factor_cap = 0
                elif d.type == "ATC_FLOW":
                    factor_cap = int(d.severity.get("rate_per_hour", base))
                else:
                    factor_cap = int(round(base * float(d.severity.get("capacity_fraction", 0.5))))
                if d.type == "LVP":
                    lvp[d.target].append(TimeWindow(start=d.start, end=e))
                hours = cap.setdefault(d.target, {})
                for h in range(d.start // 60, (e + 59) // 60):
                    hours[h] = min(hours.get(h, base), factor_cap)
            elif d.type == "AOG":
                aog[d.target].append((d.start, end))
            elif d.type == "FLIGHT_DELAY":
                source_delay[d.target] = max(source_delay.get(d.target, 0), int(d.severity.get("delay_min", 0)))
            elif d.type == "CREW_UNAVAILABLE":
                crew_unavail_req.append((d.target, int(d.severity.get("n_crews", 1)), d.start))
        return cap, lvp, closure, aog, source_delay, crew_unavail_req

    # ------------------------------------------------------------ main run

    def run(self, decisions: Decisions, clock: int = 0, sample: ScenarioSample | None = None,
            disruptions: list[Disruption] | None = None) -> SimResult:
        inst = self.inst
        disruptions = inst.disruptions if disruptions is None else disruptions
        cap, lvp, closure, aog, source_delay, crew_unavail_req = self._effects(disruptions, sample)
        cancelled = set(decisions.cancelled)

        # effective tails / crews
        eff_tail = {f.id: decisions.tail_override.get(f.id, f.tail) for f in inst.flights}
        eff_crew = {f.id: decisions.crew_override.get(f.id, f.crew_id) for f in inst.flights}
        by_tail: dict[str, list[Flight]] = defaultdict(list)
        by_crew: dict[str, list[Flight]] = defaultdict(list)
        for f in inst.flights:
            if eff_tail[f.id]:
                by_tail[eff_tail[f.id]].append(f)
            if eff_crew[f.id]:
                by_crew[eff_crew[f.id]].append(f)
        for legs in by_tail.values():
            legs.sort(key=lambda x: (x.std, x.id))
        for legs in by_crew.values():
            legs.sort(key=lambda x: (x.std, x.id))
        tail_prev: dict[str, str | None] = {}
        tail_next: dict[str, str | None] = {}
        crew_prev: dict[str, str | None] = {}
        crew_next: dict[str, str | None] = {}
        for legs in by_tail.values():
            for i, f in enumerate(legs):
                tail_prev[f.id] = legs[i - 1].id if i else None
                tail_next[f.id] = legs[i + 1].id if i + 1 < len(legs) else None
        for legs in by_crew.values():
            for i, f in enumerate(legs):
                crew_prev[f.id] = legs[i - 1].id if i else None
                crew_next[f.id] = legs[i + 1].id if i + 1 < len(legs) else None

        # resource states
        ac_state: dict[str, _AircraftState] = {}
        for a in inst.aircraft:
            ac_state[a.tail] = _AircraftState(tail=a.tail, location=a.location, aog=list(aog.get(a.tail, [])))
            if a.status == "AOG" and not ac_state[a.tail].aog:
                ac_state[a.tail].aog.append((0, None))
        crew_state: dict[str, _CrewState] = {}
        for c in inst.crews:
            crew_state[c.id] = _CrewState(crew=c, location=c.location, duty_start=c.duty_start, ready_at=c.rest_until)
        # CREW_UNAVAILABLE: the first n rostered crews at that base reporting after `at`
        for base, n, at in crew_unavail_req:
            cands = sorted((c for c in inst.crews if c.base == base and not c.is_standby and c.duty_start is not None
                            and c.duty_start >= at), key=lambda c: (c.duty_start or 0, c.id))
            for c in cands[:n]:
                crew_state[c.id].unavailable = True
        standby_pool: dict[str, list[_CrewState]] = defaultdict(list)
        for c in inst.crews:
            if c.is_standby:
                standby_pool[c.location].append(crew_state[c.id])
        for pool in standby_pool.values():
            pool.sort(key=lambda s: (s.crew.callout_min, s.crew.id))

        usage: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        def capacity(ap: str, hour: int) -> int:
            over = cap.get(ap)
            if over and hour in over:
                return over[hour]
            return self._airports[ap].slot_capacity_per_hour.dep

        def slot(ap: str, t: int) -> int:
            """Earliest time >= t with a free movement slot at airport ap (also honours closures)."""
            w = _in(t, closure.get(ap, []))
            if w:
                t = w.end
            h = t // 60
            guard = 0
            while usage[ap][h] >= capacity(ap, h) and guard < 48:
                h += 1
                guard += 1
                t = h * 60
                w = _in(t, closure.get(ap, []))
                if w:
                    t = w.end
                    h = t // 60
            usage[ap][h] += 1
            return t

        outcomes: dict[str, LegOutcome] = {}
        standby_used: list[str] = []
        processed: set[str] = set()

        def ready(fid: str) -> bool:
            tp, cp = tail_prev.get(fid), crew_prev.get(fid)
            return (tp is None or tp in processed) and (cp is None or cp in processed)

        heap: list[tuple[int, int, str]] = []
        for f in inst.flights:
            if ready(f.id):
                heapq.heappush(heap, (f.std + source_delay.get(f.id, 0) + decisions.delays.get(f.id, 0), f.std, f.id))
        pushed = {fid for _, _, fid in heap}

        def push_successors(fid: str) -> None:
            for nxt in (tail_next.get(fid), crew_next.get(fid)):
                if nxt and nxt not in pushed and ready(nxt):
                    g = self._flights[nxt]
                    heapq.heappush(heap, (g.std + source_delay.get(nxt, 0) + decisions.delays.get(nxt, 0), g.std, nxt))
                    pushed.add(nxt)

        def crew_limit(cs: _CrewState, remaining_sectors: int) -> int:
            if cs.duty_start is None:
                return 10**9
            return fdp_limit(cs.duty_start, cs.sectors + remaining_sectors, self.fdp_table)

        def remaining_sectors_for(fid: str, crew_id: str) -> int:
            n = 0
            cur: str | None = fid
            while cur is not None:
                if eff_crew.get(cur) == crew_id and cur not in cancelled:
                    n += 1
                cur = crew_next.get(cur)
            return max(1, n)

        def find_standby(f: Flight, dep: int, need_cat3: bool) -> _CrewState | None:
            for s in standby_pool.get(f.origin, []):
                if s.used or s.unavailable:
                    continue
                if f.aircraft_type not in s.crew.type_ratings:
                    continue
                if need_cat3 and not set(self.lvp_required).issubset(s.crew.special_quals):
                    continue
                ready_at = max(clock, dep - self.callout_lead) + s.crew.callout_min
                if ready_at > dep + self.standby_hold:
                    continue
                return s
            return None

        while heap:
            _, _, fid = heapq.heappop(heap)
            if fid in processed:
                continue
            f = self._flights[fid]
            tail = eff_tail[fid]
            crew_id = eff_crew[fid]

            def finish(o: LegOutcome, _fid: str = fid) -> None:
                outcomes[_fid] = o
                processed.add(_fid)
                push_successors(_fid)

            if fid in cancelled:
                finish(LegOutcome(fid, "CANCELLED_DECISION", tail=tail, crew_id=crew_id, reason="cancelled by plan"))
                continue
            if tail is None or tail not in ac_state:
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id, reason="no aircraft assigned"))
                continue
            ac = ac_state[tail]
            typ = self._types[f.aircraft_type]

            # --- aircraft
            if ac.location != f.origin:
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                  reason=f"aircraft {tail} is at {ac.location or 'unknown'}, not {f.origin} (upstream cancellation)"))
                continue
            earliest = f.std + source_delay.get(fid, 0) + decisions.delays.get(fid, 0)
            earliest = max(earliest, ac.ready_at)
            for start, end in ac.aog:
                if start <= earliest and (end is None or earliest < end):
                    if end is None or end - f.std > self.forced_cancel_delay:
                        earliest = -1
                        break
                    earliest = max(earliest, end)
            if earliest < 0:
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id, reason=f"aircraft {tail} is AOG"))
                continue
            # LVP: if the aircraft or the rostered crew cannot fly CAT-III, wait for the procedures to end
            # when that is within the delay cap (what an OCC does), otherwise it is a forced cancellation.
            acft: Aircraft = inst.aircraft_by_tail[tail]
            ac_cat3 = typ.cat3_capable and "NO_CAT3" not in acft.mel_restrictions
            cs0 = crew_state.get(crew_id) if crew_id else None
            crew_cat3 = cs0 is not None and set(self.lvp_required).issubset(cs0.crew.special_quals)

            def lvp_window_at(t: int, _f: Flight = f) -> TimeWindow | None:
                return _in(t, lvp.get(_f.origin, [])) or _in(t + _f.block_min, lvp.get(_f.dest, []))

            lw = lvp_window_at(earliest)
            if lw is not None and not (ac_cat3 and crew_cat3):
                # wait for the later of the origin/destination windows to clear
                wait_until = max((w.end for w in [_in(earliest, lvp.get(f.origin, [])),
                                                  _in(earliest + f.block_min, lvp.get(f.dest, []))] if w), default=earliest)
                if not ac_cat3 and wait_until - f.std > self.forced_cancel_delay:
                    finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                      reason=f"aircraft {tail} cannot operate under low-visibility procedures at {f.origin if _in(earliest, lvp.get(f.origin, [])) else f.dest}"))
                    continue
                if not ac_cat3 or (not crew_cat3 and find_standby(f, earliest, True) is None):
                    if wait_until - f.std <= self.forced_cancel_delay:
                        earliest = max(earliest, wait_until)
            need_cat3 = lvp_window_at(earliest) is not None

            block = f.block_min
            if sample and fid in sample.block_factor:
                block = int(round(block * sample.block_factor[fid]))
            # --- ground hold: if the arrival would fall inside a closure or curfew at the destination, wait on
            # the ground at the origin (ATC ground-delay behaviour) rather than holding in the air
            dest_ap = self._airports[f.dest]
            why = "capacity/closure"
            for _ in range(3):
                w = _in(earliest + block, closure.get(f.dest, []))
                if w is None:
                    w = _in(earliest + block, dest_ap.curfew_windows)
                    if w is not None:
                        why = f"{f.dest} curfew"
                if not w:
                    break
                earliest = max(earliest, w.end - block)
            # --- departure slot (capacity, closure) and curfew at origin
            dep = slot(f.origin, earliest)
            w = _in(dep, self._airports[f.origin].curfew_windows)
            if w:
                dep = slot(f.origin, w.end)
                why = f"{f.origin} curfew"
            if dep - f.std > self.forced_cancel_delay:
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                  reason=f"could not depart {f.origin} within {self.forced_cancel_delay} min ({why})"))
                continue
            arr = slot(f.dest, dep + block)  # arrival capacity: short airborne holding / flow management
            if _in(arr, dest_ap.curfew_windows):
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                  reason=f"would arrive {f.dest} inside curfew"))
                continue

            # --- crew
            cs = crew_state.get(crew_id) if crew_id else None
            standby_called = False
            crew_reason = None
            if cs is None:
                crew_reason = "no crew assigned"
            elif cs.unavailable:
                crew_reason = f"crew {cs.crew.id} unavailable"
            elif cs.location != f.origin:
                crew_reason = f"crew {cs.crew.id} is at {cs.location}, not {f.origin}"
            elif f.aircraft_type not in cs.crew.type_ratings:
                crew_reason = f"crew {cs.crew.id} not rated on {f.aircraft_type}"
            elif need_cat3 and not set(self.lvp_required).issubset(cs.crew.special_quals):
                crew_reason = f"crew {cs.crew.id} lacks CAT-III qualification for low-visibility operations"
            else:
                dep_c = max(dep, cs.ready_at)
                if dep_c > dep:
                    dep = slot(f.origin, dep_c)
                    arr = slot(f.dest, dep + block)
                rem = remaining_sectors_for(fid, crew_id)  # type: ignore[arg-type]
                limit = crew_limit(cs, rem)
                if cs.duty_start is not None and arr + self.post_flight - cs.duty_start > limit:
                    crew_reason = (f"crew {cs.crew.id} would exceed FDP by "
                                   f"{arr + self.post_flight - cs.duty_start - limit} min")
            if crew_reason is not None:
                sb = find_standby(f, dep, need_cat3)
                if sb is None:
                    finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                      reason=f"{crew_reason}; no standby available at {f.origin}"))
                    continue
                sb.used = True
                sb.duty_start = max(clock, dep - self.callout_lead)
                sb_ready = sb.duty_start + sb.crew.callout_min
                if sb_ready > dep:
                    dep = slot(f.origin, sb_ready)
                    arr = slot(f.dest, dep + block)
                standby_called = True
                standby_used.append(sb.crew.id)
                # the standby takes over the rest of this crew's sequence
                cur: str | None = fid
                while cur is not None:
                    if eff_crew.get(cur) == crew_id:
                        eff_crew[cur] = sb.crew.id
                    cur = crew_next.get(cur)
                by_crew.setdefault(sb.crew.id, [])
                cs = sb
                crew_id = sb.crew.id
            if dep - f.std > self.forced_cancel_delay:
                finish(LegOutcome(fid, "CANCELLED_FORCED", tail=tail, crew_id=crew_id,
                                  reason=f"could not depart within {self.forced_cancel_delay} min"))
                continue

            # --- operate
            assert cs is not None
            delay = dep - f.std
            status: LegStatus = "PAST" if f.std < clock and delay <= source_delay.get(fid, 0) else "OPERATED"
            finish(LegOutcome(fid, status, dep=dep, arr=arr, delay_min=delay, tail=tail, crew_id=crew_id,
                              standby_called=standby_called))
            ac.location = f.dest
            ac.ready_at = arr + typ.turnaround(self._hub.get(f.dest, False))
            cs.location = f.dest
            cs.ready_at = arr + typ.turnaround(self._hub.get(f.dest, False))
            cs.sectors += 1
            cs.flight_time += block

        # legs never reached (should not happen) -> forced
        for f in inst.flights:
            if f.id not in outcomes:
                outcomes[f.id] = LegOutcome(f.id, "CANCELLED_FORCED", tail=eff_tail[f.id], crew_id=eff_crew[f.id],
                                            reason="unreachable in propagation (dependency cycle)")

        tail_end = {t: (s.location or "") for t, s in ac_state.items()}
        crew_end = {c: s.location for c, s in crew_state.items()}
        itins = self._passengers(outcomes)
        metrics = self._metrics(outcomes, itins, decisions, tail_end, crew_end, standby_used, source_delay)
        return SimResult(legs=outcomes, itineraries=itins, metrics=metrics, tail_end_location=tail_end,
                         crew_end_location=crew_end, standby_used=standby_used)

    # ------------------------------------------------------------ passengers (§7.3)

    def _passengers(self, legs: dict[str, LegOutcome]) -> list[ItineraryOutcome]:
        inst = self.inst
        # remaining seats on operated flights (bookings already include the itinerary pax)
        spare: dict[str, int] = {f.id: f.seats - f.booked_pax for f in inst.flights if legs[f.id].operated}
        by_od: dict[tuple[str, str], list[Flight]] = defaultdict(list)
        for f in inst.flights:
            if legs[f.id].operated:
                by_od[(f.origin, f.dest)].append(f)
        for lst in by_od.values():
            lst.sort(key=lambda x: legs[x.id].dep or x.std)

        out: list[ItineraryOutcome] = []

        def reprotect(o: ItineraryOutcome, origin: str, dest: str, ready: int, sched_arr: int, pax: int) -> None:
            remaining = pax
            for g in by_od.get((origin, dest), []):
                gd, ga = legs[g.id].dep, legs[g.id].arr
                if gd is None or ga is None or gd < ready or gd > ready + self.reprotect_window:
                    continue
                if spare.get(g.id, 0) <= 0:
                    continue
                take = min(remaining, spare[g.id])
                spare[g.id] -= take
                remaining -= take
                o.reprotected_on.append(g.id)
                o.reprotected_pax += take
                o.delay_min += max(0, ga - sched_arr) * take
                if remaining == 0:
                    break
            o.stranded_pax += remaining

        for it in inst.itineraries:
            l1 = inst.flight(it.legs[0])
            o1 = legs[l1.id]
            o = ItineraryOutcome(itinerary_id=it.id, pax=it.pax_count, status="ok")
            final_dest = inst.flight(it.legs[-1]).dest
            sched_arr = inst.flight(it.legs[-1]).sta
            if not o1.operated:
                o.status = "cancelled"
                reprotect(o, l1.origin, final_dest, l1.std, sched_arr, it.pax_count)
            elif len(it.legs) > 1:
                l2 = inst.flight(it.legs[1])
                o2 = legs[l2.id]
                assert o1.arr is not None
                if not o2.operated:
                    o.status = "cancelled"
                    reprotect(o, l2.origin, final_dest, o1.arr + self._mct.get(l1.dest, 45), sched_arr, it.pax_count)
                elif o2.dep is not None and o1.arr + self._mct.get(l1.dest, 45) > o2.dep:
                    o.status = "misconnect"
                    reprotect(o, l2.origin, final_dest, o1.arr + self._mct.get(l1.dest, 45), sched_arr, it.pax_count)
                elif o2.arr is not None:
                    o.delay_min = max(0, o2.arr - sched_arr) * it.pax_count
            elif o1.arr is not None:
                o.delay_min = max(0, o1.arr - sched_arr) * it.pax_count
            out.append(o)
        return out

    # ------------------------------------------------------------ metrics

    def _compensation(self, f: Flight, pax: int) -> float:
        b = f.block_min
        rate = self.comp[0] if b <= 60 else self.comp[1] if b <= 120 else self.comp[2]
        return rate * pax

    def _metrics(self, legs: dict[str, LegOutcome], itins: list[ItineraryOutcome], decisions: Decisions,
                 tail_end: dict[str, str], crew_end: dict[str, str], standby_used: list[str],
                 source_delay: dict[str, int]) -> Metrics:
        inst = self.inst
        m = Metrics()
        affected: list[str] = []
        for fid, o in legs.items():
            f = inst.flight(fid)
            if o.status == "CANCELLED_FORCED":
                m.forced_downstream_cancellations += 1
            if not o.operated:
                m.cancellations += 1
                m.pax_cancelled += f.booked_pax
                m.special_assistance_affected += f.pax_special_assistance
                m.high_value_affected += f.pax_high_value
                m.partner_pax_affected += f.pax_partner
                m.compensation_inr += self._compensation(f, f.booked_pax)
                affected.append(fid)
            else:
                m.total_delay_min += o.delay_min
                # delay beyond what was already known (source delay), whether it was imposed by the plan or
                # propagated - an imposed delay is still delay the network suffers
                extra = o.delay_min - source_delay.get(fid, 0)
                if extra > 0:
                    m.propagated_delay_min += extra
                if o.delay_min > 0:
                    affected.append(fid)
        m.delays = len(decisions.delays)
        m.swaps = len(decisions.swaps)
        m.crew_standby_used = len(standby_used)
        # passengers
        for it in itins:
            if it.status == "misconnect":
                m.misconnects += it.pax
            if it.status in ("cancelled", "misconnect"):
                m.pax_reprotect_delay_hours += it.delay_min / 60.0
                m.pax_stranded_overnight += it.stranded_pax
                itin = self._itins[it.itinerary_id]
                if it.status == "misconnect":
                    leg = inst.flight(itin.legs[-1])
                    share = it.pax / max(1, leg.booked_pax)
                    m.special_assistance_affected += leg.pax_special_assistance * share
                    m.high_value_affected += leg.pax_high_value * share
                    m.partner_pax_affected += leg.pax_partner * share
                # re-protection timing
                first = inst.flight(itin.legs[0])
                if it.reprotected_pax:
                    # approximate: all re-protected pax share the earliest alternative's timing
                    gd = legs[it.reprotected_on[0]].dep or 0
                    if gd - first.std <= 240:
                        m.pax_reprotected_within_4h += it.reprotected_pax
                    if gd < self.overnight_cutoff:
                        m.pax_reprotected_same_day += it.reprotected_pax
        # positions at end of day
        for t, loc in tail_end.items():
            if self._planned_tail_end.get(t) and loc != self._planned_tail_end[t]:
                m.next_wave_shortfall += 1
        for cid, loc in crew_end.items():
            c = inst.crew(cid)
            if not c.is_standby and c.pairing and loc != self._planned_crew_end[cid]:
                m.crew_out_of_position += 1
        # buffer consumed: delay absorbed between consecutive legs on a tail
        by_tail: dict[str, list[LegOutcome]] = defaultdict(list)
        for o in legs.values():
            if o.operated and o.tail:
                by_tail[o.tail].append(o)
        for lst in by_tail.values():
            lst.sort(key=lambda o: o.dep or 0)
            for a, b in zip(lst, lst[1:], strict=False):
                m.buffer_consumed_min += max(0, a.delay_min - b.delay_min)
        m.affected_flights = sorted(set(affected))
        return m


def apply_and_simulate(sim: Simulator, decisions: Decisions, clock: int, sample: ScenarioSample | None = None) -> SimResult:
    return sim.run(decisions, clock=clock, sample=sample)
