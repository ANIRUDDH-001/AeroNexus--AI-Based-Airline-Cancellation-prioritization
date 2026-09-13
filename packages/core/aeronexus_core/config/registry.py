"""Configuration registries (Plan §15.1).

Four registries make the engine configurable without code changes:

* ``parameters``       – named values with scope (flight / crew / airport / global) and defaults
* ``objective_terms``  – Network Impact Score terms: level, expression, weight
* ``constraints``      – hard rules: builtin plugin id + its config, or a user expression
* ``search``           – beam/scenario/latency settings and ranking mode

``config_hash`` is a SHA-256 over the *effective* configuration with descriptive text stripped, so a
comment edit does not change the hash but any change that could alter a recommendation does (P1, D2).
Every run stores this hash.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

ParameterType = Literal["number", "bool", "enum", "text"]
ParameterScope = Literal["flight", "aircraft", "crew", "airport", "itinerary", "global"]
ObjectiveLevel = Literal["L1", "L2", "L3", "L4"]
ConstraintKind = Literal["builtin", "expression"]
RankingMode = Literal["composite", "priority"]
CandidateScope = Literal["at_risk_only", "at_risk_plus_neighbours"]

# Keys that never influence a result and are therefore excluded from the hash.
_NON_SEMANTIC_KEYS = {"description", "unit", "label", "notes", "source"}


class ParameterDef(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    type: ParameterType = "number"
    scope: ParameterScope = "global"
    default: Any = 0
    unit: str | None = None
    description: str = ""
    source: Literal["column", "user", "builtin"] = "user"
    choices: list[str] | None = None  # for enum

    @model_validator(mode="after")
    def _enum_has_choices(self) -> ParameterDef:
        if self.type == "enum" and not self.choices:
            raise ValueError(f"parameter {self.name}: enum needs choices")
        return self


class ObjectiveTerm(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    level: ObjectiveLevel
    expression: str
    weight: float = Field(ge=0)
    enabled: bool = True
    description: str = ""

    @field_validator("expression")
    @classmethod
    def _parses(cls, v: str) -> str:
        from ..expressions import compile_expression  # local import to avoid cycles

        compile_expression(v)
        return v.strip()


class ConstraintDef(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_]*$")
    name: str
    kind: ConstraintKind = "builtin"
    plugin: str | None = None  # builtin plugin id, e.g. "aircraft_continuity"
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    severity: Literal["hard"] = "hard"
    description: str = ""

    @model_validator(mode="after")
    def _kind_fields(self) -> ConstraintDef:
        if self.kind == "builtin" and not self.plugin:
            raise ValueError(f"constraint {self.id}: builtin needs a plugin id")
        if self.kind == "expression":
            from ..expressions import compile_expression

            expr = self.config.get("forbid_if")
            if not expr:
                raise ValueError(f"constraint {self.id}: expression constraint needs config.forbid_if")
            compile_expression(expr)
        return self


class SearchSettings(BaseModel):
    K: int = Field(default=5, ge=1, description="beam width")
    D: int = Field(default=3, ge=1, description="beam depth (actions per plan)")
    M: int = Field(default=12, ge=1, description="candidates kept after surrogate pre-rank")
    N: int = Field(default=8, ge=1, description="plans re-evaluated under scenarios")
    S: int = Field(default=10, ge=1, description="sampled scenarios per plan")
    latency_budget_ms: int = Field(default=5000, ge=100)
    hysteresis_pct: float = Field(default=5.0, ge=0)
    candidate_scope: CandidateScope = "at_risk_only"
    ranking_mode: RankingMode = "composite"
    level_tolerances: dict[ObjectiveLevel, float] = Field(
        default_factory=lambda: {"L1": 0.0, "L2": 0.05, "L3": 0.10, "L4": 0.10}
    )
    delay_steps_min: list[int] = Field(default_factory=lambda: [30, 60, 90, 120, 180])
    max_delay_min: int = Field(default=180, ge=0)
    horizon_hours: float = Field(default=8.0, gt=0)
    at_risk_delay_threshold_min: int = Field(default=45, ge=0)
    max_staleness_min: int = Field(default=30, ge=0, description="abstain if inputs older than this")
    top_n_returned: int = Field(default=3, ge=1)
    forced_cancel_delay_min: int = Field(default=300, ge=0, description="propagation: a leg that cannot depart within this delay is a forced cancellation")
    standby_hold_min: int = Field(default=120, ge=0, description="max extra wait for a standby crew call-out before the leg is forced-cancelled")
    post_flight_duty_min: int = Field(default=30, ge=0, description="duty minutes after final on-blocks counted inside the FDP")
    deterministic: bool = Field(default=False, description="audit mode: never trade samples or depth for latency, so the same inputs always give the same answer (excluded from the config hash)")


class EngineConfig(BaseModel):
    parameters: list[ParameterDef] = Field(default_factory=list)
    objective_terms: list[ObjectiveTerm] = Field(default_factory=list)
    constraints: list[ConstraintDef] = Field(default_factory=list)
    search: SearchSettings = Field(default_factory=SearchSettings)
    preset_name: str = "default"

    @model_validator(mode="after")
    def _unique(self) -> EngineConfig:
        for label, items in (
            ("parameter", [p.name for p in self.parameters]),
            ("objective term", [t.name for t in self.objective_terms]),
            ("constraint", [c.id for c in self.constraints]),
        ):
            dupes = {x for x in items if items.count(x) > 1}
            if dupes:
                raise ValueError(f"duplicate {label} ids: {sorted(dupes)}")
        return self

    # ---- lookups
    def term(self, name: str) -> ObjectiveTerm:
        return next(t for t in self.objective_terms if t.name == name)

    def constraint(self, cid: str) -> ConstraintDef:
        return next(c for c in self.constraints if c.id == cid)

    def parameter(self, name: str) -> ParameterDef:
        return next(p for p in self.parameters if p.name == name)

    def parameter_values(self) -> dict[str, Any]:
        return {p.name: p.default for p in self.parameters}

    @property
    def hash(self) -> str:
        return config_hash(self)


# ---------------------------------------------------------------- hashing


def _strip(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in sorted(obj.items()) if k not in _NON_SEMANTIC_KEYS}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def canonical_json(config: EngineConfig) -> str:
    payload = config.model_dump(mode="json", exclude={"preset_name": True, "search": {"deterministic"}})
    return json.dumps(_strip(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def config_hash(config: EngineConfig) -> str:
    return hashlib.sha256(canonical_json(config).encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------- YAML IO


_FILES = {
    "parameters": "parameters.yaml",
    "objective_terms": "objective.yaml",
    "constraints": "constraints.yaml",
    "search": "search.yaml",
}


def load_config(config_dir: str | Path, preset: str | None = None) -> EngineConfig:
    """Load the four YAML registries from ``config_dir``. If ``preset`` is given, overlay
    ``config_dir/presets/<preset>.yaml`` (same top-level keys; whole-key replacement)."""
    d = Path(config_dir)
    raw: dict[str, Any] = {}
    for key, fname in _FILES.items():
        p = d / fname
        if p.exists():
            with p.open(encoding="utf-8") as fh:
                data = yaml.safe_load(fh) or {}
            raw[key] = data.get(key, data) if isinstance(data, dict) and key in data else data
    if preset:
        pp = d / "presets" / f"{preset}.yaml"
        if not pp.exists():
            raise FileNotFoundError(pp)
        with pp.open(encoding="utf-8") as fh:
            overlay = yaml.safe_load(fh) or {}
        for key in _FILES:
            if key in overlay:
                raw[key] = overlay[key]
        raw["preset_name"] = preset
    return EngineConfig.model_validate(raw)


def save_config(config: EngineConfig, config_dir: str | Path, as_preset: str | None = None) -> Path:
    """Write the config back as YAML. With ``as_preset`` writes a single presets/<name>.yaml file."""
    d = Path(config_dir)
    payload = config.model_dump(mode="json", exclude={"preset_name": True, "search": {"deterministic"}})
    if as_preset:
        d = d / "presets"
        d.mkdir(parents=True, exist_ok=True)
        out = d / f"{as_preset}.yaml"
        with out.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(payload, fh, sort_keys=False, allow_unicode=True)
        return out
    d.mkdir(parents=True, exist_ok=True)
    for key, fname in _FILES.items():
        with (d / fname).open("w", encoding="utf-8") as fh:
            yaml.safe_dump({key: payload[key]}, fh, sort_keys=False, allow_unicode=True)
    return d
