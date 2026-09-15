"""AeroNexus API (Plan §19). Run locally with:  uvicorn aeronexus_api.main:app --reload --port 8000"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aeronexus_core import ENGINE_VERSION

from . import settings, storage
from .narration import narration_status
from .routers import cases as cases_router
from .routers import config as config_router
from .routers import data as data_router
from .routers import edit as edit_router
from .routers import engine as engine_router
from .schemas import HealthOut


@asynccontextmanager
async def lifespan(_: FastAPI):
    storage.init_db()
    sur = engine_router.surrogate()
    if sur is not None:
        sur.warm()
    log = logging.getLogger("uvicorn.error")
    log.info("AeroNexus: CORS origins %s%s; narration %s; write key %s",
             settings.CORS_ORIGINS, f" + regex {settings.CORS_ORIGIN_REGEX}" if settings.CORS_ORIGIN_REGEX else "",
             narration_status(), "required" if settings.WRITE_KEY else "not required")
    yield


app = FastAPI(
    title="AeroNexus API",
    version=ENGINE_VERSION,
    description="AI-Based Cancellation Prioritization for Flight Disruptions - advisory decision support for the OCC.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(config_router.router)
app.include_router(config_router.write)
app.include_router(data_router.router)
app.include_router(data_router.write)
app.include_router(edit_router.router)
app.include_router(edit_router.write)
app.include_router(engine_router.router)
app.include_router(cases_router.router)


@app.get("/health", tags=["meta"], response_model=HealthOut)
def health() -> dict:
    _, row = storage.get_config()
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "config_hash": row.hash,
        "config_version": row.version,
        "narration_enabled": settings.NARRATION_ENABLED,
        "narration": narration_status(),
        "write_key_required": settings.WRITE_KEY is not None,
    }
