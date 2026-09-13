"""Runtime settings (environment-driven; no secrets in the repo).

AERONEXUS_DB_URL     sqlite:///./aeronexus.db (local)  |  postgresql+psycopg://... (Supabase, demo)
AERONEXUS_CONFIG_DIR path to the YAML registries (default: <repo>/configs)
AERONEXUS_CORS       comma-separated allowed origins (default: localhost dev servers)
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines; existing environment wins). Keeps secrets out of the repo."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and v and k not in os.environ:
            os.environ[k] = v


_load_dotenv(REPO_ROOT / ".env")

DB_URL: str = os.getenv("AERONEXUS_DB_URL", f"sqlite:///{(REPO_ROOT / 'aeronexus.db').as_posix()}")
CONFIG_DIR: Path = Path(os.getenv("AERONEXUS_CONFIG_DIR", str(REPO_ROOT / "configs")))
CORS_ORIGINS: list[str] = [
    o.strip()
    for o in os.getenv("AERONEXUS_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]
NARRATION_ENABLED: bool = os.getenv("NARRATION_ENABLED", "false").lower() in {"1", "true", "yes"}
