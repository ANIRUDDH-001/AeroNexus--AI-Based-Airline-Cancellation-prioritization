"""Fixes from the 13-Sep live-site analysis: CORS origin normalisation, narration validation, request
validation on decisions / what-ifs, confidence readout honesty, deterministic mode, diverse top-N, write key."""
from __future__ import annotations

import pytest

from aeronexus_api import settings
from aeronexus_api.narration import validate
from aeronexus_core.config import EngineConfig
from aeronexus_core.search import recommend
from aeronexus_core.search.explain import confidence
from aeronexus_datagen.disruptions import aog, inject, lvp
from tests.factories import tiny_instance


def test_cors_origins_are_normalised_to_scheme_host():
    assert settings.normalise_origin("https://aeronexus-app.vercel.app/#") == "https://aeronexus-app.vercel.app"
    assert settings.normalise_origin(" https://Aeronexus-App.vercel.app/ ") == "https://aeronexus-app.vercel.app"
    assert settings.normalise_origin("http://localhost:5173/anything?x=1") == "http://localhost:5173"
    assert settings.normalise_origin("https://x.example.com:443") == "https://x.example.com"
    assert settings.normalise_origin("app.vercel.app") == "https://app.vercel.app"
    assert settings.normalise_origin("") is None and settings.normalise_origin("'") is None
    assert settings.cors_origins("https://a.app/#, https://a.app, http://localhost:5173") == ["https://a.app", "http://localhost:5173"]


def test_narration_validator_rejects_truncated_and_invented_text():
    facts = {"actions": ["Swap 6E2022 DEL→BOM onto VT-IBH"], "reasons": ["Cancels 3 flight(s) carrying 599 passengers."]}
    assert validate("Swap 6E2", facts, "length") is None                      # truncated reply (reasoning model)
    assert validate("Swap 6E2", facts, "stop") is None                        # too short / unterminated
    assert validate("Swap 6E2023 DEL→BOM onto VT-IBH; 599 passengers are affected.", facts, "stop") is None  # invented flight
    assert validate("Swap 6E2022 DEL→BOM onto VT-IBH; 600 passengers are affected.", facts, "stop") is None  # invented number
    ok = validate("Swap 6E2022 DEL→BOM onto VT-IBH. This cancels 3 flights carrying 599 passengers. Third sentence dropped.", facts, "stop")
    assert ok and ok.endswith("passengers.") and "Third" not in ok


def test_confidence_is_not_evaluated_below_three_samples():
    c = confidence(1.0, 1.0, 100.0, 100.0, samples=1, data_age_min=None)
    assert c["uncertainty_evaluated"] is False and c["stability_label"] == "not evaluated" and c["stability"] is None
    assert c["scenario_sensitivity_label"] == "not evaluated" and c["scenario_sensitivity"] is None
    c = confidence(1.0, 0.0, 100.0, 120.0, samples=10, data_age_min=None)
    assert c["stability_label"] == "dominated" and c["scenario_sensitivity_label"] == "moderate"


def test_deterministic_mode_keeps_samples_and_records_effective(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))
    cfg = config.model_copy(update={"search": config.search.model_copy(update={"deterministic": True, "latency_budget_ms": 100})})
    run = recommend(inst, cfg, clock=480, seed=1)
    assert run.effective["deterministic"] is True and run.effective["samples"] == cfg.search.S
    assert run.effective["budget_cuts"] == [] and not any("latency budget" in n for n in run.notes)
    from aeronexus_core.config.registry import config_hash

    audit = config.model_copy(update={"search": config.search.model_copy(update={"deterministic": True})})
    assert config_hash(audit) == config_hash(config)  # audit mode never changes the configuration identity


def test_whatif_on_departed_flight_is_infeasible(config: EngineConfig):
    inst = tiny_instance()
    # F1 DEL-JAI 06:00 has left by 07:00 with nothing wrong; cancelling it is not a decision anyone can take
    from aeronexus_core.model import Action

    act = Action(type="CANCEL_LEG", target_flights=["F1"])
    run = recommend(inst, config, clock=420, seed=1, extra_plans=[[act]])
    assert run.whatif == []
    assert act.feasibility.status == "infeasible" and any("already departed" in r for r in act.feasibility.reasons)


def test_top_plans_differ_in_decision_not_only_in_spare_tail(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))  # two spare tails at DEL: a swap onto either is the same decision
    run = recommend(inst, config, clock=480, seed=1)
    sigs = []
    for p in run.plans:
        sigs.append(tuple(sorted((a.type, tuple(a.target_flights), a.params.get("delay_min")) for a in p.actions)))
    assert len(sigs) == len(set(sigs)), sigs
    swap_plans = [p for p in run.plans if any(a.type == "SWAP" for a in p.actions)]
    assert swap_plans and swap_plans[0].explanation["equivalent_alternatives"], "the other spare tail is listed as an alternative"


def test_decision_and_whatif_validation(api_client):
    iid = api_client.post("/data/generate", json={"size": "small", "seed": 2, "disruptions": ["aog:VT-IAB:600"]}).json()["id"]
    run = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 300}).json()
    assert run["instance_hash"] and len(run["instance_hash"]) == 16 and "samples" in run["effective"]
    assert api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": 9, "override_reason": None}).status_code == 422
    assert api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": None, "override_reason": ""}).status_code == 422
    assert api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": 1, "override_reason": None}).status_code == 200
    bad = api_client.post("/whatif", json={"instance_id": iid, "decision_time": 300,
                                            "actions": [{"type": "SWAP", "target_flights": ["6E9999"], "params": {"swap_tail": "VT-XXX"}}]})
    assert bad.status_code == 422 and "unknown flight 6E9999" in str(bad.json()["detail"])
    # editing the day changes its hash, so the run is visibly non-reproducible from the current state
    fid = api_client.get(f"/data/instances/{iid}/table/flights").json()["rows"][0]["id"]
    api_client.patch(f"/data/instances/{iid}/flights/{fid}", json={"fields": {"booked_pax": 10}})
    run2 = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 300}).json()
    assert run2["instance_hash"] != run["instance_hash"]


def test_write_key_protects_mutating_routes(api_client, monkeypatch):
    monkeypatch.setattr(settings, "WRITE_KEY", "s3cret")
    assert api_client.get("/health").json()["write_key_required"] is True
    assert api_client.post("/data/generate", json={"size": "small", "seed": 1}).status_code == 401
    assert api_client.post("/config/reset").status_code == 401
    assert api_client.get("/config").status_code == 200  # reads stay open
    ok = api_client.post("/data/generate", json={"size": "small", "seed": 1}, headers={"X-AeroNexus-Key": "s3cret"})
    assert ok.status_code == 200
    # recommendations and decisions stay open for the demo
    assert api_client.post("/recommend", json={"instance_id": ok.json()["id"], "decision_time": 300}).status_code == 200


def test_health_reports_narration_mode(api_client):
    h = api_client.get("/health").json()
    assert h["narration"]["mode"] in {"off", "template-only (no NARRATION_API_KEY)", "llm"}


@pytest.mark.parametrize("fog", [True, False])
def test_pax_sentence_separates_decided_from_forced(config: EngineConfig, fog):
    inst = inject(tiny_instance(), aog("T1", 500), *( [lvp("DEL", 480, 120, 0.5)] if fog else []))
    run = recommend(inst, config, clock=480, seed=1)
    for p in run.plans:
        for r in p.explanation["reasons"]:
            assert "affecting" not in r
            if r.startswith("Forces"):
                assert "passengers)" in r


def test_realised_past_is_frozen_forecast(config: EngineConfig):
    """Moving the decision time forward must not change what already happened: with no new decisions the
    do-nothing outcome at any clock equals the 00:00 forecast, departed legs are PAST and not at risk."""
    from aeronexus_core.model import State
    from aeronexus_core.search import detect_at_risk
    from aeronexus_core.simulator import Simulator
    from aeronexus_datagen import generate_size

    inst = inject(generate_size("medium", seed=1), lvp("DEL", 300, 240, 0.5), aog("VT-IAD", 520))
    sim = Simulator(inst, config)
    ref = sim.run(State(clock=0, instance=inst).decisions, clock=0)
    for t in (300, 420, 600):
        st = State(clock=t, instance=inst)
        r = sim.run(st.decisions, clock=t)
        assert r.metrics.forced_downstream_cancellations == ref.metrics.forced_downstream_cancellations
        assert r.metrics.total_delay_min == ref.metrics.total_delay_min
        assert r.metrics.pax_stranded_overnight == ref.metrics.pax_stranded_overnight
        past = {k for k, o in r.legs.items() if o.status == "PAST"}
        assert past == {k for k, o in ref.legs.items() if o.operated and o.dep is not None and o.dep < t}
        risk = {a.flight_id for a in detect_at_risk(st, r, config)}
        assert not (risk & past)


def test_accepting_a_plan_commits_it_to_the_day(api_client):
    iid = api_client.post("/data/generate", json={"size": "small", "seed": 2, "disruptions": ["aog:VT-IAB:600"]}).json()["id"]
    run = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 300}).json()
    chosen = next(p for p in run["plans"] if p["actions"])
    cancelled = [f for a in chosen["actions"] if a["type"] in ("CANCEL_LEG", "CANCEL_CYCLE") for f in a["target_flights"]]
    r = api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": chosen["rank"], "override_reason": None})
    assert r.status_code == 200 and r.json()["committed_at"]
    com = api_client.get(f"/data/instances/{iid}/committed").json()
    assert com["count"] >= 1 and set(cancelled) <= set(com["cancelled"])
    # the day now carries the decision: the timeline shows it and the next recommendation starts from it
    tl = api_client.get("/timeline", params={"instance_id": iid, "t": 330}).json()
    assert tl["committed"]["count"] == com["count"]
    assert all(f["status"] == "CANCELLED_DECISION" for f in tl["flights"] if f["id"] in cancelled)
    run2 = api_client.post("/recommend", json={"instance_id": iid, "decision_time": 330}).json()
    assert any("committed" in n for n in run2["notes"])
    assert not any(f in a["target_flights"] for p in run2["plans"] for a in p["actions"] for f in cancelled)
    # choosing a different plan after committing is refused; reset clears the day
    other = next((p["rank"] for p in run["plans"] if p["rank"] != chosen["rank"]), None)
    if other:
        assert api_client.post(f"/runs/{run['id']}/decision", json={"accepted_plan": other, "override_reason": None}).status_code == 409
    assert api_client.post(f"/data/instances/{iid}/committed/reset").json()["count"] == 0
