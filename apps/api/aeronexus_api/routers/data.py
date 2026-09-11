"""Data endpoints (Plan §19): generate, import, list, fetch, delete instances; state snapshot."""
from __future__ import annotations

from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aeronexus_core.model import Instance, State
from aeronexus_core.validate import validate_instance
from aeronexus_datagen import GeneratorParams, generate
from aeronexus_datagen.disruptions import inject, parse_spec

from .. import storage

router = APIRouter(tags=["data"])


class GenerateRequest(BaseModel):
    size: Literal["small", "medium", "large"] = "small"
    seed: int = 1
    disruptions: list[str] = Field(default_factory=list, description="CLI-style specs, e.g. fog:DEL, aog:VT-IAB:600")
    overrides: dict = Field(default_factory=dict, description="GeneratorParams field overrides")


class InstanceCreated(BaseModel):
    id: str
    summary: dict
    issues: list[str]


@router.post("/data/generate", response_model=InstanceCreated)
def generate_instance(req: GenerateRequest) -> InstanceCreated:
    try:
        params = GeneratorParams.for_size(req.size, req.seed, **req.overrides)
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    inst = generate(params)
    if req.disruptions:
        rng = np.random.default_rng(req.seed)
        try:
            inst = inject(inst, *[parse_spec(s, inst, rng) for s in req.disruptions])
        except (ValueError, IndexError) as e:
            raise HTTPException(status_code=422, detail=f"bad disruption spec: {e}") from e
    issues = validate_instance(inst)
    iid = storage.save_instance(inst)
    return InstanceCreated(id=iid, summary=inst.summary(), issues=issues)


@router.post("/data/import", response_model=InstanceCreated)
def import_instance(inst: Instance) -> InstanceCreated:
    """Import a full instance JSON (the generator's format; also the target for CSV import in Phase 4)."""
    issues = validate_instance(inst)
    if issues:
        raise HTTPException(status_code=422, detail={"issues": issues[:50]})
    iid = storage.save_instance(inst)
    return InstanceCreated(id=iid, summary=inst.summary(), issues=[])


@router.get("/data/instances")
def list_instances() -> list[dict]:
    return storage.list_instances()


@router.get("/data/instances/{iid}", response_model=Instance)
def get_instance(iid: str) -> Instance:
    inst = storage.get_instance(iid)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    return inst


@router.get("/data/instances/{iid}/summary")
def get_summary(iid: str) -> dict:
    inst = storage.get_instance(iid)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    return inst.summary()


@router.delete("/data/instances/{iid}")
def delete_instance(iid: str) -> dict:
    if not storage.delete_instance(iid):
        raise HTTPException(status_code=404, detail="instance not found")
    return {"deleted": iid}


@router.get("/state", response_model=State)
def get_state(instance_id: str, t: int = 0) -> State:
    """Snapshot at decision time ``t`` (minutes from day start). Phase 1 projects known delays into etd/eta."""
    inst = storage.get_instance(instance_id)
    if inst is None:
        raise HTTPException(status_code=404, detail="instance not found")
    return State(clock=t, instance=inst)
