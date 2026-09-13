from __future__ import annotations

from aeronexus_core.config import EngineConfig
from aeronexus_core.model import Action, State
from aeronexus_core.search import detect_at_risk, generate_candidates, recommend
from aeronexus_core.simulator import Simulator
from aeronexus_datagen import generate_size
from aeronexus_datagen.disruptions import aog, crew_unavailable, inject, lvp
from tests.factories import tiny_instance


def test_no_disruption_means_no_action(config: EngineConfig):
    run = recommend(tiny_instance(), config, clock=0)
    assert run.at_risk == []
    assert len(run.plans) == 1 and run.plans[0].actions == []
    assert run.plans[0].explanation["reasons"][0].startswith("No action")


def test_aog_case_prefers_swap_to_spare_aircraft(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))  # T1 grounded from 08:20: F3/F4 cannot operate
    run = recommend(inst, config, clock=480, seed=1)
    assert {r["flight"] for r in run.at_risk} == {"F3", "F4"}
    top = run.plans[0]
    assert any(a.type == "SWAP" and a.params["swap_tail"] == "T3" for a in top.actions)
    assert top.metrics["forced_downstream_cancellations"] == 0
    assert run.baseline_metrics["forced_downstream_cancellations"] == 2
    assert top.nis < run.plans[-1].nis or len(run.plans) == 1
    assert all(a.feasibility.status == "feasible" for p in run.plans for a in p.actions)
    assert top.explanation["confidence"]["feasibility"] == "certain"
    assert "why_over_next" in top.explanation


def test_candidates_include_cycle_and_swap(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))
    st = State(clock=480, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=480)
    risk = detect_at_risk(st, base, config)
    cands = generate_candidates(st, risk, base, config)
    keys = {a.key() for a in cands}
    assert "CANCEL_LEG(F3)" in keys and "CANCEL_CYCLE(F3+F4)" in keys
    assert "SWAP(F3;swap_tail=T3)" in keys and "SWAP(F3;swap_tail=T2)" in keys  # both parked at DEL at 09:15
    assert not any(k.startswith("DELAY(F3") for k in keys)  # forced flights get no delay candidates


def test_protected_flight_is_excluded_with_reason(config: EngineConfig):
    inst = inject(tiny_instance(), crew_unavailable("DEL", 1, 400))  # C2 unavailable -> F3 needs standby S1
    inst = inst.model_copy(update={
        "flights": [f.model_copy(update={"protected": True, "protection_reason": "VIP"}) if f.id == "F3" else f
                    for f in inst.flights],
        "crews": [c for c in inst.crews if not c.is_standby],  # no standby -> F3 forced
    })
    run = recommend(inst, config, clock=400, seed=1)
    keys = {a.key(): a for a in run.excluded}
    assert "CANCEL_LEG(F3)" in keys and keys["CANCEL_LEG(F3)"].feasibility.reasons[0].startswith("[H6]")
    assert not any(a.type in ("CANCEL_LEG", "CANCEL_CYCLE") and "F3" in a.target_flights for p in run.plans for a in p.actions)


def test_whatif_plan_is_evaluated_and_hysteresis_keeps_previous(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))
    whatif = [Action(type="CANCEL_CYCLE", target_flights=["F3", "F4"])]
    run = recommend(inst, config, clock=480, seed=1, extra_plans=[whatif])
    assert len(run.whatif) == 1
    w = run.whatif[0]
    assert [a.key() for a in w.actions] == ["CANCEL_CYCLE(F3+F4)"]
    assert w.rank is not None and w.rank > 1 and w.nis > run.plans[0].nis
    assert "vs_top" in w.explanation and w.explanation["vs_top"]["margin"] > 0
    # hysteresis: pretend the previous top was the what-if plan; the swap is far better so it must switch
    prev_key = State(clock=480, instance=inst).apply(whatif[0]).decisions.key()
    run2 = recommend(inst, config, clock=480, seed=1, extra_plans=[whatif], previous_top_key=prev_key)
    assert run2.plans[0].actions[0].type == "SWAP"
    assert any("recommendation changed" in n for n in run2.notes)


def test_recommend_is_deterministic(config: EngineConfig):
    inst = inject(generate_size("small", seed=3), lvp("DEL", 300, 240, 0.4))
    a = recommend(inst, config, clock=300, seed=7)
    b = recommend(inst, config, clock=300, seed=7)
    assert [[x.key() for x in p.actions] for p in a.plans] == [[x.key() for x in p.actions] for p in b.plans]
    assert [round(p.nis, 6) for p in a.plans] == [round(p.nis, 6) for p in b.plans]
    assert a.config_hash == b.config_hash


def test_medium_fog_day_within_latency_budget(config: EngineConfig):
    base = generate_size("medium", seed=1)
    inst = inject(base, lvp("DEL", 300, 240, 0.4), aog(base.aircraft[3].tail, 540))
    run = recommend(inst, config, clock=300, seed=1)
    assert run.latency_ms < config.search.latency_budget_ms * 1.5
    assert len(run.plans) == 3 and run.plans[0].nis <= run.plans[1].nis <= run.plans[2].nis
    assert run.plans[0].metrics["forced_downstream_cancellations"] <= run.baseline_metrics["forced_downstream_cancellations"]
    assert run.plans[0].scenario_stats is not None and run.plans[0].scenario_stats.samples >= 3
    assert all(a.feasibility.status == "feasible" for p in run.plans for a in p.actions)
    assert run.excluded and all(a.feasibility.reasons for a in run.excluded)


def test_do_nothing_is_always_compared_under_uncertainty(config: EngineConfig):
    """Regression (ladder scenario seed 8895): with a very uncertain fog end (lognormal sigma 0.5) the nominal
    ranking favoured two leg cancellations that lost to waiting once futures were sampled - but "do nothing"
    had been dropped by the nominal cut-off and never got compared. It must always be a finalist."""
    inst = inject(generate_size("medium", seed=8895), lvp("HYD", 316, 343, 0.5342957426208524, sigma=0.5))
    # generous latency budget so a loaded CI machine cannot truncate the search and change the answer
    cfg = config.model_copy(update={"search": config.search.model_copy(update={"latency_budget_ms": 60_000})})
    # an empty what-if plan is "do nothing": it comes back with the rank it got among the finalists
    run = recommend(inst, cfg, clock=440, seed=1, extra_plans=[[]])
    assert run.whatif and run.whatif[0].actions == [] and run.whatif[0].rank is not None
    nothing = run.whatif[0]
    assert nothing.scenario_stats is not None and nothing.scenario_stats.samples == cfg.search.S
    # whatever is returned must beat waiting on the *sampled* futures, never only on the nominal run
    assert all(p.nis <= nothing.nis for p in run.plans)
    if nothing.rank == 1:
        assert run.plans[0].actions == []


def test_overlapping_cancellations_are_described_as_one_label():
    from aeronexus_core.search.explain import describe_plan

    inst = tiny_instance()  # T1: F1 DEL-JAI, F2 JAI-DEL, F3 DEL-BOM, F4 BOM-DEL
    acts = [
        Action(type="SWAP", target_flights=["F5"], params={"swap_tail": "T3"}),
        Action(type="CANCEL_CYCLE", target_flights=["F3", "F4"]),
        Action(type="CANCEL_CYCLE", target_flights=["F2", "F3"]),
    ]
    labels = describe_plan(acts, inst)
    assert labels[0].startswith("Swap F5") and len(labels) == 2
    assert labels[1] == "Cancel 3 legs JAI→DEL→BOM→DEL (F2, F3, F4)"
    # non-overlapping cancellations keep their own labels
    assert describe_plan(acts[:2], inst)[1].startswith("Cancel cycle DEL→BOM")
