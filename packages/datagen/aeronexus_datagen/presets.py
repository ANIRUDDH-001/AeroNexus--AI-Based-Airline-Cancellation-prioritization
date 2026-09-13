"""Tiny hand-built network used by the exact-mechanics tests and the hand-crafted cases (Plan §17.1).

Network: DEL (hub), BOM (hub), JAI (spoke). Fleet: A320 only.
  T1: F1 DEL->JAI 06:00-07:00 | F2 JAI->DEL 07:30-08:30 | F3 DEL->BOM 09:15-11:15 | F4 BOM->DEL 12:00-14:00
  T2: F5 DEL->BOM 10:00-12:00 | F6 BOM->DEL 13:00-15:00          (spare seats for re-protection)
  T3: spare aircraft parked at DEL all day
Crews: C1 (F1, F2), C2 (F3, F4), C3 (F5, F6); standby S1 at DEL (A320, CAT3).
Itineraries: local on every flight; 20 connecting pax F2 -> F3.
All times in minutes from 00:00.
"""
from __future__ import annotations

from datetime import date

from aeronexus_core.model import (
    Aircraft,
    AircraftType,
    Airport,
    Crew,
    Flight,
    HourlyCapacity,
    Instance,
    Itinerary,
)

A320 = AircraftType(code="A320", seats=180, min_turnaround_min={"hub": 30, "spoke": 30}, cruise_kmh=760)


def flight(fid: str, o: str, d: str, std: int, block: int, tail: str, crew: str, booked: int, connecting: int = 0) -> Flight:
    return Flight(id=fid, number=fid, origin=o, dest=d, std=std, sta=std + block, block_min=block, aircraft_type="A320",
                  tail=tail, crew_id=crew, seats=180, booked_pax=booked, pax_connecting=connecting)


def tiny_instance(**overrides) -> Instance:
    airports = [
        Airport(code="DEL", name="Delhi", lat=28.55, lon=77.1, is_hub=True, slot_capacity_per_hour=HourlyCapacity(dep=30, arr=30),
                stand_capacity=40, min_connection_time_min=45),
        Airport(code="BOM", name="Mumbai", lat=19.09, lon=72.87, is_hub=True, slot_capacity_per_hour=HourlyCapacity(dep=30, arr=30),
                stand_capacity=40, min_connection_time_min=45),
        Airport(code="JAI", name="Jaipur", lat=26.82, lon=75.81, is_hub=False, slot_capacity_per_hour=HourlyCapacity(dep=10, arr=10),
                stand_capacity=8, min_connection_time_min=30),
    ]
    flights = [
        flight("F1", "DEL", "JAI", 360, 60, "T1", "C1", 100),
        flight("F2", "JAI", "DEL", 450, 60, "T1", "C1", 120, connecting=20),
        flight("F3", "DEL", "BOM", 555, 120, "T1", "C2", 150, connecting=20),
        flight("F4", "BOM", "DEL", 720, 120, "T1", "C2", 140),
        flight("F5", "DEL", "BOM", 600, 120, "T2", "C3", 100),
        flight("F6", "BOM", "DEL", 780, 120, "T2", "C3", 100),
    ]
    itins = [
        Itinerary(id="I1", legs=["F1"], pax_count=100),
        Itinerary(id="I2", legs=["F2"], pax_count=100),
        Itinerary(id="I23", legs=["F2", "F3"], pax_count=20, category="connecting"),
        Itinerary(id="I3", legs=["F3"], pax_count=130),
        Itinerary(id="I4", legs=["F4"], pax_count=140),
        Itinerary(id="I5", legs=["F5"], pax_count=100),
        Itinerary(id="I6", legs=["F6"], pax_count=100),
    ]
    crews = [
        Crew(id="C1", base="DEL", type_ratings=["A320"], special_quals=["CAT3"], duty_start=300, fdp_limit_min=780,
             location="DEL", pairing=["F1", "F2"]),
        Crew(id="C2", base="DEL", type_ratings=["A320"], special_quals=[], duty_start=495, fdp_limit_min=780,
             location="DEL", pairing=["F3", "F4"]),
        Crew(id="C3", base="DEL", type_ratings=["A320"], special_quals=["CAT3"], duty_start=540, fdp_limit_min=780,
             location="DEL", pairing=["F5", "F6"]),
        Crew(id="S1", base="DEL", type_ratings=["A320"], special_quals=["CAT3"], duty_start=None, fdp_limit_min=780,
             location="DEL", pairing=[], is_standby=True, callout_min=60),
    ]
    data = dict(
        name="tiny", size="custom", seed=0, day_start=date(2026, 12, 15), airports=airports, aircraft_types=[A320],
        aircraft=[Aircraft(tail="T1", type_code="A320", location="DEL"), Aircraft(tail="T2", type_code="A320", location="DEL"),
                  Aircraft(tail="T3", type_code="A320", location="DEL")],
        flights=flights, crews=crews, itineraries=itins, disruptions=[],
    )
    data.update(overrides)
    return Instance(**data)
