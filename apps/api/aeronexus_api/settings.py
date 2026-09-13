"""Runtime settings (environment-driven; no secrets in the repo).

AERONEXUS_DB_URL     sqlite:///./aeronexus.db (local)  |  postgresql+psycopg://... (Supabase, demo)
AERONEXUS_CONFIG_DIR path to the YAML registries (default: <repo>/configs)
AERONEXUS_CORS       comma-separated allowed browser origins (default: localhost dev servers). Values are
                     normalised to scheme://host[:port] - a pasted "https://app.vercel.app/#" still works.
AERONEXUS_CORS_REGEX optional regex for extra origins (e.g. Vercel preview deployments)
AERONEXUS_WRITE_KEY  optional; when set, destructive/config routes require header X-AeroNexus-Key
NARRATION_*          see narration.py (only the key is mandatory; base URL and model default to Gemini)
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

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


def normalise_origin(value: str) -> str | None:
    """Browsers send ``Origin: scheme://host[:port]`` - never a path, query or fragment - and CORS matching
    is exact. Reduce whatever was pasted into the environment to that form."""
    v = value.strip().strip("'\"")
    if not v:
        return None
    if "://" not in v:
        v = "https://" + v
    u = urlsplit(v)
    if not u.scheme or not u.hostname:
        return None
    host = u.hostname.lower()
    port = f":{u.port}" if u.port and not ((u.scheme == "https" and u.port == 443) or (u.scheme == "http" and u.port == 80)) else ""
    return f"{u.scheme.lower()}://{host}{port}"


def cors_origins(raw: str | None) -> list[str]:
    out: list[str] = []
    for part in (raw or "http://localhost:5173,http://127.0.0.1:5173").split(","):
        o = normalise_origin(part)
        if o and o not in out:
            out.append(o)
    return out


CORS_ORIGINS: list[str] = cors_origins(os.getenv("AERONEXUS_CORS"))
CORS_ORIGIN_REGEX: str | None = os.getenv("AERONEXUS_CORS_REGEX") or None
WRITE_KEY: str | None = os.getenv("AERONEXUS_WRITE_KEY") or None
NARRATION_ENABLED: bool = os.getenv("NARRATION_ENABLED", "false").lower() in {"1", "true", "yes"}
