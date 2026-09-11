"""Persistence (Plan §20). SQLite locally, Postgres (Supabase) for the hosted demo - same code, different URL.

Everything the UI can edit lives here, never on the API's filesystem (Render's free disk resets on
spin-down). Payloads are stored as JSON text so the schema stays stable while the domain model evolves.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine, select

from aeronexus_core.config import EngineConfig, config_hash, load_config
from aeronexus_core.model import Instance

from . import settings


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class InstanceRow(SQLModel, table=True):
    __tablename__ = "instances"
    id: str = Field(primary_key=True)
    name: str
    size: str
    seed: int | None = None
    created_at: str
    summary_json: str
    payload_json: str


class ConfigRow(SQLModel, table=True):
    __tablename__ = "configs"
    id: str = Field(primary_key=True)  # "current" or preset name
    version: int = 1
    hash: str
    updated_at: str
    payload_json: str


class RunRow(SQLModel, table=True):
    __tablename__ = "runs"
    id: str = Field(primary_key=True)
    created_at: str
    instance_id: str
    config_hash: str
    engine_version: str
    payload_json: str


_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        kw = {"connect_args": {"check_same_thread": False}} if settings.DB_URL.startswith("sqlite") else {}
        _engine = create_engine(settings.DB_URL, **kw)
    return _engine


def init_db() -> None:
    SQLModel.metadata.create_all(engine())
    with session() as s:
        if s.get(ConfigRow, "current") is None:
            cfg = load_config(settings.CONFIG_DIR)
            s.add(ConfigRow(id="current", version=1, hash=config_hash(cfg), updated_at=_now(),
                            payload_json=cfg.model_dump_json()))
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
                          summary_json=json.dumps(inst.summary()), payload_json=inst.to_json(indent=None)))
        s.commit()
    return iid


def list_instances() -> list[dict]:
    with session() as s:
        rows = s.exec(select(InstanceRow).order_by(InstanceRow.created_at.desc())).all()  # type: ignore[attr-defined]
        return [{"id": r.id, "name": r.name, "size": r.size, "seed": r.seed, "created_at": r.created_at,
                 "summary": json.loads(r.summary_json)} for r in rows]


def get_instance(iid: str) -> Instance | None:
    with session() as s:
        r = s.get(InstanceRow, iid)
        return Instance.from_json(r.payload_json) if r else None


def delete_instance(iid: str) -> bool:
    with session() as s:
        r = s.get(InstanceRow, iid)
        if r is None:
            return False
        s.delete(r)
        s.commit()
        return True


# ---------------------------------------------------------------- config


def get_config(cid: str = "current") -> tuple[EngineConfig, ConfigRow]:
    with session() as s:
        r = s.get(ConfigRow, cid)
        if r is None:
            raise KeyError(cid)
        return EngineConfig.model_validate_json(r.payload_json), r


def put_config(cfg: EngineConfig, cid: str = "current") -> ConfigRow:
    with session() as s:
        r = s.get(ConfigRow, cid)
        h = config_hash(cfg)
        if r is None:
            r = ConfigRow(id=cid, version=1, hash=h, updated_at=_now(), payload_json=cfg.model_dump_json())
            s.add(r)
        else:
            r.version += 1
            r.hash = h
            r.updated_at = _now()
            r.payload_json = cfg.model_dump_json()
            s.add(r)
        s.commit()
        s.refresh(r)
        return r


def list_presets() -> list[dict]:
    with session() as s:
        rows = s.exec(select(ConfigRow)).all()
        return [{"name": r.id, "version": r.version, "hash": r.hash, "updated_at": r.updated_at} for r in rows]
