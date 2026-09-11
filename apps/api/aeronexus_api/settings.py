"""Runtime settings (environment-driven; no secrets in the repo).

AERONEXUS_DB_URL     sqlite:///./aeronexus.db (local)  |  postgresql+psycopg://... (Supabase, demo)
AERONEXUS_CONFIG_DIR path to the YAML registries (default: <repo>/configs)
AERONEXUS_CORS       comma-separated allowed origins (default: localhost dev servers)
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

DB_URL: str = os.getenv("AERONEXUS_DB_URL", f"sqlite:///{(REPO_ROOT / 'aeronexus.db').as_posix()}")
CONFIG_DIR: Path = Path(os.getenv("AERONEXUS_CONFIG_DIR", str(REPO_ROOT / "configs")))
CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("AERONEXUS_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
NARRATION_ENABLED: bool = os.getenv("NARRATION_ENABLED", "false").lower() in {"1", "true", "yes"}
