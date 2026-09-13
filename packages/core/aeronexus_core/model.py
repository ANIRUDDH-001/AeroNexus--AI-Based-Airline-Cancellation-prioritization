"""Domain model (Implementation Plan §6).

Every entity carries fixed core fields plus an open ``attributes`` map so that new parameters can be
added at run time without code changes (§15). All times are minutes from ``Instance.day_start``.
"""
from __future__ import annotations

from datetime import date
from functools import cached_property
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Attributes = dict[str, Any]

MINUTES_PER_DAY = 1440


def fmt_time(minutes: int) -> str:
    """Render engine minutes as HH:MM, with a +N suffix past midnight (display only)."""
    day, rem = divmod(int(minutes), MINUTES_PER_DAY)
    hh, mm = divmod(rem, 60)
    return f"{hh:02d}:{mm:02d}" + (f"+{day}" if day else "")


class TimeWindow(BaseModel):
    start: int = Field(ge=0)
    end: int = Field(ge=0)

    @model_validator(mode="after")
    def _ordered(self) -> TimeWindow:
        if self.end < self.start:
            raise ValueError(f"TimeWindow end {self.end} < start {self.start}")
        return self

    def contains(self, t: int) -> bool:
        return self.start <= t < self.end


class HourlyCapacity(BaseModel):
    dep: int = Field(ge=0)
    arr: int = Field(ge=0)


# ---------------------------------------------------------------- airports / fleet


class Airport(BaseModel):
    code: str = Field(min_length=3, max_length=4)
    name: str
    lat: float
    lon: float
    tz: str = "Asia/Kolkata"
    is_hub: bool = False
    curfew_windows: list[TimeWindow] = Field(default_factory=list)
    slot_capacity_per_hour: HourlyCapacity = Field(default_factory=lambda: HourlyCapacity(dep=30, arr=30))
    stand_capacity: int = Field(default=20, ge=1)
    min_connection_time_min: int = Field(default=45, ge=0)
    lvp_windows: list[TimeWindow] = Field(default_factory=list)
    closure_windows: list[TimeWindow] = Field(default_factory=list)
    attributes: Attributes = Field(default_factory=dict)


class AircraftType(BaseModel):
    code: str
    seats: int = Field(gt=0)
    min_turnaround_min: dict[str, int] = Field(default_factory=lambda: {"hub": 35, "spoke": 30})
    hourly_operating_cost: float = Field(default=0.0, ge=0)
    cat3_capable: bool = True
    cruise_kmh: float = Field(default=750.0, gt=0)
    attributes: Attributes = Field(default_factory=dict)

    def turnaround(self, is_hub: bool) -> int:
        return self.min_turnaround_min["hub" if is_hub else "spoke"]


AircraftStatus = Literal["OK", "AOG", "MEL"]


class Aircraft(BaseModel):
    tail: str
    type_code: str
    status: AircraftStatus = "OK"
    mel_restrictions: list[str] = Field(default_factory=list)
    maintenance_due_at: int | None = None
    location: str | None = None  # station code at day start
    attributes: Attributes = Field(default_factory=dict)


# ---------------------------------------------------------------- flights


FlightStatus = Literal["SCHEDULED", "DELAYED", "DEPARTED", "ARRIVED", "CANCELLED"]


class Flight(BaseModel):
    id: str
    number: str
    origin: str
    dest: str
    std: int = Field(ge=0)
    sta: int = Field(ge=0)
    block_min: int = Field(gt=0)
    aircraft_type: str
    tail: str | None = None
    crew_id: str | None = None
    status: FlightStatus = "SCHEDULED"
    etd: int | None = None
    eta: int | None = None
    delay_min: int = Field(default=0, ge=0)
    seats: int = Field(gt=0)
    booked_pax: int = Field(default=0, ge=0)
    pax_connecting: int = Field(default=0, ge=0)
    pax_special_assistance: int = Field(default=0, ge=0)
    pax_high_value: int = Field(default=0, ge=0)
    pax_partner: int = Field(default=0, ge=0)
    protected: bool = False
    protection_reason: str | None = None
    attributes: Attributes = Field(default_factory=dict)

    @model_validator(mode="after")
    def _consistent(self) -> Flight:
        if self.origin == self.dest:
            raise ValueError(f"Flight {self.id}: origin == dest ({self.origin})")
        if self.sta != self.std + self.block_min:
            raise ValueError(f"Flight {self.id}: sta {self.sta} != std {self.std} + block {self.block_min}")
        if self.booked_pax > self.seats:
            raise ValueError(f"Flight {self.id}: booked {self.booked_pax} > seats {self.seats}")
        if self.pax_connecting > self.booked_pax:
            raise ValueError(f"Flight {self.id}: connecting {self.pax_connecting} > booked {self.booked_pax}")
        return self

    @property
    def is_cancelled(self) -> bool:
        return self.status == "CANCELLED"


# ---------------------------------------------------------------- crew


class Crew(BaseModel):
    """One crew set (cockpit + cabin as a unit; decision Q6) with cockpit qualification flags."""

    id: str
    base: str
    type_ratings: list[str]
    special_quals: list[str] = Field(default_factory=list)  # e.g. ["CAT3"]
    duty_start: int | None = None  # report time; None for standby not yet called
    fdp_limit_min: int = Field(gt=0)
    flight_time_today_min: int = Field(default=0, ge=0)
    flight_time_week_min: int = Field(default=0, ge=0)
    rest_until: int = Field(default=0, ge=0)
    location: str
    pairing: list[str] = Field(default_factory=list)  # flight ids in order
    is_standby: bool = False
    callout_min: int = Field(default=90, ge=0)
    attributes: Attributes = Field(default_factory=dict)


# ---------------------------------------------------------------- passengers (aggregate, no PII)


ItineraryCategory = Literal["local", "connecting", "partner"]


class Itinerary(BaseModel):
    id: str
    legs: list[str] = Field(min_length=1)
    pax_count: int = Field(gt=0)
    category: ItineraryCategory = "local"
    attributes: Attributes = Field(default_factory=dict)


# ---------------------------------------------------------------- disruptions


DisruptionType = Literal[
    "AIRPORT_CAPACITY", "LVP", "AOG", "CREW_UNAVAILABLE", "ATC_FLOW", "FLIGHT_DELAY", "CLOSURE"
]


class Disruption(BaseModel):
    id: str
    type: DisruptionType
    target: str  # airport code, tail, crew base, or flight id depending on type
    start: int = Field(ge=0)
    end_nominal: int | None = None
    end_distribution: dict[str, Any] | None = None  # e.g. {"dist": "lognormal", "mean_min": 180, "sigma": 0.4}
    severity: dict[str, Any] = Field(default_factory=dict)  # e.g. {"capacity_fraction": 0.4}, {"delay_min": 90}
    attributes: Attributes = Field(default_factory=dict)


# ---------------------------------------------------------------- instance (one operational day)


InstanceSize = Literal["small", "medium", "large", "custom"]


class Instance(BaseModel):
    model_config = ConfigDict(ignored_types=(cached_property,))

    name: str
    size: InstanceSize = "custom"
    seed: int | None = None
    day_start: date
    airports: list[Airport]
    aircraft_types: list[AircraftType]
    aircraft: list[Aircraft]
    flights: list[Flight]
    crews: list[Crew]
    itineraries: list[Itinerary]
    disruptions: list[Disruption] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    # ---- lookups ----------------------------------------------------------------
    # Instances are treated as immutable once built; lookups are cached on first use and the caches
    # are dropped whenever a modified copy is made (model_copy), so a copy never answers with stale data.

    _CACHED_LOOKUPS = ("airports_by_code", "flights_by_id", "aircraft_by_tail", "types_by_code", "crews_by_id", "hubs")

    def model_copy(self, *, update: dict[str, Any] | None = None, deep: bool = False) -> Instance:
        copied = super().model_copy(update=update, deep=deep)
        for key in self._CACHED_LOOKUPS:
            copied.__dict__.pop(key, None)
        return copied

    @cached_property
    def airports_by_code(self) -> dict[str, Airport]:
        return {a.code: a for a in self.airports}

    @cached_property
    def flights_by_id(self) -> dict[str, Flight]:
        return {f.id: f for f in self.flights}

    @cached_property
    def aircraft_by_tail(self) -> dict[str, Aircraft]:
        return {a.tail: a for a in self.aircraft}

    @cached_property
    def types_by_code(self) -> dict[str, AircraftType]:
        return {t.code: t for t in self.aircraft_types}

    @cached_property
    def crews_by_id(self) -> dict[str, Crew]:
        return {c.id: c for c in self.crews}

    @cached_property
    def hubs(self) -> set[str]:
        return {a.code for a in self.airports if a.is_hub}

    def airport(self, code: str) -> Airport:
        return self.airports_by_code[code]

    def flight(self, fid: str) -> Flight:
        return self.flights_by_id[fid]

    def aircraft_type(self, code: str) -> AircraftType:
        return self.types_by_code[code]

    def crew(self, cid: str) -> Crew:
        return self.crews_by_id[cid]

    def rotations(self) -> dict[str, list[Flight]]:
        """Tail -> legs ordered by STD (§6.4)."""
        rot: dict[str, list[Flight]] = {}
        for f in self.flights:
            if f.tail is not None:
                rot.setdefault(f.tail, []).append(f)
        for legs in rot.values():
            legs.sort(key=lambda x: (x.std, x.id))
        return rot

    def cycles(self) -> dict[str, list[list[Flight]]]:
        """Tail -> out-and-back cycles: legs from leaving a hub until the next arrival at a hub."""
        hubs = self.hubs
        out: dict[str, list[list[Flight]]] = {}
        for tail, legs in self.rotations().items():
            cycles: list[list[Flight]] = []
            cur: list[Flight] = []
            for leg in legs:
                cur.append(leg)
                if leg.dest in hubs:
                    cycles.append(cur)
                    cur = []
            if cur:
                cycles.append(cur)
            out[tail] = cycles
        return out

    def to_json(self, indent: int | None = 2) -> str:
        return self.model_dump_json(indent=indent)

    @classmethod
    def from_json(cls, text: str) -> Instance:
        return cls.model_validate_json(text)

    def content_hash(self) -> str:
        """16-hex-char SHA-256 of the day's content (flights, fleet, crews, itineraries, airports, disruptions).
        Stored on every run: if the day is edited afterwards the hash no longer matches and the run is
        known to be non-reproducible from the current state."""
        import hashlib

        payload = self.model_dump_json(exclude={"metadata"})
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "size": self.size,
            "seed": self.seed,
            "day_start": self.day_start.isoformat(),
            "airports": len(self.airports),
            "hubs": len(self.hubs),
            "aircraft": len(self.aircraft),
            "flights": len(self.flights),
            "crews": len(self.crews),
            "standby_crews": sum(1 for c in self.crews if c.is_standby),
            "itineraries": len(self.itineraries),
            "booked_pax": sum(f.booked_pax for f in self.flights),
            "connecting_pax": sum(i.pax_count for i in self.itineraries if len(i.legs) > 1),
            "disruptions": len(self.disruptions),
        }


# ---------------------------------------------------------------- decisions (§6.8)


ActionType = Literal["CANCEL_LEG", "CANCEL_CYCLE", "DELAY", "SWAP", "WAIT"]
FeasibilityStatus = Literal["feasible", "infeasible", "unchecked"]


class Feasibility(BaseModel):
    status: FeasibilityStatus = "unchecked"
    reasons: list[str] = Field(default_factory=list)


class Action(BaseModel):
    type: ActionType
    target_flights: list[str] = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)  # delay_min, swap_tail, wait_min
    feasibility: Feasibility = Field(default_factory=Feasibility)
    metrics: dict[str, float] = Field(default_factory=dict)

    def key(self) -> str:
        p = ",".join(f"{k}={self.params[k]}" for k in sorted(self.params))
        return f"{self.type}({'+'.join(self.target_flights)}{';' + p if p else ''})"


class ScenarioStats(BaseModel):
    mean: float
    p90: float
    stability: float | None = None  # share of samples in which this plan stays top-1
    samples: int


class Plan(BaseModel):
    actions: list[Action]
    metrics: dict[str, float] = Field(default_factory=dict)
    nis: float = 0.0
    nis_breakdown: dict[str, float] = Field(default_factory=dict)  # per level and per term
    scenario_stats: ScenarioStats | None = None
    explanation: dict[str, Any] = Field(default_factory=dict)
    rank: int | None = None


class Run(BaseModel):
    id: str
    created_at: str
    decision_time: int
    instance_name: str
    config_hash: str
    engine_version: str
    plans: list[Plan]
    excluded: list[Action] = Field(default_factory=list)
    latency_ms: float = 0.0
    accepted_plan: int | None = None
    override_reason: str | None = None
    narrative: str | None = None  # LLM narration; never part of the decision record (§14.1)
    notes: list[str] = Field(default_factory=list)                 # e.g. latency-budget reductions, hysteresis
    at_risk: list[dict[str, Any]] = Field(default_factory=list)   # flights the baseline flagged, with reasons
    baseline_metrics: dict[str, float] = Field(default_factory=dict)  # "do nothing" outcome
    plans_evaluated: int = 0
    depth_reached: int = 0
    whatif: list[Plan] = Field(default_factory=list)  # caller-supplied plans, always returned with their rank
    instance_hash: str | None = None  # content hash of the day the run saw (edits change it; see instance_hash())
    effective: dict[str, Any] = Field(default_factory=dict)  # what the search actually used: samples, depth, deterministic


class Decisions(BaseModel):
    """The plan-so-far as an overlay on the immutable instance (Plan §7). Applying an action extends this;
    the simulator derives the effective schedule from instance + decisions + disruptions."""

    cancelled: list[str] = Field(default_factory=list)          # flight ids cancelled by decision
    delays: dict[str, int] = Field(default_factory=dict)        # flight id -> imposed delay minutes
    tail_override: dict[str, str] = Field(default_factory=dict)  # flight id -> tail (after swaps)
    crew_override: dict[str, str] = Field(default_factory=dict)  # flight id -> crew id (standby call-outs)
    swaps: list[str] = Field(default_factory=list)               # flight ids at which a SWAP was applied
    wait_until: int | None = None                                # WAIT action (faculty track)

    def key(self) -> str:
        parts = [
            "C:" + ",".join(sorted(self.cancelled)),
            "D:" + ",".join(f"{k}={v}" for k, v in sorted(self.delays.items())),
            "T:" + ",".join(f"{k}={v}" for k, v in sorted(self.tail_override.items())),
            "W:" + ",".join(f"{k}={v}" for k, v in sorted(self.crew_override.items())),
            "S:" + ",".join(self.swaps),
        ]
        return "|".join(parts)

    def extended(self, action: Action, instance: Instance | None = None) -> Decisions:
        """Return a copy with ``action`` applied. SWAP needs the instance to rewrite both rotations."""
        d = self.model_copy(deep=True)
        if action.type in ("CANCEL_LEG", "CANCEL_CYCLE"):
            for fid in action.target_flights:
                if fid not in d.cancelled:
                    d.cancelled.append(fid)
        elif action.type == "DELAY":
            for fid in action.target_flights:
                d.delays[fid] = max(d.delays.get(fid, 0), int(action.params.get("delay_min", 0)))
        elif action.type == "SWAP":
            if instance is None:
                raise ValueError("SWAP needs the instance")
            fid = action.target_flights[0]
            f = instance.flight(fid)
            new_tail = str(action.params["swap_tail"])
            d.swaps.append(fid)
            old_tail = d.tail_override.get(fid, f.tail)
            assert old_tail is not None
            # legs of old_tail from f onwards -> new_tail; legs of new_tail from f.std onwards -> old_tail
            for g in instance.flights:
                eff = d.tail_override.get(g.id, g.tail)
                if eff == old_tail and g.std >= f.std:
                    d.tail_override[g.id] = new_tail
                elif eff == new_tail and g.std >= f.std:
                    d.tail_override[g.id] = old_tail
        elif action.type == "WAIT":
            d.wait_until = int(action.params.get("wait_until", 0))
        return d


class State(BaseModel):
    """Operational snapshot at ``clock``: the immutable instance plus the decisions taken so far."""

    clock: int = Field(ge=0)
    instance: Instance
    decisions: Decisions = Field(default_factory=Decisions)

    def apply(self, action: Action) -> State:
        return State(clock=self.clock, instance=self.instance, decisions=self.decisions.extended(action, self.instance))
