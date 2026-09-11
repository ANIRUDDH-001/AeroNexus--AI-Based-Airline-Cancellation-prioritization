"""Structural validation of an Instance: is this a physically consistent operational day?

Used by the generator's tests, by CSV import, and before any recommendation run. Returns a list of
human-readable issues (empty = valid). These are *data* checks, not decision constraints (§8 does those).
"""
from __future__ import annotations

from .model import Instance


def validate_instance(inst: Instance, fdp_check: bool = True) -> list[str]:
    issues: list[str] = []
    ap = inst.airports_by_code
    types = inst.types_by_code
    tails = inst.aircraft_by_tail
    crews = inst.crews_by_id
    flights = inst.flights_by_id

    # ---- uniqueness
    for label, ids in (
        ("airport", [a.code for a in inst.airports]),
        ("aircraft", [a.tail for a in inst.aircraft]),
        ("flight", [f.id for f in inst.flights]),
        ("crew", [c.id for c in inst.crews]),
        ("itinerary", [i.id for i in inst.itineraries]),
    ):
        seen: set[str] = set()
        for x in ids:
            if x in seen:
                issues.append(f"duplicate {label} id {x}")
            seen.add(x)

    # ---- references
    for a in inst.aircraft:
        if a.type_code not in types:
            issues.append(f"aircraft {a.tail}: unknown type {a.type_code}")
        if a.location and a.location not in ap:
            issues.append(f"aircraft {a.tail}: unknown location {a.location}")
    for f in inst.flights:
        if f.origin not in ap:
            issues.append(f"flight {f.id}: unknown origin {f.origin}")
        if f.dest not in ap:
            issues.append(f"flight {f.id}: unknown dest {f.dest}")
        if f.aircraft_type not in types:
            issues.append(f"flight {f.id}: unknown aircraft type {f.aircraft_type}")
        if f.tail and f.tail not in tails:
            issues.append(f"flight {f.id}: unknown tail {f.tail}")
        if f.tail and f.tail in tails and tails[f.tail].type_code != f.aircraft_type:
            issues.append(f"flight {f.id}: tail {f.tail} is {tails[f.tail].type_code}, flight needs {f.aircraft_type}")
        if f.crew_id and f.crew_id not in crews:
            issues.append(f"flight {f.id}: unknown crew {f.crew_id}")
        if f.aircraft_type in types and f.seats != types[f.aircraft_type].seats:
            issues.append(f"flight {f.id}: seats {f.seats} != type seats {types[f.aircraft_type].seats}")

    # ---- rotations: continuity, turnaround, start location
    for tail, legs in inst.rotations().items():
        ac = tails.get(tail)
        if ac is None:
            continue
        typ = types.get(ac.type_code)
        if ac.location and legs and legs[0].origin != ac.location:
            issues.append(f"tail {tail}: first leg departs {legs[0].origin} but aircraft is at {ac.location}")
        for prev, nxt in zip(legs, legs[1:], strict=False):
            if prev.dest != nxt.origin:
                issues.append(f"tail {tail}: {prev.id} arrives {prev.dest} but {nxt.id} departs {nxt.origin}")
            if typ is not None:
                is_hub = ap[prev.dest].is_hub if prev.dest in ap else False
                gap = nxt.std - prev.sta
                need = typ.turnaround(is_hub)
                if gap < need:
                    issues.append(f"tail {tail}: turnaround {gap} min < {need} min between {prev.id} and {nxt.id}")

    # ---- crews: pairing continuity, location, FDP
    for c in inst.crews:
        if c.base not in ap:
            issues.append(f"crew {c.id}: unknown base {c.base}")
        if c.location not in ap:
            issues.append(f"crew {c.id}: unknown location {c.location}")
        legs = [flights[fid] for fid in c.pairing if fid in flights]
        if len(legs) != len(c.pairing):
            issues.append(f"crew {c.id}: pairing references unknown flights")
            continue
        for leg in legs:
            if leg.crew_id != c.id:
                issues.append(f"crew {c.id}: pairing includes {leg.id} but flight has crew {leg.crew_id}")
            if leg.aircraft_type not in c.type_ratings:
                issues.append(f"crew {c.id}: not rated for {leg.aircraft_type} on {leg.id}")
        if legs and not c.is_standby and legs[0].origin != c.location:
            issues.append(f"crew {c.id}: first leg departs {legs[0].origin} but crew is at {c.location}")
        for prev, nxt in zip(legs, legs[1:], strict=False):
            if prev.dest != nxt.origin:
                issues.append(f"crew {c.id}: {prev.id} arrives {prev.dest} but {nxt.id} departs {nxt.origin}")
            if nxt.std < prev.sta:
                issues.append(f"crew {c.id}: {nxt.id} departs before {prev.id} arrives")
        if fdp_check and legs and c.duty_start is not None:
            duty = legs[-1].sta - c.duty_start
            if duty > c.fdp_limit_min:
                issues.append(f"crew {c.id}: planned duty {duty} min exceeds FDP limit {c.fdp_limit_min}")
    for f in inst.flights:
        if f.tail and not f.crew_id:
            issues.append(f"flight {f.id}: has a tail but no crew")

    # ---- itineraries: legs exist, connect, MCT; pax add up to booked
    booked_from_itins: dict[str, int] = {f.id: 0 for f in inst.flights}
    connecting_from_itins: dict[str, int] = {f.id: 0 for f in inst.flights}
    for it in inst.itineraries:
        legs = [flights.get(fid) for fid in it.legs]
        if any(leg is None for leg in legs):
            issues.append(f"itinerary {it.id}: unknown flight in legs {it.legs}")
            continue
        for leg in legs:
            assert leg is not None
            booked_from_itins[leg.id] += it.pax_count
        if len(legs) > 1:
            for leg in legs:
                assert leg is not None
                connecting_from_itins[leg.id] += it.pax_count
        for prev, nxt in zip(legs, legs[1:], strict=False):
            assert prev is not None and nxt is not None
            if prev.dest != nxt.origin:
                issues.append(f"itinerary {it.id}: {prev.id} arrives {prev.dest}, {nxt.id} departs {nxt.origin}")
            mct = ap[prev.dest].min_connection_time_min if prev.dest in ap else 0
            if nxt.std < prev.sta + mct:
                issues.append(f"itinerary {it.id}: connection {prev.id}->{nxt.id} below MCT ({nxt.std - prev.sta} < {mct})")
    for f in inst.flights:
        if booked_from_itins[f.id] != f.booked_pax:
            issues.append(f"flight {f.id}: itineraries sum to {booked_from_itins[f.id]} pax but booked_pax={f.booked_pax}")
        if connecting_from_itins[f.id] != f.pax_connecting:
            issues.append(
                f"flight {f.id}: connecting itineraries sum to {connecting_from_itins[f.id]} but pax_connecting={f.pax_connecting}"
            )

    # ---- disruptions reference something real
    for d in inst.disruptions:
        ok = d.target in ap or d.target in tails or d.target in flights or d.target in crews
        if not ok:
            issues.append(f"disruption {d.id}: unknown target {d.target}")
    return issues
