"""Disruption templates (Plan §16.2). Each helper returns a Disruption; ``inject`` adds them to an
instance (returning a copy). Uncertain end times carry an ``end_distribution`` the scenario sampler
(Phase 3 / faculty §12) draws from; ``end_nominal`` is the point estimate used by deterministic runs.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from aeronexus_core.model import Disruption, Instance


def _lognormal_end(start: int, mean_min: int, sigma: float = 0.4) -> dict[str, Any]:
    return {"dist": "lognormal", "mean_min": mean_min, "sigma": sigma, "anchor": start}


def airport_capacity_cut(airport: str, start: int, duration_min: int, capacity_fraction: float,
                         sigma: float = 0.4, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-CAP-{airport}-{start}", type="AIRPORT_CAPACITY", target=airport, start=start,
                      end_nominal=start + duration_min, end_distribution=_lognormal_end(start, duration_min, sigma),
                      severity={"capacity_fraction": capacity_fraction})


def lvp(airport: str, start: int, duration_min: int, capacity_fraction: float = 0.4, sigma: float = 0.5,
        did: str | None = None) -> Disruption:
    """Low-visibility procedures (Delhi fog): capacity drops and CAT-III becomes required."""
    return Disruption(id=did or f"D-LVP-{airport}-{start}", type="LVP", target=airport, start=start,
                      end_nominal=start + duration_min, end_distribution=_lognormal_end(start, duration_min, sigma),
                      severity={"capacity_fraction": capacity_fraction, "requires": ["CAT3"]})


def aog(tail: str, at: int, duration_min: int | None = None, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-AOG-{tail}-{at}", type="AOG", target=tail, start=at,
                      end_nominal=None if duration_min is None else at + duration_min,
                      end_distribution=None if duration_min is None else _lognormal_end(at, duration_min, 0.6),
                      severity={})


def crew_unavailable(base: str, n_crews: int, at: int, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-CREW-{base}-{at}", type="CREW_UNAVAILABLE", target=base, start=at,
                      severity={"n_crews": n_crews})


def atc_flow(airport: str, start: int, duration_min: int, rate_per_hour: int, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-ATC-{airport}-{start}", type="ATC_FLOW", target=airport, start=start,
                      end_nominal=start + duration_min, end_distribution=_lognormal_end(start, duration_min, 0.3),
                      severity={"rate_per_hour": rate_per_hour})


def flight_delay(flight_id: str, delay_min: int, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-DLY-{flight_id}", type="FLIGHT_DELAY", target=flight_id, start=0,
                      severity={"delay_min": delay_min})


def closure(airport: str, start: int, duration_min: int, did: str | None = None) -> Disruption:
    return Disruption(id=did or f"D-CLOSE-{airport}-{start}", type="CLOSURE", target=airport, start=start,
                      end_nominal=start + duration_min, end_distribution=_lognormal_end(start, duration_min, 0.3),
                      severity={})


def inject(inst: Instance, *disruptions: Disruption) -> Instance:
    """Return a copy of the instance with the disruptions added (and any matching AOG status applied)."""
    aircraft = list(inst.aircraft)
    for d in disruptions:
        if d.type == "AOG":
            aircraft = [a.model_copy(update={"status": "AOG"}) if a.tail == d.target else a for a in aircraft]
    return inst.model_copy(update={"disruptions": list(inst.disruptions) + list(disruptions), "aircraft": aircraft})


def parse_spec(spec: str, inst: Instance, rng: np.random.Generator | None = None) -> Disruption:
    """Parse a CLI spec like ``fog:DEL``, ``capacity:BOM:480:180:0.5``, ``aog:VT-IAB:600``, ``crew:DEL:3:420``,
    ``atc:BLR:540:120:12``, ``delay:6E2010:90``, ``closure:MAA:600:120``. Missing numbers get sensible defaults."""
    rng = rng or np.random.default_rng(0)
    parts = spec.split(":")
    kind = parts[0].lower()
    args = parts[1:]

    def num(i: int, default: float) -> float:
        return float(args[i]) if len(args) > i and args[i] != "" else default

    if kind in ("fog", "lvp"):
        return lvp(args[0], int(num(1, 300)), int(num(2, 240)), float(num(3, 0.4)))
    if kind == "capacity":
        return airport_capacity_cut(args[0], int(num(1, 480)), int(num(2, 180)), float(num(3, 0.5)))
    if kind == "aog":
        return aog(args[0], int(num(1, 540)), int(num(2, 0)) or None)
    if kind == "crew":
        return crew_unavailable(args[0], int(num(1, 3)), int(num(2, 420)))
    if kind == "atc":
        return atc_flow(args[0], int(num(1, 540)), int(num(2, 120)), int(num(3, 12)))
    if kind == "delay":
        return flight_delay(args[0], int(num(1, 90)))
    if kind == "closure":
        return closure(args[0], int(num(1, 600)), int(num(2, 120)))
    raise ValueError(f"unknown disruption kind {kind!r}")
