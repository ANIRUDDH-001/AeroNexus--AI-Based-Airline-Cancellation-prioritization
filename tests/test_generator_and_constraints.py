from __future__ import annotations

import pytest

from aeronexus_core.config import ConstraintDef, EngineConfig
from aeronexus_core.constraints import available_plugins, build_constraints, feasibility_filter
from aeronexus_core.fdtl import fdp_limit
from aeronexus_core.model import Action, Instance, State, TimeWindow
from aeronexus_core.validate import validate_instance
from aeronexus_datagen import GeneratorParams, generate, generate_size
from aeronexus_datagen.disruptions import aog, inject, lvp, parse_spec

# ---------------------------------------------------------------- generator


@pytest.mark.parametrize("size,seed", [("small", 1), ("small", 2), ("small", 17), ("medium", 1), ("medium", 5)])
def test_generated_instance_is_valid(size, seed):
    inst = generate_size(size, seed=seed)
    assert validate_instance(inst) == []


def test_generator_is_deterministic():
    assert generate_size("small", seed=9).to_json() == generate_size("small", seed=9).to_json()
    assert generate_size("small", seed=9).to_json() != generate_size("small", seed=10).to_json()


def test_generator_size_targets(small_instance: Instance, medium_instance: Instance):
    s, m = small_instance.summary(), medium_instance.summary()
    assert s["airports"] == 6 and s["hubs"] == 2 and s["aircraft"] == 15
    assert 70 <= s["flights"] <= 130
    assert m["airports"] == 12 and m["hubs"] == 4 and m["aircraft"] == 40
    assert 200 <= m["flights"] <= 320
    for inst in (small_instance, medium_instance):
        lf = sum(f.booked_pax for f in inst.flights) / sum(f.seats for f in inst.flights)
        assert 0.80 <= lf <= 0.93
        assert all(len(legs) >= 2 for legs in inst.rotations().values())
        assert all(legs[0].origin == inst.aircraft_by_tail[t].location for t, legs in inst.rotations().items())
        assert any(c.is_standby for c in inst.crews)
        assert all(f.crew_id for f in inst.flights)


def test_itineraries_add_up_and_connect(small_instance: Instance):
    inst = small_instance
    by_flight: dict[str, int] = {f.id: 0 for f in inst.flights}
    for it in inst.itineraries:
        for fid in it.legs:
            by_flight[fid] += it.pax_count
        if len(it.legs) == 2:
            a, b = inst.flight(it.legs[0]), inst.flight(it.legs[1])
            assert a.dest == b.origin and a.dest in inst.hubs
            assert b.std >= a.sta + inst.airport(a.dest).min_connection_time_min
            assert a.tail != b.tail
    assert all(by_flight[f.id] == f.booked_pax for f in inst.flights)
    assert sum(i.pax_count for i in inst.itineraries if i.category == "connecting") > 0
    assert sum(i.pax_count for i in inst.itineraries if i.category == "partner") > 0


def test_crew_pairings_are_fdtl_legal(small_instance: Instance):
    for c in small_instance.crews:
        if c.is_standby:
            continue
        legs = [small_instance.flight(f) for f in c.pairing]
        assert c.duty_start == legs[0].std - 60
        assert legs[-1].sta - c.duty_start <= fdp_limit(c.duty_start, len(legs))
        assert all(leg.aircraft_type in c.type_ratings for leg in legs)


def test_fdp_table_lookup():
    assert fdp_limit(400, 2) == 780
    assert fdp_limit(400, 6) == 660
    assert fdp_limit(400, 9) == 660  # beyond table -> most restrictive listed
    assert fdp_limit(1500, 1) == 600  # wraps past midnight into the 00:00-05:59 band


def test_generator_overrides_and_bad_size():
    inst = generate(GeneratorParams.for_size("small", 3, cross_midnight_share=0.0))
    assert all(f.sta <= 1410 for f in inst.flights)
    with pytest.raises(ValueError):
        GeneratorParams.for_size("huge")


def test_disruption_inject_and_parse(small_instance: Instance):
    tail = small_instance.aircraft[0].tail
    inst = inject(small_instance, lvp("DEL", 300, 240), aog(tail, 600))
    assert len(inst.disruptions) == 2
    assert inst.aircraft_by_tail[tail].status == "AOG"
    assert small_instance.aircraft_by_tail[tail].status == "OK"  # original untouched
    d = parse_spec("capacity:BOM:480:180:0.5", inst)
    assert d.type == "AIRPORT_CAPACITY" and d.end_nominal == 660 and d.severity["capacity_fraction"] == 0.5
    assert parse_spec("delay:6E2001:90", inst).severity["delay_min"] == 90
    with pytest.raises(ValueError):
        parse_spec("volcano:DEL", inst)


# ---------------------------------------------------------------- constraints (static rules)


def _state(inst: Instance, clock: int = 300) -> State:
    return State(clock=clock, instance=inst)


def test_plugin_catalogue_matches_config(config: EngineConfig):
    plugins = available_plugins()
    for c in config.constraints:
        if c.kind == "builtin":
            assert c.plugin in plugins, c.id
    cs = build_constraints(config)
    assert len(cs) == 17  # H10_example is disabled
    assert len(build_constraints(config, phase="static")) == 7


def test_protected_and_aog_rules(config: EngineConfig, small_instance: Instance):
    inst = small_instance
    f = inst.flights[0]
    prot = inst.model_copy(update={"flights": [f.model_copy(update={"protected": True, "protection_reason": "VIP"}),
                                               *inst.flights[1:]]})
    cs = build_constraints(config, phase="static")
    feasible, infeasible = feasibility_filter(cs, _state(prot), [
        Action(type="CANCEL_LEG", target_flights=[f.id]),
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 60}),
    ])
    assert [a.type for a in feasible] == ["DELAY"]
    assert infeasible[0].feasibility.reasons[0].startswith("[H6]")
    # AOG: delaying a flight on an AOG tail is infeasible, cancelling it is allowed
    aog_inst = inject(inst, aog(f.tail, 0))
    feasible, infeasible = feasibility_filter(cs, _state(aog_inst), [
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 60}),
        Action(type="CANCEL_LEG", target_flights=[f.id]),
    ])
    assert [a.type for a in feasible] == ["CANCEL_LEG"]
    assert "[H5a]" in infeasible[0].feasibility.reasons[0]


def test_curfew_delay_bounds_and_qualification(config: EngineConfig, small_instance: Instance):
    inst = small_instance
    f = inst.flights[0]
    cs = build_constraints(config, phase="static")
    # curfew at destination covering the delayed arrival
    dest = inst.airport(f.dest).model_copy(update={"curfew_windows": [TimeWindow(start=f.sta + 60, end=f.sta + 400)]})
    cur = inst.model_copy(update={"airports": [dest if a.code == f.dest else a for a in inst.airports]})
    feasible, infeasible = feasibility_filter(cs, _state(cur), [
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 90}),
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 30}),
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 999}),
    ])
    assert [a.params["delay_min"] for a in feasible] == [30]
    reasons = " ".join(r for a in infeasible for r in a.feasibility.reasons)
    assert "[H4a]" in reasons and "[H7]" in reasons
    # LVP at destination and a crew without CAT3
    crew = inst.crew(f.crew_id).model_copy(update={"special_quals": []})
    lvp_dest = inst.airport(f.dest).model_copy(update={"lvp_windows": [TimeWindow(start=0, end=2000)]})
    fog = inst.model_copy(update={
        "airports": [lvp_dest if a.code == f.dest else a for a in inst.airports],
        "crews": [crew if c.id == crew.id else c for c in inst.crews],
    })
    _, infeasible = feasibility_filter(cs, _state(fog), [Action(type="DELAY", target_flights=[f.id], params={"delay_min": 30})])
    assert infeasible and "[H3d]" in infeasible[0].feasibility.reasons[0]


def test_user_expression_rule(config: EngineConfig, small_instance: Instance):
    inst = small_instance
    f = inst.flights[0].model_copy(update={"attributes": {"vip_count": 60}})
    inst2 = inst.model_copy(update={"flights": [f, *inst.flights[1:]]})
    rule = ConstraintDef(id="H10_vip", name="No cancel with > 50 VIPs", kind="expression",
                         config={"applies_to": ["CANCEL_LEG"], "forbid_if": "flight.attrs.get('vip_count', 0) > 50"})
    cfg = config.model_copy(update={"constraints": [*config.constraints, rule]})
    cs = build_constraints(cfg, phase="static")
    feasible, infeasible = feasibility_filter(cs, _state(inst2), [
        Action(type="CANCEL_LEG", target_flights=[f.id]),
        Action(type="CANCEL_LEG", target_flights=[inst.flights[1].id]),
        Action(type="DELAY", target_flights=[f.id], params={"delay_min": 30}),
    ])
    assert len(infeasible) == 1 and infeasible[0].target_flights == [f.id]
    assert "[H10_vip]" in infeasible[0].feasibility.reasons[0]
    assert len(feasible) == 2
