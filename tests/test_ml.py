from __future__ import annotations

import pytest

from aeronexus_core.config import EngineConfig
from aeronexus_core.model import State
from aeronexus_core.search import detect_at_risk, generate_candidates, recommend
from aeronexus_core.search.candidates import prerank
from aeronexus_core.simulator import Simulator
from aeronexus_datagen.disruptions import aog, inject
from aeronexus_ml import FEATURE_NAMES, build_context, build_dataset, evaluate, features_for, train
from tests.factories import tiny_instance


@pytest.fixture(scope="module")
def tiny_model(config: EngineConfig):
    ds = build_dataset(config, scenarios=6, seed=11, sizes=("small",), max_candidates=25, verbose=False)
    assert len(ds.y) > 20
    return train(ds, seed=0), ds


def test_features_shape_and_context_equivalence(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))
    st = State(clock=480, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=480)
    risk = detect_at_risk(st, base, config)
    cands = generate_candidates(st, risk, base, config)
    ctx = build_context(st, base, len(risk))
    for a in cands:
        x1 = features_for(st, a, base, len(risk))
        x2 = features_for(st, a, base, len(risk), ctx)
        assert len(x1) == len(FEATURE_NAMES) and x1 == x2
    swap = next(a for a in cands if a.type == "SWAP" and a.params["swap_tail"] == "T3")
    x = dict(zip(FEATURE_NAMES, features_for(st, swap, base, len(risk), ctx), strict=True))
    assert x["act_swap"] == 1 and x["swap_same_type"] == 1 and x["base_forced"] == 1
    assert x["spare_tails_at_origin"] >= 1 and x["standby_crews_at_origin"] == 1 and x["tail_aog"] == 1


def test_surrogate_trains_ranks_and_explains(config: EngineConfig, tiny_model):
    model, ds = tiny_model
    m = evaluate(model, ds)
    assert m["samples"] == len(ds.y) and -1.0 <= m["spearman_mean"] <= 1.0
    inst = inject(tiny_instance(), aog("T1", 500))
    st = State(clock=480, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=480)
    risk = detect_at_risk(st, base, config)
    cands = generate_candidates(st, risk, base, config)
    scores = model.score_actions(st, cands, base, len(risk))
    assert len(scores) == len(cands)
    ordered = prerank(cands, st, risk, limit=10, baseline=base, ranker=model.score_actions)
    by_score = [a.key() for _, a in sorted(zip(scores, cands, strict=True), key=lambda t: t[0])]
    assert [a.key() for a in ordered] == by_score[: len(ordered)]  # surrogate order, best predicted first
    drivers = model.drivers(st, cands[0], base, len(risk))
    assert drivers and {"feature", "value", "contribution"} <= set(drivers[0])
    run = recommend(inst, config, clock=480, seed=1, surrogate=model)
    assert any("surrogate pre-rank active" in n for n in run.notes)
    assert run.plans[0].metrics["forced_downstream_cancellations"] == 0
    assert "score_drivers" in run.plans[0].explanation


def test_broken_ranker_falls_back_to_heuristic(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))
    st = State(clock=480, instance=inst)
    base = Simulator(inst, config).run(st.decisions, clock=480)
    risk = detect_at_risk(st, base, config)
    cands = generate_candidates(st, risk, base, config)

    def bad(*_):
        raise RuntimeError("model exploded")

    out = prerank(cands, st, risk, limit=4, baseline=base, ranker=bad)
    assert len(out) == 4 and out[0].type == "SWAP"  # heuristic order: swaps first for forced flights
