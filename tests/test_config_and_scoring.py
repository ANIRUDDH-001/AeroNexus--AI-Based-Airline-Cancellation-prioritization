from __future__ import annotations

import pytest
from pydantic import ValidationError

from aeronexus_core.config import (
    ConstraintDef,
    EngineConfig,
    ObjectiveTerm,
    config_hash,
    load_config,
    save_config,
)
from aeronexus_core.scoring import Metrics, NISResult, compute_nis, rank_plans, validate_terms
from tests.conftest import CONFIG_DIR

# ---------------------------------------------------------------- registries + hash


def test_yaml_registries_load(config: EngineConfig):
    assert len(config.objective_terms) == 18
    assert {t.level for t in config.objective_terms} == {"L1", "L2", "L3", "L4"}
    assert len(config.constraints) == 18
    assert config.constraint("H3a").config["fdp_table"]
    assert config.search.K == 5 and config.search.ranking_mode == "composite"
    assert config.parameter("hotel_meal_rate_inr").default == 3500


def test_all_default_terms_validate_against_metrics_namespace(config: EngineConfig):
    assert validate_terms(config.objective_terms, config) == {}


def test_config_hash_is_deterministic_and_semantic(config: EngineConfig):
    h1 = config_hash(config)
    assert h1 == config_hash(load_config(CONFIG_DIR))
    assert len(h1) == 16
    # a description edit must NOT change the hash
    t0 = config.objective_terms[0].model_copy(update={"description": "different wording"})
    c2 = config.model_copy(update={"objective_terms": [t0, *config.objective_terms[1:]]})
    assert config_hash(c2) == h1
    # a weight edit MUST change the hash
    t1 = config.objective_terms[0].model_copy(update={"weight": config.objective_terms[0].weight + 1})
    c3 = config.model_copy(update={"objective_terms": [t1, *config.objective_terms[1:]]})
    assert config_hash(c3) != h1
    # disabling a constraint MUST change the hash
    k = config.constraints[0].model_copy(update={"enabled": False})
    c4 = config.model_copy(update={"constraints": [k, *config.constraints[1:]]})
    assert config_hash(c4) != h1
    # search settings too
    c5 = config.model_copy(update={"search": config.search.model_copy(update={"K": 9})})
    assert config_hash(c5) != h1


def test_preset_roundtrip(tmp_path, config: EngineConfig):
    save_config(config, tmp_path)
    again = load_config(tmp_path)
    assert config_hash(again) == config_hash(config)
    save_config(config.model_copy(update={"search": config.search.model_copy(update={"K": 2})}), tmp_path, as_preset="fast")
    fast = load_config(tmp_path, preset="fast")
    assert fast.search.K == 2 and fast.preset_name == "fast"
    with pytest.raises(FileNotFoundError):
        load_config(tmp_path, preset="missing")


def test_registry_validation_rules():
    with pytest.raises(ValidationError):
        ObjectiveTerm(name="Bad Name", level="L1", expression="x", weight=1)
    with pytest.raises(ValidationError):
        ObjectiveTerm(name="bad", level="L1", expression="__import__('os')", weight=1)
    with pytest.raises(ValidationError):
        ConstraintDef(id="X", name="x", kind="builtin")  # builtin needs plugin
    with pytest.raises(ValidationError):
        ConstraintDef(id="X", name="x", kind="expression", config={})  # needs forbid_if
    with pytest.raises(ValidationError):
        EngineConfig(objective_terms=[
            ObjectiveTerm(name="dup", level="L1", expression="1", weight=1),
            ObjectiveTerm(name="dup", level="L2", expression="2", weight=1),
        ])


# ---------------------------------------------------------------- scoring


def test_compute_nis_breakdown(config: EngineConfig, small_instance):
    m = Metrics(forced_downstream_cancellations=2, pax_cancelled=150, pax_stranded_overnight=10, swaps=1)
    r = compute_nis(m, config)
    assert r.errors == {}
    assert r.by_term["forced_downstream_cancellations"] == 2 * 5000
    assert r.by_term["pax_cancelled"] == 150 * 40
    assert r.by_term["hotel_meal"] == 10 * 3500  # uses the global parameter
    assert r.by_level["L1"] == 10000
    assert r.total == pytest.approx(sum(r.by_term.values()))
    assert "level:L1" in r.breakdown() and "term:swap_cost" in r.breakdown()


def test_user_added_attribute_term(config: EngineConfig, small_instance):
    """The §15.2 flow: add a column, reference it from a new term via sum_affected."""
    f = small_instance.flights[0].model_copy(update={"attributes": {"vip_count": 7}})
    g = small_instance.flights[1].model_copy(update={"attributes": {"vip_count": 3}})
    new = ObjectiveTerm(name="vip_impact", level="L2", expression="sum_affected('vip_count') * 300", weight=1)
    cfg = config.model_copy(update={"objective_terms": [*config.objective_terms, new]})
    r = compute_nis(Metrics(), cfg, affected=[f, g])
    assert r.by_term["vip_impact"] == 10 * 300
    # core fields work through the same helper
    cfg2 = config.model_copy(update={"objective_terms": [
        ObjectiveTerm(name="booked", level="L2", expression="sum_affected('booked_pax')", weight=1)]})
    assert compute_nis(Metrics(), cfg2, affected=[f, g]).by_term["booked"] == f.booked_pax + g.booked_pax


def test_rank_plans_modes(config: EngineConfig):
    def res(l1, l2, l3=0.0, l4=0.0):
        return NISResult(total=l1 + l2 + l3 + l4, by_level={"L1": l1, "L2": l2, "L3": l3, "L4": l4}, by_term={})

    a = ("A", res(0, 9000))      # no forced cancellations, big pax harm
    b = ("B", res(5000, 100))    # one forced cancellation, tiny pax harm
    c = ("C", res(0, 8500))
    composite = rank_plans([a, b, c], config)
    assert [p for p, _ in composite] == ["B", "C", "A"]
    prio_cfg = config.model_copy(update={"search": config.search.model_copy(update={"ranking_mode": "priority"})})
    priority = rank_plans([a, b, c], prio_cfg)
    assert [p for p, _ in priority] == ["C", "A", "B"]  # L1 dominates; within L1 tie use L2 (5% tolerance) then total
