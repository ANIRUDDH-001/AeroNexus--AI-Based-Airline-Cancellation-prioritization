"""The demo bundle must match what the engine computes (spec §10.3). In-process replay at the first bundled time;
set AERONEXUS_PARITY_ALL=1 to replay every bundled decision time."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
BUNDLE = REPO / "data" / "static-runs"


@pytest.mark.skipif(not (BUNDLE / "index.json").exists(), reason="no static bundle")
def test_static_bundle_matches_engine():
    spec = importlib.util.spec_from_file_location("check_static_parity", REPO / "scripts" / "check_static_parity.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # dataclasses in the module need it registered
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    times = mod._load("index.json")["decision_times"]
    if not os.getenv("AERONEXUS_PARITY_ALL"):
        times = times[:1]
    rep = mod.check_in_process(times)
    assert rep.ok(), "\n".join(rep.errors)
