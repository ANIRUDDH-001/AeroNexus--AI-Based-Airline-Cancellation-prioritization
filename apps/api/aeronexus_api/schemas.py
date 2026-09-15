"""Response models for the endpoints that used to return untyped dicts.

They exist so the OpenAPI document describes every payload the console consumes and the console's TypeScript
types can be generated from it (spec §10.3). Payloads are unchanged: each model mirrors the dict the endpoint
already built, so a missing or renamed key becomes a validation error here instead of a runtime surprise in the UI.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from aeronexus_core.model import Disruption
from aeronexus_core.simulator.engine import LegStatus


class NarrationStatus(BaseModel):
    mode: str
    model: str | None = None
    calls: int = 0
    accepted: int = 0
    rejected: int = 0
    failed: int = 0
    last_error: str | None = None


class HealthOut(BaseModel):
    status: str
    engine_version: str
    config_hash: str
    config_version: int
    narration_enabled: bool
    narration: NarrationStatus
    write_key_required: bool


class InstanceRowOut(BaseModel):
    id: str
    name: str
    size: str
    seed: int | None = None
    created_at: str
    summary: dict[str, Any]


class DeletedOut(BaseModel):
    deleted: str


class TimelineFlightOut(BaseModel):
    id: str
    number: str
    origin: str
    dest: str
    std: int
    sta: int
    std_hhmm: str
    sta_hhmm: str
    tail: str | None = None
    crew_id: str | None = None
    aircraft_type: str
    booked_pax: int
    pax_connecting: int
    status: LegStatus
    dep: int | None = None
    arr: int | None = None
    delay_min: int
    reason: str | None = None
    standby_called: bool
    at_risk: bool
    risk_reasons: list[str] = Field(default_factory=list)
    protected: bool = False


class AtRiskOut(BaseModel):
    flight: str
    reasons: list[str]
    delay_min: int = 0
    forced: bool = False


class CommittedOut(BaseModel):
    cancelled: list[str]
    delays: dict[str, int]
    swaps: list[str]
    tail_override: dict[str, str]
    labels: list[str]
    count: int


class TimelineSummaryOut(BaseModel):
    flights: int
    at_risk: int
    forced_cancellations: int
    delayed_flights: int
    total_delay_min: int
    misconnects: int
    stranded_overnight: int
    standby_used: int
    aircraft_available: int
    standby_crews: int


class TimelineOut(BaseModel):
    instance_id: str
    clock: int
    clock_hhmm: str
    flights: list[TimelineFlightOut]
    rotations: dict[str, list[str]]
    disruptions: list[Disruption]
    committed: CommittedOut
    at_risk: list[AtRiskOut]
    summary: TimelineSummaryOut


class RunRowOut(BaseModel):
    id: str
    created_at: str
    instance_id: str
    decision_time: int
    config_hash: str
    engine_version: str
    accepted_plan: int | None = None
    override_reason: str | None = None
    latency_ms: float | None = None
    top_plan: list[str]
    top_nis: float | None = None
    at_risk: int
    plans_evaluated: int | None = None
    instance_hash: str | None = None
    effective: dict[str, Any] = Field(default_factory=dict)


class MetricsOut(BaseModel):
    metrics: list[str]


class PresetRowOut(BaseModel):
    name: str
    version: int
    hash: str
    updated_at: str


# ---------------------------------------------------------------- validation (cases, benchmark)


class CaseDefOut(BaseModel):
    id: str
    title: str
    rationale: str = ""
    base: str = "tiny"
    disruptions: list[str] = Field(default_factory=list)
    decision_time: int = 0
    expected: list[str] = Field(default_factory=list)


class CasePlanOut(BaseModel):
    rank: int | None = None
    actions: list[str] = Field(default_factory=list)
    nis: float


class CaseExcludedOut(BaseModel):
    key: str
    reasons: list[str] = Field(default_factory=list)


class CaseResultOut(BaseModel):
    id: str
    title: str
    passed: bool
    top1: list[str] = Field(default_factory=list)
    expected: list[str] = Field(default_factory=list)
    matched: str
    checks: list[str] = Field(default_factory=list)
    failures: list[str] = Field(default_factory=list)
    latency_ms: float = 0.0
    nis: float | None = None
    baseline_forced: float | None = None
    plan_forced: float | None = None
    rationale: str = ""
    top_reasons: list[str] = Field(default_factory=list)
    plans: list[CasePlanOut] = Field(default_factory=list)
    excluded: list[CaseExcludedOut] = Field(default_factory=list)
    plans_evaluated: int = 0


class CasesRunOut(BaseModel):
    config_hash: str
    config_version: int
    use_surrogate: bool
    passed: int
    total: int
    elapsed_ms: float
    results: list[CaseResultOut]


class PolicySummaryOut(BaseModel):
    nis_mean: float
    nis_p90_mean: float
    forced_mean: float
    pax_cancelled_mean: float
    pax_stranded_mean: float
    misconnects_mean: float
    delay_min_mean: float
    win_rate_vs_B0: float
    tie_rate_vs_B0: float
    improvement_vs_B0_pct: float
    latency_ms_mean: float
    latency_ms_p95: float


class PolicyOutcomeOut(BaseModel):
    nis_mean: float
    nis_p90: float
    forced: float
    pax_cancelled: float
    pax_stranded: float
    misconnects: float
    delay_min: float
    latency_ms: float
    actions: list[str] = Field(default_factory=list)


class BenchmarkRecordOut(BaseModel):
    name: str
    size: str
    disruption: str
    clock: int
    at_risk: int
    baseline_forced: float
    policies: dict[str, PolicyOutcomeOut]


class BenchmarkOut(BaseModel):
    created_at: str
    config_hash: str
    current_config_hash: str
    stale: bool
    scenarios: int
    s_eval: int
    block_sigma: float | None = None
    seed: int | None = None
    summary: dict[str, PolicySummaryOut]
    records: list[BenchmarkRecordOut]


class TableOut(BaseModel):
    entity: str
    key: str
    columns: list[str]
    attribute_columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]]
