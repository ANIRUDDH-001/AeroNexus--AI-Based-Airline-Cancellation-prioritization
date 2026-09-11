"""AeroNexus API (Plan §19). Run locally with:  uvicorn aeronexus_api.main:app --reload --port 8000"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from aeronexus_core import ENGINE_VERSION

from . import settings, storage
from .routers import config as config_router
from .routers import data as data_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    storage.init_db()
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
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(config_router.router)
app.include_router(data_router.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    _, row = storage.get_config()
    return {
        "status": "ok",
        "engine_version": ENGINE_VERSION,
        "config_hash": row.hash,
        "config_version": row.version,
        "narration_enabled": settings.NARRATION_ENABLED,
    }
