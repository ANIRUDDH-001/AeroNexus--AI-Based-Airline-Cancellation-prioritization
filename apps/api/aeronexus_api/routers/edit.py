"""Instance editing (Plan §15.2, §18.2 page 4): database-style tables, attribute edits, "add a column"
(registers a parameter and seeds every row), and disruption injection/removal. Every edit is a full
replace of the stored instance so a run always snapshots exactly what it saw."""
from __future__ import annotations

from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError

from aeronexus_core.config import ParameterDef
from aeronexus_core.model import Aircraft, Airport, Crew, Disruption, Flight, Instance, Itinerary
from aeronexus_core.validate import validate_instance
from aeronexus_datagen.disruptions import inject, parse_spec

from .. import storage
from ..auth import require_write_key

router = APIRouter(prefix="/data/instances/{iid}", tags=["edit"])
write = APIRouter(prefix="/data/instances/{iid}", tags=["edit"], dependencies=[Depends(require_write_key)])

Entity = Literal["flights", "aircraft", "crews", "airports", "itineraries"]
_KEY = {"flights": "id", "aircraft": "tail", "crews": "id", "airports": "code", "itineraries": "id"}
_SCOPE = {"flights": "flight", "aircraft": "aircraft", "crews": "crew", "airports": "airport", "itineraries": "itinerary"}


def _load(iid: str) -> Instance:
    inst = storage.get_instance(iid)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    return inst


def _store(iid: str, inst: Instance) -> dict:
    issues = validate_instance(inst)
    storage.replace_instance(iid, inst)
    return {"id": iid, "summary": inst.summary(), "issues": issues}


@router.get("/table/{entity}")
def table(iid: str, entity: Entity) -> dict:
    """Rows with attributes flattened (prefixed ``attr:``) plus the column list, for the database-style UI."""
    return build_table(_load(iid), entity)


def build_table(inst: Instance, entity: Entity) -> dict:
    rows = getattr(inst, entity)
    out = []
    attr_cols: set[str] = set()
    for r in rows:
        d = r.model_dump()
        attrs = d.pop("attributes", {}) or {}
        for k, v in attrs.items():
            d[f"attr:{k}"] = v
            attr_cols.add(k)
        out.append(d)
    core_cols = [c for c in (rows[0].model_dump().keys() if rows else []) if c != "attributes"]
    return {"entity": entity, "key": _KEY[entity], "columns": core_cols, "attribute_columns": sorted(attr_cols), "rows": out}


class PatchRequest(BaseModel):
    fields: dict[str, Any] = Field(default_factory=dict)      # core field updates
    attributes: dict[str, Any] = Field(default_factory=dict)  # merged into attributes
    remove_attributes: list[str] = Field(default_factory=list)


@write.patch("/{entity}/{key}")
def patch_row(iid: str, entity: Entity, key: str, req: PatchRequest) -> dict:
    inst = _load(iid)
    rows = list(getattr(inst, entity))
    kf = _KEY[entity]
    idx = next((i for i, r in enumerate(rows) if getattr(r, kf) == key), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"{entity[:-1]} {key} not found")
    row = rows[idx]
    attrs = dict(row.attributes)
    attrs.update(req.attributes)
    for k in req.remove_attributes:
        attrs.pop(k, None)
    try:
        new = row.model_copy(update={**req.fields, "attributes": attrs})
        new = type(row).model_validate(new.model_dump())
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    rows[idx] = new
    return _store(iid, inst.model_copy(update={entity: rows}))


class ColumnRequest(BaseModel):
    entity: Entity
    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    type: Literal["number", "bool", "text"] = "number"
    default: Any = 0
    description: str = ""


@write.post("/columns")
def add_column(iid: str, req: ColumnRequest) -> dict:
    core = {"flights": Flight, "aircraft": Aircraft, "crews": Crew, "airports": Airport, "itineraries": Itinerary}[req.entity]
    if req.name in core.model_fields:
        raise HTTPException(status_code=422, detail=f"'{req.name}' is a core column of {req.entity}; choose another name")
    """The §15.2 flow: add a column -> every row gets the default in ``attributes`` -> a parameter is
    registered (scope = entity) so score terms and rules can reference it immediately."""
    inst = _load(iid)
    rows = [r.model_copy(update={"attributes": {**r.attributes, req.name: r.attributes.get(req.name, req.default)}})
            for r in getattr(inst, req.entity)]
    result = _store(iid, inst.model_copy(update={req.entity: rows}))
    cfg, _ = storage.get_config()
    if not any(p.name == req.name for p in cfg.parameters):
        params = [*cfg.parameters, ParameterDef(name=req.name, type=req.type, scope=_SCOPE[req.entity],  # type: ignore[arg-type]
                                                default=req.default, description=req.description, source="column")]
        row = storage.put_config(cfg.model_copy(update={"parameters": params}))
        result["config_version"] = row.version
        result["config_hash"] = row.hash
    return result


class DisruptionRequest(BaseModel):
    spec: str | None = Field(default=None, description="CLI-style spec, e.g. fog:DEL:300:240:0.4")
    disruption: Disruption | None = None


@write.post("/disruptions")
def add_disruption(iid: str, req: DisruptionRequest) -> dict:
    inst = _load(iid)
    if req.disruption is not None:
        d = req.disruption
    elif req.spec:
        try:
            d = parse_spec(req.spec, inst, np.random.default_rng(0))
        except (ValueError, IndexError) as e:
            raise HTTPException(status_code=422, detail=f"bad disruption spec: {e}") from e
    else:
        raise HTTPException(status_code=422, detail="spec or disruption required")
    if any(x.id == d.id for x in inst.disruptions):
        raise HTTPException(status_code=409, detail=f"disruption {d.id} already exists")
    return _store(iid, inject(inst, d))


@write.delete("/disruptions/{did}")
def remove_disruption(iid: str, did: str) -> dict:
    inst = _load(iid)
    keep = [d for d in inst.disruptions if d.id != did]
    if len(keep) == len(inst.disruptions):
        raise HTTPException(status_code=404, detail="disruption not found")
    removed = next(d for d in inst.disruptions if d.id == did)
    aircraft = inst.aircraft
    if removed.type == "AOG":
        aircraft = [a.model_copy(update={"status": "OK"}) if a.tail == removed.target else a for a in aircraft]
    return _store(iid, inst.model_copy(update={"disruptions": keep, "aircraft": aircraft}))
