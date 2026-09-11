from __future__ import annotations

from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
CONFIG_DIR = REPO / "configs"


@pytest.fixture(scope="session")
def config():
    from aeronexus_core.config import load_config

    return load_config(CONFIG_DIR)


@pytest.fixture(scope="session")
def small_instance():
    from aeronexus_datagen import generate_size

    return generate_size("small", seed=1)


@pytest.fixture(scope="session")
def medium_instance():
    from aeronexus_datagen import generate_size

    return generate_size("medium", seed=1)


@pytest.fixture()
def api_client(tmp_path, monkeypatch):
    """TestClient on a fresh SQLite database; config seeded from configs/."""
    from aeronexus_api import settings, storage

    db = tmp_path / "test.db"
    monkeypatch.setattr(settings, "DB_URL", f"sqlite:///{db.as_posix()}")
    monkeypatch.setattr(settings, "CONFIG_DIR", CONFIG_DIR)
    storage._engine = None
    from fastapi.testclient import TestClient

    from aeronexus_api.main import app

    with TestClient(app) as c:
        yield c
    storage._engine = None
