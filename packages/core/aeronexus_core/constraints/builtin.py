"""Builtin constraint plugins H1–H10 (Plan §8).

Static rules are fully implemented here. Simulation-dependent rules (continuity, turnaround, FDTL,
slots, stands, swap feasibility) are registered with their configuration and phase so the catalogue is
complete and editable from the UI now; their ``check`` is completed in Phase 2 together with the
simulator (they currently return None, i.e. never exclude - documented in tests as ``xfail``).
"""
from __future__ import annotations

from typing import Any

from ..expressions import Namespace, evaluate
from ..model import Action, Flight, State, TimeWindow
from .base import Constraint, Violation, register

_CANCEL_TYPES = {"CANCEL_LEG", "CANCEL_CYCLE"}


def _flights(state: State, action: Action) -> list[Flight]:
    inst = state.instance
    return [inst.flight(fid) for fid in action.target_flights if fid in inst.flights_by_id]


def _in_windows(t: int, windows: list[TimeWindow]) -> TimeWindow | None:
    for w in windows:
        if w.contains(t):
            return w
    return None


def _planned_times(f: Flight, action: Action) -> tuple[int, int]:
    """Departure/arrival the action implies for this flight (delay applied, else schedule/estimate)."""
    dep = f.etd if f.etd is not None else f.std
    if action.type == "DELAY":
        dep = f.std + int(action.params.get("delay_min", 0))
    return dep, dep + f.block_min


# ---------------------------------------------------------------- static rules


@register
class AircraftAOG(Constraint):
    plugin_id = "aircraft_aog"

    def check(self, state: State, action: Action) -> Violation | None:
        inst = state.instance
        if action.type in _CANCEL_TYPES:
            return None  # cancelling an AOG aircraft's flight is allowed (it is usually forced)
        tails = [inst.flight(fid).tail for fid in action.target_flights]
        if action.type == "SWAP":
            tails = [action.params.get("swap_tail")]
        for tail in tails:
            if tail and inst.aircraft_by_tail.get(tail) and inst.aircraft_by_tail[tail].status == "AOG":
                return self.violation(f"aircraft {tail} is AOG and cannot operate", tail=tail)
        return None


@register
class AircraftMEL(Constraint):
    plugin_id = "aircraft_mel"

    def check(self, state: State, action: Action) -> Violation | None:
        inst = state.instance
        if action.type in _CANCEL_TYPES:
            return None
        for f in _flights(state, action):
            tail = action.params.get("swap_tail") if action.type == "SWAP" else f.tail
            ac = inst.aircraft_by_tail.get(tail) if tail else None
            if ac is None or ac.status != "MEL":
                continue
            dep, arr = _planned_times(f, action)
            dest = inst.airport(f.dest)
            if "NO_CAT3" in ac.mel_restrictions and _in_windows(arr, dest.lvp_windows):
                return self.violation(
                    f"aircraft {tail} has MEL restriction NO_CAT3 but {f.dest} is under low-visibility procedures",
                    tail=tail, flight=f.id,
                )
        return None


@register
class ProtectedFlight(Constraint):
    plugin_id = "protected_flight"

    def check(self, state: State, action: Action) -> Violation | None:
        if action.type not in _CANCEL_TYPES:
            return None
        for f in _flights(state, action):
            if f.protected:
                why = f" ({f.protection_reason})" if f.protection_reason else ""
                return self.violation(f"flight {f.number} is protected{why} and cannot be cancelled", flight=f.id)
        return None


@register
class AirportCurfew(Constraint):
    plugin_id = "airport_curfew"

    def check(self, state: State, action: Action) -> Violation | None:
        if action.type in _CANCEL_TYPES:
            return None
        inst = state.instance
        for f in _flights(state, action):
            dep, arr = _planned_times(f, action)
            w = _in_windows(dep, inst.airport(f.origin).curfew_windows)
            if w:
                return self.violation(f"{f.number} would depart {f.origin} inside curfew", flight=f.id, at=dep)
            w = _in_windows(arr, inst.airport(f.dest).curfew_windows)
            if w:
                return self.violation(f"{f.number} would arrive {f.dest} inside curfew", flight=f.id, at=arr)
        return None


@register
class AirportClosure(Constraint):
    plugin_id = "airport_closure"

    def check(self, state: State, action: Action) -> Violation | None:
        if action.type in _CANCEL_TYPES:
            return None
        inst = state.instance
        for f in _flights(state, action):
            dep, arr = _planned_times(f, action)
            if _in_windows(dep, inst.airport(f.origin).closure_windows):
                return self.violation(f"{f.origin} is closed at the planned departure of {f.number}", flight=f.id)
            if _in_windows(arr, inst.airport(f.dest).closure_windows):
                return self.violation(f"{f.dest} is closed at the planned arrival of {f.number}", flight=f.id)
        return None


@register
class DelayBounds(Constraint):
    plugin_id = "delay_bounds"

    def check(self, state: State, action: Action) -> Violation | None:
        if action.type != "DELAY":
            return None
        d = int(action.params.get("delay_min", 0))
        limit = int(self.config.get("max_delay_min", 180))
        if d <= 0:
            return self.violation("delay must be positive", delay_min=d)
        if d > limit:
            return self.violation(f"delay of {d} min exceeds the {limit} min bound", delay_min=d, limit=limit)
        return None


@register
class CrewQualification(Constraint):
    """Type rating always; special qualification (CAT-III) when LVP is active at origin or destination."""

    plugin_id = "crew_qualification"

    def check(self, state: State, action: Action) -> Violation | None:
        if action.type in _CANCEL_TYPES:
            return None
        inst = state.instance
        required_lvp = set(self.config.get("lvp_requires", ["CAT3"]))
        for f in _flights(state, action):
            if not f.crew_id or f.crew_id not in inst.crews_by_id:
                continue
            crew = inst.crew(f.crew_id)
            if f.aircraft_type not in crew.type_ratings:
                return self.violation(f"crew {crew.id} is not rated on {f.aircraft_type}", crew=crew.id, flight=f.id)
            dep, arr = _planned_times(f, action)
            lvp = _in_windows(dep, inst.airport(f.origin).lvp_windows) or _in_windows(arr, inst.airport(f.dest).lvp_windows)
            if lvp and not required_lvp.issubset(crew.special_quals):
                return self.violation(
                    f"crew {crew.id} lacks {'/'.join(sorted(required_lvp))} qualification required under LVP",
                    crew=crew.id, flight=f.id,
                )
        return None


@register
class ExpressionRule(Constraint):
    """User-defined rule (H10): ``forbid_if`` expression over flight/attrs, applied to listed action types."""

    plugin_id = "expression_rule"

    def check(self, state: State, action: Action) -> Violation | None:
        applies = set(self.config.get("applies_to") or ["CANCEL_LEG", "CANCEL_CYCLE", "DELAY", "SWAP", "WAIT"])
        if action.type not in applies:
            return None
        expr = self.config["forbid_if"]
        for f in _flights(state, action):
            ns: dict[str, Any] = {
                "flight": _flight_namespace(f),
                "action": Namespace({"type": action.type, "params": dict(action.params)}),
                "clock": state.clock,
            }
            if evaluate(expr, ns):
                return self.violation(f"{self.definition.name} (rule matched for {f.number})", flight=f.id)
        return None


def _flight_namespace(f: Flight) -> Namespace:
    d = f.model_dump()
    d["attrs"] = dict(f.attributes)
    return Namespace(d)


# ---------------------------------------------------------------- simulation-dependent rules (Phase 2)


class _SimulatedStub(Constraint):
    phase = "simulated"

    def check(self, state: State, action: Action) -> Violation | None:  # pragma: no cover - Phase 2
        return None


@register
class AircraftContinuity(_SimulatedStub):
    plugin_id = "aircraft_continuity"


@register
class MinTurnaround(_SimulatedStub):
    plugin_id = "min_turnaround"


@register
class CrewFDTL(_SimulatedStub):
    plugin_id = "crew_fdtl"


@register
class CrewRest(_SimulatedStub):
    plugin_id = "crew_rest"


@register
class CrewLocation(_SimulatedStub):
    plugin_id = "crew_location"


@register
class AirportSlotCap(_SimulatedStub):
    plugin_id = "airport_slot_cap"


@register
class AirportStandCap(_SimulatedStub):
    plugin_id = "airport_stand_cap"


@register
class AircraftMaintenanceDue(_SimulatedStub):
    plugin_id = "aircraft_maintenance_due"


@register
class SwapFeasibility(_SimulatedStub):
    plugin_id = "swap_feasibility"


@register
class PassengerMCT(_SimulatedStub):
    plugin_id = "passenger_mct"
