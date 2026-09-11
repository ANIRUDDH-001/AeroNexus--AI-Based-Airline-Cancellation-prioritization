"""Metrics namespace produced by the simulator and consumed by objective expressions (Plan §10).

Every name listed here is guaranteed to exist (default 0) so that expressions can be validated with a
dry run before they are saved. Phase 1 fills these from the simulator; Phase 0 only defines the contract.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from typing import Any


@dataclass
class Metrics:
    # L1 network
    forced_downstream_cancellations: float = 0
    propagated_delay_min: float = 0
    next_wave_shortfall: float = 0
    # L2 passenger
    pax_cancelled: float = 0
    pax_reprotect_delay_hours: float = 0
    pax_stranded_overnight: float = 0
    misconnects: float = 0
    special_assistance_affected: float = 0
    high_value_affected: float = 0
    partner_pax_affected: float = 0
    pax_reprotected_within_4h: float = 0
    pax_reprotected_same_day: float = 0
    # L3 cost
    compensation_inr: float = 0
    crew_standby_used: float = 0
    crew_out_of_position: float = 0
    swaps: float = 0
    cancellations: float = 0
    delays: float = 0
    total_delay_min: float = 0
    # L4 robustness
    buffer_consumed_min: float = 0
    tail_risk_penalty: float = 0
    # bookkeeping
    affected_flights: list[str] = field(default_factory=list)

    def as_namespace(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def names(cls) -> list[str]:
        return [f.name for f in fields(cls) if f.name != "affected_flights"]

    @classmethod
    def sample(cls) -> dict[str, Any]:
        """A namespace with every metric = 1.0, used for expression dry runs."""
        d = {n: 1.0 for n in cls.names()}
        d["affected_flights"] = []
        return d
