"""Configuration registries (Plan §15, §19). Every PUT bumps the version and recomputes config_hash."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError

from aeronexus_core.config import (
    ConstraintDef,
    EngineConfig,
    ObjectiveTerm,
    ParameterDef,
    SearchSettings,
    config_hash,
    load_config,
)
from aeronexus_core.constraints import available_plugins
from aeronexus_core.scoring import Metrics, validate_terms

from .. import settings, storage
from ..auth import require_write_key

router = APIRouter(prefix="/config", tags=["config"])
write = APIRouter(prefix="/config", tags=["config"], dependencies=[Depends(require_write_key)])


class ConfigEnvelope(BaseModel):
    version: int
    hash: str
    updated_at: str
    config: EngineConfig


def _envelope(cfg: EngineConfig, row: storage.ConfigRow) -> ConfigEnvelope:
    return ConfigEnvelope(version=row.version, hash=row.hash, updated_at=row.updated_at, config=cfg)


@router.get("", response_model=ConfigEnvelope)
def get_config() -> ConfigEnvelope:
    cfg, row = storage.get_config()
    return _envelope(cfg, row)


@router.get("/hash")
def get_hash() -> dict:
    cfg, row = storage.get_config()
    return {"hash": row.hash, "version": row.version}


@router.get("/plugins")
def plugins() -> dict:
    return {pid: {"phase": cls.phase} for pid, cls in available_plugins().items()}


@router.get("/metrics")
def metric_names() -> dict:
    return {"metrics": Metrics.names()}


def _replace(cfg: EngineConfig, **fields) -> ConfigEnvelope:
    try:
        new = cfg.model_copy(update=fields)
        new = EngineConfig.model_validate(new.model_dump())
    except (ValidationError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    problems = validate_terms(new.objective_terms, new)
    if problems:
        raise HTTPException(status_code=422, detail={"objective_terms": problems})
    row = storage.put_config(new)
    return _envelope(new, row)


@write.put("/terms", response_model=ConfigEnvelope)
def put_terms(terms: list[ObjectiveTerm]) -> ConfigEnvelope:
    cfg, _ = storage.get_config()
    return _replace(cfg, objective_terms=terms)


@write.put("/constraints", response_model=ConfigEnvelope)
def put_constraints(constraints: list[ConstraintDef]) -> ConfigEnvelope:
    cfg, _ = storage.get_config()
    return _replace(cfg, constraints=constraints)


@write.put("/parameters", response_model=ConfigEnvelope)
def put_parameters(parameters: list[ParameterDef]) -> ConfigEnvelope:
    cfg, _ = storage.get_config()
    return _replace(cfg, parameters=parameters)


@write.put("/search", response_model=ConfigEnvelope)
def put_search(search: SearchSettings) -> ConfigEnvelope:
    cfg, _ = storage.get_config()
    return _replace(cfg, search=search)


class ValidateRequest(BaseModel):
    terms: list[ObjectiveTerm] | None = None
    constraints: list[ConstraintDef] | None = None


@router.post("/validate")
def validate(req: ValidateRequest) -> dict:
    """Dry-run terms/constraints against a sample namespace without saving (§15.3)."""
    cfg, _ = storage.get_config()
    out: dict = {"ok": True, "problems": {}}
    if req.terms is not None:
        p = validate_terms(req.terms, cfg)
        if p:
            out["ok"] = False
            out["problems"]["objective_terms"] = p
    if req.constraints is not None:
        try:
            for c in req.constraints:
                ConstraintDef.model_validate(c.model_dump())
        except (ValidationError, ValueError) as e:
            out["ok"] = False
            out["problems"]["constraints"] = str(e)
    return out


@write.post("/presets/{name}", response_model=ConfigEnvelope)
def save_preset(name: str) -> ConfigEnvelope:
    cfg, _ = storage.get_config()
    row = storage.put_config(cfg.model_copy(update={"preset_name": name}), cid=name)
    return _envelope(cfg, row)


@router.get("/presets")
def presets() -> list[dict]:
    return storage.list_presets()


@write.post("/presets/{name}/load", response_model=ConfigEnvelope)
def load_preset(name: str) -> ConfigEnvelope:
    try:
        cfg, _ = storage.get_config(name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"preset {name!r} not found") from None
    row = storage.put_config(cfg)
    return _envelope(cfg, row)


@write.post("/reset", response_model=ConfigEnvelope)
def reset_from_yaml() -> ConfigEnvelope:
    """Reload the YAML registries from disk (developer convenience)."""
    cfg = load_config(settings.CONFIG_DIR)
    row = storage.put_config(cfg)
    assert row.hash == config_hash(cfg)
    return _envelope(cfg, row)
