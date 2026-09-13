"""Phase 6 validation: every hand-crafted case must pass on the committed configuration, and the benchmark
ladder must run end to end (a tiny run - the 30-scenario result lives in data/benchmarks/latest.json)."""
from __future__ import annotations

import pytest

from aeronexus_core.benchmark import run_benchmark
from aeronexus_core.cases import CASES_DIR, load_case, run_case

CASE_FILES = sorted(CASES_DIR.glob("case_*.yaml"))


@pytest.mark.parametrize("path", CASE_FILES, ids=[p.stem for p in CASE_FILES])
def test_case_passes(path, config):
    case = load_case(path)
    res = run_case(case, config)
    assert res.passed, f"{res.id}: {res.failures} (top-1 {res.top1}, expected {res.expected})"
    assert res.latency_ms < 5000


def test_twelve_cases_present():
    assert len(CASE_FILES) == 12


def test_benchmark_ladder_smoke(config):
    res = run_benchmark(config, scenarios=3, seed=7, s_eval=5, verbose=False)
    assert res["scenarios"] >= 1
    s = res["summary"]
    assert {"do_nothing", "B0_naive", "B1_weighted", "B2_aeronexus"} <= set(s)
    for pol in s.values():
        assert pol["nis_mean"] >= 0 and 0 <= pol["win_rate_vs_B0"] <= 1
    assert s["B2_aeronexus"]["latency_ms_mean"] > 0
    rec = res["records"][0]
    assert set(rec["policies"]) == set(s) and rec["at_risk"] >= 1


def test_cases_and_benchmark_endpoints(api_client):
    cases = api_client.get("/cases").json()
    assert len(cases) == 12 and all(c["expected"] for c in cases)
    r = api_client.post("/cases/run", json={"ids": ["case_01_heavy_vs_light", "case_05_curfew_no_recovery"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2 and body["passed"] == 2 and len(body["config_hash"]) == 16
    assert body["results"][0]["plans"] and "top_reasons" in body["results"][0]
    assert api_client.get("/cases/latest").status_code == 404  # subset runs are not cached
    assert api_client.post("/cases/run", json={"ids": ["nope"]}).status_code == 404
    b = api_client.get("/benchmark/latest")
    assert b.status_code in (200, 404)
    if b.status_code == 200:
        assert "B2_aeronexus" in b.json()["summary"] and "stale" in b.json()
