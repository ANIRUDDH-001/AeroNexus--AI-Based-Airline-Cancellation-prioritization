"""Seeded IndiGo-like network generator (Plan §16.2).

``generate(GeneratorParams)`` builds one operational day: airports, fleet, rotations as out-and-back
cycles (plus some triangles) from hub bases, aggregate passenger itineraries that add up exactly to
each flight's bookings, FDTL-legal crew pairings, standby crews, and optionally disruptions.

Everything is driven by ``numpy.random.default_rng(seed)`` so the same params + seed always give the
same instance (tested). All times are minutes from 00:00 of ``day_start``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any

import numpy as np

from aeronexus_core.fdtl import DEFAULT_MAX_SECTORS, DEFAULT_REPORT_BEFORE_STD_MIN, fdp_limit
from aeronexus_core.model import (
    Aircraft,
    AircraftType,
    Airport,
    Crew,
    Flight,
    HourlyCapacity,
    Instance,
    InstanceSize,
    Itinerary,
)

from .airports import HUBS, SPOKES, AirportSeed

GENERATOR_VERSION = "0.1.0"

FLEET_TYPES: dict[str, AircraftType] = {
    "A320": AircraftType(code="A320", seats=180, min_turnaround_min={"hub": 35, "spoke": 30},
                         hourly_operating_cost=260_000, cat3_capable=True, cruise_kmh=760),
    "A321": AircraftType(code="A321", seats=222, min_turnaround_min={"hub": 40, "spoke": 35},
                         hourly_operating_cost=300_000, cat3_capable=True, cruise_kmh=760),
    "ATR72": AircraftType(code="ATR72", seats=78, min_turnaround_min={"hub": 25, "spoke": 25},
                          hourly_operating_cost=110_000, cat3_capable=False, cruise_kmh=460),
}
# A320 and A321 share one type rating (A320 family).
RATING_GROUPS: dict[str, list[str]] = {"A320": ["A320", "A321"], "A321": ["A320", "A321"], "ATR72": ["ATR72"]}
ATR_MAX_KM = 650.0

SIZE_PRESETS: dict[str, dict[str, Any]] = {
    "small": {"n_airports": 6, "n_hubs": 2, "fleet": {"A320": 11, "A321": 2, "ATR72": 2}},
    "medium": {"n_airports": 12, "n_hubs": 4, "fleet": {"A320": 30, "A321": 6, "ATR72": 4}},
    "large": {"n_airports": 50, "n_hubs": 6, "fleet": {"A320": 230, "A321": 45, "ATR72": 25}},
}


@dataclass
class GeneratorParams:
    size: InstanceSize = "small"
    seed: int = 1
    day_start: date = date(2026, 12, 15)  # a December day: fog season at DEL for scenario realism
    n_airports: int = 6
    n_hubs: int = 2
    fleet: dict[str, int] = field(default_factory=lambda: dict(SIZE_PRESETS["small"]["fleet"]))
    # schedule shape
    first_dep_window: tuple[int, int] = (330, 420)      # 05:30-07:00
    last_arrival_limit: int = 1410                      # 23:30
    cross_midnight_share: float = 0.10                  # tails allowed to land up to 02:00 next day
    cross_midnight_limit: int = 1560
    target_block_hours: tuple[float, float] = (10.5, 13.0)
    triangle_share: float = 0.20                        # cycles that are base->A->B->base
    hub_dest_weight: float = 3.0                        # hubs are more likely destinations than spokes
    taxi_climb_descent_min: int = 25
    # demand
    load_factor_beta: tuple[float, float] = (26.1, 3.9)  # mean ~0.87
    load_factor_bounds: tuple[float, float] = (0.55, 1.0)
    connecting_share: tuple[float, float] = (0.10, 0.25)
    max_connection_wait_min: int = 180
    special_assistance_lambda: float = 1.0
    high_value_share: tuple[float, float] = (0.02, 0.10)
    partner_share: tuple[float, float] = (0.02, 0.08)
    partner_bank: tuple[int, int] = (1200, 1380)         # 20:00-23:00 hub departures feed partners
    # crew
    pairing_legs: tuple[int, int] = (2, 4)
    report_before_std_min: int = DEFAULT_REPORT_BEFORE_STD_MIN
    post_flight_duty_min: int = 30  # must match search.post_flight_duty_min so generated pairings are legal in the simulator
    standby_per_hub: tuple[int, int] = (2, 4)
    standby_callout: tuple[int, int] = (60, 90)
    cat3_share: float = 0.6
    week_flight_time_prior: tuple[int, int] = (600, 1500)
    # airports
    hub_capacity: tuple[int, int] = (30, 40)
    spoke_capacity: tuple[int, int] = (8, 12)
    hub_stands: int = 40
    spoke_stands: int = 8
    hub_mct: int = 45
    spoke_mct: int = 30

    @classmethod
    def for_size(cls, size: str, seed: int = 1, **overrides: Any) -> GeneratorParams:
        if size not in SIZE_PRESETS:
            raise ValueError(f"unknown size {size!r}; choose from {sorted(SIZE_PRESETS)}")
        preset = SIZE_PRESETS[size]
        p = cls(size=size, seed=seed, n_airports=preset["n_airports"], n_hubs=preset["n_hubs"],
                fleet=dict(preset["fleet"]))
        return replace(p, **overrides) if overrides else p


# ---------------------------------------------------------------- helpers


def haversine_km(a: AirportSeed, b: AirportSeed) -> float:
    r = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a.lat, a.lon, b.lat, b.lon))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def block_minutes(km: float, cruise_kmh: float, overhead_min: int) -> int:
    raw = km / cruise_kmh * 60 + overhead_min
    return int(math.ceil(raw / 5.0) * 5)


def _round5(x: float) -> int:
    return int(round(x / 5.0) * 5)


# ---------------------------------------------------------------- generator


class _Gen:
    def __init__(self, p: GeneratorParams):
        self.p = p
        self.rng = np.random.default_rng(p.seed)
        self.seeds: dict[str, AirportSeed] = {}
        self.hub_codes: list[str] = []
        self.spoke_codes: list[str] = []
        self.airports: list[Airport] = []
        self.types: dict[str, AircraftType] = {}
        self.aircraft: list[Aircraft] = []
        self.flights: list[Flight] = []
        self.crews: list[Crew] = []
        self.itineraries: list[Itinerary] = []
        self._fno = 2000
        self._dist: dict[tuple[str, str], float] = {}

    # ---- airports
    def build_airports(self) -> None:
        p, rng = self.p, self.rng
        if p.n_hubs > len(HUBS):
            raise ValueError(f"at most {len(HUBS)} hubs available")
        if p.n_airports > len(HUBS) + len(SPOKES):
            raise ValueError(f"at most {len(HUBS) + len(SPOKES)} airports available")
        hubs = HUBS[: p.n_hubs]
        n_spokes = p.n_airports - p.n_hubs
        # spokes: draw without replacement, biased towards the earlier (larger) cities
        pool = list(SPOKES) + list(HUBS[p.n_hubs:])
        weights = np.array([1.0 / (1 + 0.08 * i) for i in range(len(pool))])
        idx = rng.choice(len(pool), size=n_spokes, replace=False, p=weights / weights.sum())
        spokes = [pool[i] for i in sorted(idx)]
        for s in hubs + spokes:
            self.seeds[s.code] = s
        self.hub_codes = [h.code for h in hubs]
        self.spoke_codes = [s.code for s in spokes]
        for s in hubs:
            cap = int(rng.integers(p.hub_capacity[0], p.hub_capacity[1] + 1))
            self.airports.append(Airport(code=s.code, name=s.name, lat=s.lat, lon=s.lon, is_hub=True,
                                         slot_capacity_per_hour=HourlyCapacity(dep=cap, arr=cap),
                                         stand_capacity=p.hub_stands, min_connection_time_min=p.hub_mct))
        for s in spokes:
            cap = int(rng.integers(p.spoke_capacity[0], p.spoke_capacity[1] + 1))
            self.airports.append(Airport(code=s.code, name=s.name, lat=s.lat, lon=s.lon, is_hub=False,
                                         slot_capacity_per_hour=HourlyCapacity(dep=cap, arr=cap),
                                         stand_capacity=p.spoke_stands, min_connection_time_min=p.spoke_mct))

    def dist(self, a: str, b: str) -> float:
        key = (a, b) if a < b else (b, a)
        if key not in self._dist:
            self._dist[key] = haversine_km(self.seeds[a], self.seeds[b])
        return self._dist[key]

    # ---- fleet
    def build_fleet(self) -> None:
        p, rng = self.p, self.rng
        used = {k: v for k, v in p.fleet.items() if v > 0}
        self.types = {k: FLEET_TYPES[k] for k in used}
        n_total = sum(used.values())
        # base assignment: hubs weighted by rank
        w = np.array([1.0 / (i + 1) for i in range(len(self.hub_codes))])
        w = w / w.sum()
        bases = rng.choice(self.hub_codes, size=n_total, p=w)
        letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        i = 0
        for tcode, n in used.items():
            for _ in range(n):
                suffix = letters[(i // 26) % 26] + letters[i % 26]
                tail = f"VT-I{suffix}" if i < 676 else f"VT-J{letters[(i // 26) % 26]}{letters[i % 26]}"
                self.aircraft.append(Aircraft(tail=tail, type_code=tcode, location=str(bases[i])))
                i += 1

    # ---- schedule
    def _pick_dest(self, origin: str, typ: AircraftType, exclude: set[str]) -> str | None:
        cands, weights = [], []
        for code in self.hub_codes + self.spoke_codes:
            if code == origin or code in exclude:
                continue
            km = self.dist(origin, code)
            if typ.code == "ATR72" and km > ATR_MAX_KM:
                continue
            if km < 150:
                continue
            cands.append(code)
            weights.append(self.p.hub_dest_weight if code in self.hub_codes else 1.0)
        if not cands:
            return None
        w = np.array(weights) / sum(weights)
        return str(self.rng.choice(cands, p=w))

    def _new_leg(self, origin: str, dest: str, std: int, typ: AircraftType, tail: str) -> Flight:
        km = self.dist(origin, dest)
        block = block_minutes(km, typ.cruise_kmh, self.p.taxi_climb_descent_min)
        self._fno += 1
        num = f"6E{self._fno}"
        return Flight(id=num, number=num, origin=origin, dest=dest, std=std, sta=std + block, block_min=block,
                      aircraft_type=typ.code, tail=tail, seats=typ.seats,
                      attributes={"distance_km": round(km)})

    def _turn(self, typ: AircraftType, station: str) -> int:
        return typ.turnaround(station in self.hub_codes)

    def build_schedule(self) -> None:
        p, rng = self.p, self.rng
        for ac in self.aircraft:
            typ = self.types[ac.type_code]
            base = ac.location or self.hub_codes[0]
            t = _round5(rng.uniform(*p.first_dep_window))
            cross = rng.random() < p.cross_midnight_share
            limit = p.cross_midnight_limit if cross else p.last_arrival_limit
            target_block = rng.uniform(*p.target_block_hours) * 60
            block_total = 0
            legs: list[Flight] = []
            while True:
                triangle = rng.random() < p.triangle_share
                a = self._pick_dest(base, typ, exclude=set())
                if a is None:
                    break
                route = [base, a]
                if triangle:
                    b = self._pick_dest(a, typ, exclude={base})
                    if b is not None:
                        route.append(b)
                route.append(base)
                # simulate the cycle timing before committing
                tt = t
                cycle: list[Flight] = []
                ok = True
                for o, d in zip(route, route[1:], strict=False):
                    leg = self._new_leg(o, d, tt, typ, ac.tail)
                    cycle.append(leg)
                    tt = leg.sta + (self._turn(typ, d) if d != base else 0)
                    if leg.sta > limit:
                        ok = False
                        break
                if not ok:
                    self._fno -= len(cycle)  # give the numbers back
                    if len(route) == 4:      # retry once as a simple out-and-back
                        route = [base, a, base]
                        tt, cycle, ok = t, [], True
                        for o, d in zip(route, route[1:], strict=False):
                            leg = self._new_leg(o, d, tt, typ, ac.tail)
                            cycle.append(leg)
                            tt = leg.sta + (self._turn(typ, d) if d != base else 0)
                            if leg.sta > limit:
                                ok = False
                                break
                        if not ok:
                            self._fno -= len(cycle)
                            break
                    else:
                        break
                legs.extend(cycle)
                block_total += sum(leg.block_min for leg in cycle)
                t = cycle[-1].sta + self._turn(typ, base)
                if block_total >= target_block:
                    break
            if len(legs) < 2:  # guarantee a minimal rotation
                self._fno = max(self._fno, 2000)
                a = self._pick_dest(base, typ, exclude=set()) or self.hub_codes[0]
                if a == base:
                    a = self.spoke_codes[0] if self.spoke_codes else self.hub_codes[-1]
                l1 = self._new_leg(base, a, t, typ, ac.tail)
                l2 = self._new_leg(a, base, l1.sta + self._turn(typ, a), typ, ac.tail)
                legs = [l1, l2]
            self.flights.extend(legs)
        self.flights.sort(key=lambda f: (f.std, f.id))

    # ---- demand & itineraries
    def build_demand(self) -> None:
        p, rng = self.p, self.rng
        flights = self.flights
        by_id = {f.id: f for f in flights}
        a, b = p.load_factor_beta
        lo, hi = p.load_factor_bounds
        target: dict[str, int] = {}
        for f in flights:
            lf = float(np.clip(rng.beta(a, b), lo, hi))
            target[f.id] = max(1, int(round(lf * f.seats)))
        allocated: dict[str, int] = {f.id: 0 for f in flights}
        connecting: dict[str, int] = {f.id: 0 for f in flights}
        partner: dict[str, int] = {f.id: 0 for f in flights}
        itins: list[Itinerary] = []
        n = 0
        mct = {ap.code: ap.min_connection_time_min for ap in self.airports}
        # connecting itineraries at hubs
        for hub in self.hub_codes:
            arrivals = sorted((f for f in flights if f.dest == hub), key=lambda f: f.sta)
            departures = sorted((f for f in flights if f.origin == hub), key=lambda f: f.std)
            for f1 in arrivals:
                share = rng.uniform(*p.connecting_share)
                want = min(int(round(share * target[f1.id])), target[f1.id] - allocated[f1.id])
                if want <= 0:
                    continue
                earliest = f1.sta + mct[hub]
                latest = earliest + p.max_connection_wait_min
                cands = [f2 for f2 in departures
                         if earliest <= f2.std <= latest and f2.dest != f1.origin and f2.tail != f1.tail
                         and target[f2.id] - allocated[f2.id] > 0]
                if not cands:
                    continue
                rng.shuffle(cands)
                for f2 in cands[:3]:
                    if want <= 0:
                        break
                    room = target[f2.id] - allocated[f2.id]
                    chunk = int(min(want, room, max(1, int(rng.integers(5, 40)))))
                    if chunk <= 0:
                        continue
                    n += 1
                    itins.append(Itinerary(id=f"I{n:05d}", legs=[f1.id, f2.id], pax_count=chunk, category="connecting"))
                    for fid in (f1.id, f2.id):
                        allocated[fid] += chunk
                        connecting[fid] += chunk
                    want -= chunk
        # partner (codeshare/interline) itineraries in the evening hub bank
        for f in flights:
            if f.origin in self.hub_codes and p.partner_bank[0] <= f.std <= p.partner_bank[1]:
                share = rng.uniform(*p.partner_share)
                chunk = min(int(round(share * target[f.id])), target[f.id] - allocated[f.id])
                if chunk > 0:
                    n += 1
                    itins.append(Itinerary(id=f"I{n:05d}", legs=[f.id], pax_count=chunk, category="partner"))
                    allocated[f.id] += chunk
                    partner[f.id] += chunk
        # local itineraries fill the rest
        for f in flights:
            rest = target[f.id] - allocated[f.id]
            if rest > 0:
                n += 1
                itins.append(Itinerary(id=f"I{n:05d}", legs=[f.id], pax_count=rest, category="local"))
                allocated[f.id] += rest
        # write bookings
        new_flights: list[Flight] = []
        for f in flights:
            booked = allocated[f.id]
            hv = int(round(rng.uniform(*p.high_value_share) * booked))
            sa = int(min(booked, rng.poisson(p.special_assistance_lambda)))
            new_flights.append(f.model_copy(update={
                "booked_pax": booked,
                "pax_connecting": connecting[f.id],
                "pax_partner": partner[f.id],
                "pax_high_value": hv,
                "pax_special_assistance": sa,
            }))
        self.flights = new_flights
        self.itineraries = itins
        _ = by_id

    # ---- crew
    def build_crews(self) -> None:
        p, rng = self.p, self.rng
        rot: dict[str, list[Flight]] = {}
        for f in self.flights:
            rot.setdefault(f.tail or "", []).append(f)
        for legs in rot.values():
            legs.sort(key=lambda x: x.std)
        crew_of: dict[str, str] = {}
        cid = 0
        for tail, legs in rot.items():
            typ_code = legs[0].aircraft_type
            ratings = RATING_GROUPS[typ_code]
            i = 0
            while i < len(legs):
                max_legs = int(rng.integers(p.pairing_legs[0], p.pairing_legs[1] + 1))
                report = legs[i].std - p.report_before_std_min
                pairing: list[Flight] = []
                j = i
                while j < len(legs) and len(pairing) < max_legs and len(pairing) < DEFAULT_MAX_SECTORS:
                    cand = legs[j]
                    limit = fdp_limit(report, len(pairing) + 1)
                    if cand.sta + p.post_flight_duty_min - report > limit:
                        break
                    pairing.append(cand)
                    j += 1
                    # prefer to end pairings at hubs once the minimum length is reached
                    if len(pairing) >= p.pairing_legs[0] and cand.dest in self.hub_codes and rng.random() < 0.5:
                        break
                if not pairing:  # first leg alone exceeds FDP (very long sector); still assign it
                    pairing = [legs[i]]
                    j = i + 1
                cid += 1
                crew_id = f"C{cid:04d}"
                quals = ["CAT3"] if rng.random() < p.cat3_share else []
                self.crews.append(Crew(
                    id=crew_id,
                    base=self.aircraft_base(tail),
                    type_ratings=list(ratings),
                    special_quals=quals,
                    duty_start=report,
                    fdp_limit_min=fdp_limit(report, len(pairing)),
                    flight_time_today_min=0,
                    flight_time_week_min=int(rng.integers(*p.week_flight_time_prior)),
                    rest_until=0,
                    location=pairing[0].origin,
                    pairing=[leg.id for leg in pairing],
                ))
                for leg in pairing:
                    crew_of[leg.id] = crew_id
                i = j
        self.flights = [f.model_copy(update={"crew_id": crew_of.get(f.id)}) for f in self.flights]
        # standby pool per hub
        for hub in self.hub_codes:
            n_sb = int(rng.integers(p.standby_per_hub[0], p.standby_per_hub[1] + 1))
            for k in range(n_sb):
                cid += 1
                ratings = RATING_GROUPS["ATR72"] if ("ATR72" in self.types and k == n_sb - 1 and n_sb > 1) else RATING_GROUPS["A320"]
                if "A320" not in self.types and "A321" not in self.types:
                    ratings = RATING_GROUPS["ATR72"]
                self.crews.append(Crew(
                    id=f"C{cid:04d}", base=hub, type_ratings=list(ratings),
                    special_quals=["CAT3"] if rng.random() < p.cat3_share else [],
                    duty_start=None, fdp_limit_min=fdp_limit(600, 2),
                    flight_time_week_min=int(rng.integers(*p.week_flight_time_prior)),
                    location=hub, pairing=[], is_standby=True,
                    callout_min=int(rng.integers(p.standby_callout[0], p.standby_callout[1] + 1)),
                ))

    def aircraft_base(self, tail: str) -> str:
        for a in self.aircraft:
            if a.tail == tail:
                return a.location or self.hub_codes[0]
        return self.hub_codes[0]

    def instance(self) -> Instance:
        p = self.p
        return Instance(
            name=f"synthetic-{p.size}-seed{p.seed}",
            size=p.size,
            seed=p.seed,
            day_start=p.day_start,
            airports=self.airports,
            aircraft_types=list(self.types.values()),
            aircraft=self.aircraft,
            flights=self.flights,
            crews=self.crews,
            itineraries=self.itineraries,
            disruptions=[],
            metadata={
                "generator_version": GENERATOR_VERSION,
                "params": {k: (list(v) if isinstance(v, tuple) else v) for k, v in vars(p).items() if k != "day_start"},
                "hubs": self.hub_codes,
                "spokes": self.spoke_codes,
                "note": "Synthetic IndiGo-like network. Distances approximate; weights are placeholders (Plan §16).",
            },
        )


def generate(params: GeneratorParams | None = None) -> Instance:
    g = _Gen(params or GeneratorParams())
    g.build_airports()
    g.build_fleet()
    g.build_schedule()
    g.build_demand()
    g.build_crews()
    return g.instance()


def generate_size(size: str, seed: int = 1, **overrides: Any) -> Instance:
    return generate(GeneratorParams.for_size(size, seed, **overrides))
