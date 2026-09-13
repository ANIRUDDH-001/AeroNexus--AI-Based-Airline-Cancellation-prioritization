"""Persistence (Plan §20). SQLite locally, Postgres (Supabase project `Aeronexus`) for the hosted demo -
same code, different ``AERONEXUS_DB_URL``.

Everything the UI can edit lives here, never on the API's filesystem (Render's free disk resets on
spin-down). Payloads are JSONB (Postgres) / JSON text (SQLite) so the domain model can evolve without
migrations. The Postgres schema is applied as a Supabase migration (``aeronexus_core_schema``); locally
``init_db`` creates the same tables.
"""
from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine, select

from aeronexus_core.config import EngineConfig, config_hash, load_config
from aeronexus_core.model import Instance, Run

from . import settings

JSONCol = JSON().with_variant(JSONB(), "postgresql")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class InstanceRow(SQLModel, table=True):
    __tablename__ = "instances"
    id: str = Field(primary_key=True)
    name: str
    size: str
    seed: int | None = None
    created_at: str
    summary: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONCol, nullable=False))
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONCol, nullable=False))


class ConfigRow(SQLModel, table=True):
    __tablename__ = "configs"
    id: str = Field(primary_key=True)  # "current" or preset name
    version: int = 1
    hash: str
    updated_at: str
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONCol, nullable=False))


class RunRow(SQLModel, table=True):
    __tablename__ = "runs"
    __table_args__ = (Index("runs_instance_created_idx", "instance_id", "created_at"),)
    id: str = Field(primary_key=True)
    created_at: str
    instance_id: str = Field(foreign_key="instances.id")
    decision_time: int = 0
    config_hash: str
    engine_version: str
    accepted_plan: int | None = None
    override_reason: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONCol, nullable=False))


_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        url = settings.DB_URL
        kw: dict[str, Any] = (
            {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
        )
        _engine = create_engine(url, **kw)
    return _engine


def init_db() -> None:
    SQLModel.metadata.create_all(engine())
    with session() as s:
        if s.get(ConfigRow, "current") is None:
            cfg = load_config(settings.CONFIG_DIR)
            s.add(ConfigRow(id="current", version=1, hash=config_hash(cfg), updated_at=_now(),
                            payload=cfg.model_dump(mode="json")))
            s.commit()


@contextmanager
def session() -> Iterator[Session]:
    with Session(engine()) as s:
        yield s


# ---------------------------------------------------------------- instances


def save_instance(inst: Instance) -> str:
    iid = uuid.uuid4().hex[:12]
    with session() as s:
        s.add(InstanceRow(id=iid, name=inst.name, size=inst.size, seed=inst.seed, created_at=_now(),
                          summary=inst.summary(), payload=inst.model_dump(mode="json")))
        s.commit()
    return iid


def replace_instance(iid: str, inst: Instance) -> bool:
    with session() as s:
        r = s.get(InstanceRow, iid)
        if r is None:
            return False
        r.name, r.size, r.seed = inst.name, inst.size, inst.seed
        r.summary = inst.summary()
        r.payload = inst.model_dump(mode="json")
        s.add(r)
        s.commit()
        return True


def list_instances() -> list[dict]:
    with session() as s:
        rows = s.exec(select(InstanceRow).order_by(InstanceRow.created_at.desc())).all()  # type: ignore[attr-defined]
        return [{"id": r.id, "name": r.name, "size": r.size, "seed": r.seed, "created_at": r.created_at,
                 "summary": r.summary} for r in rows]


def get_instance(iid: str) -> Instance | None:
    with session() as s:
        r = s.get(InstanceRow, iid)
        return Instance.model_validate(r.payload) if r else None


def delete_instance(iid: str) -> bool:
    with session() as s:
        r = s.get(InstanceRow, iid)
        if r is None:
            return False
        for run in s.exec(select(RunRow).where(RunRow.instance_id == iid)).all():
            s.delete(run)
        s.flush()  # runs first; Postgres also cascades, and the flush order otherwise trips a 0-rows warning
        s.delete(r)
        s.commit()
        return True


# ---------------------------------------------------------------- config


def get_config(cid: str = "current") -> tuple[EngineConfig, ConfigRow]:
    with session() as s:
        r = s.get(ConfigRow, cid)
        if r is None:
            raise KeyError(cid)
        return EngineConfig.model_validate(r.payload), r


def put_config(cfg: EngineConfig, cid: str = "current") -> ConfigRow:
    with session() as s:
        r = s.get(ConfigRow, cid)
        h = config_hash(cfg)
        if r is None:
            r = ConfigRow(id=cid, version=1, hash=h, updated_at=_now(), payload=cfg.model_dump(mode="json"))
        else:
            r.version += 1
            r.hash = h
            r.updated_at = _now()
            r.payload = cfg.model_dump(mode="json")
        s.add(r)
        s.commit()
        s.refresh(r)
        return r


def list_presets() -> list[dict]:
    with session() as s:
        rows = s.exec(select(ConfigRow)).all()
        return [{"name": r.id, "version": r.version, "hash": r.hash, "updated_at": r.updated_at} for r in rows]


# ---------------------------------------------------------------- runs (audit log)


def save_run(run: Run, instance_id: str) -> None:
    with session() as s:
        s.add(RunRow(id=run.id, created_at=run.created_at, instance_id=instance_id, decision_time=run.decision_time,
                     config_hash=run.config_hash, engine_version=run.engine_version,
                     accepted_plan=run.accepted_plan, override_reason=run.override_reason,
                     payload=run.model_dump(mode="json")))
        s.commit()


def list_runs(instance_id: str | None = None, limit: int = 50) -> list[dict]:
    with session() as s:
        q = select(RunRow)
        if instance_id:
            q = q.where(RunRow.instance_id == instance_id)
        rows = s.exec(q.order_by(RunRow.created_at.desc()).limit(limit)).all()  # type: ignore[attr-defined]
        out = []
        for r in rows:
            p = r.payload
            top = p["plans"][0] if p.get("plans") else None
            out.append({
                "id": r.id, "created_at": r.created_at, "instance_id": r.instance_id, "decision_time": r.decision_time,
                "config_hash": r.config_hash, "engine_version": r.engine_version, "accepted_plan": r.accepted_plan,
                "override_reason": r.override_reason, "latency_ms": p.get("latency_ms"),
                "top_plan": (top["explanation"]["actions"] if top else []), "top_nis": (top["nis"] if top else None),
                "at_risk": len(p.get("at_risk", [])), "plans_evaluated": p.get("plans_evaluated"),
                "instance_hash": p.get("instance_hash"), "effective": p.get("effective", {}),
            })
        return out


def get_run(run_id: str) -> tuple[Run, str] | None:
    with session() as s:
        r = s.get(RunRow, run_id)
        return (Run.model_validate(r.payload), r.instance_id) if r else None


def decide_run(run_id: str, accepted_plan: int | None, override_reason: str | None,
               committed_at: str | None = None) -> Run | None:
    with session() as s:
        r = s.get(RunRow, run_id)
        if r is None:
            return None
        r.accepted_plan = accepted_plan
        r.override_reason = override_reason
        p = dict(r.payload)
        p["accepted_plan"] = accepted_plan
        p["override_reason"] = override_reason
        if committed_at is not None:
            p["committed_at"] = committed_at
        r.payload = p
        s.add(r)
        s.commit()
        return Run.model_validate(p)
