from __future__ import annotations

import pytest

from aeronexus_core.config import EngineConfig
from aeronexus_core.model import Action, Decisions, State, TimeWindow
from aeronexus_core.simulator import Simulator, sample_scenarios
from aeronexus_core.validate import validate_instance
from aeronexus_datagen import generate_size
from aeronexus_datagen.disruptions import (
    airport_capacity_cut,
    aog,
    crew_unavailable,
    flight_delay,
    inject,
    lvp,
)
from tests.factories import tiny_instance


def run(inst, config, decisions=None, clock=0, sample=None):
    return Simulator(inst, config).run(decisions or Decisions(), clock=clock, sample=sample)


def test_tiny_instance_is_valid():
    assert validate_instance(tiny_instance()) == []


def test_baseline_everything_operates_on_time(config: EngineConfig):
    r = run(tiny_instance(), config)
    assert all(o.operated for o in r.legs.values())
    assert r.metrics.total_delay_min == 0 and r.metrics.forced_downstream_cancellations == 0
    assert r.metrics.pax_cancelled == 0 and r.metrics.misconnects == 0
    assert r.tail_end_location == {"T1": "DEL", "T2": "DEL", "T3": "DEL"}


def test_cancel_leg_strands_aircraft_but_cancel_cycle_does_not(config: EngineConfig):
    inst = tiny_instance()
    leg = run(inst, config, State(clock=0, instance=inst).apply(Action(type="CANCEL_LEG", target_flights=["F1"])).decisions)
    assert leg.legs["F1"].status == "CANCELLED_DECISION"
    assert leg.legs["F2"].status == "CANCELLED_FORCED" and "JAI" in leg.legs["F2"].reason
    assert leg.legs["F3"].operated  # aircraft is still at DEL, F3 departs DEL
    assert leg.metrics.forced_downstream_cancellations == 1
    cyc = run(inst, config, State(clock=0, instance=inst).apply(Action(type="CANCEL_CYCLE", target_flights=["F1", "F2"])).decisions)
    assert cyc.metrics.forced_downstream_cancellations == 0
    assert cyc.metrics.cancellations == 2 and cyc.metrics.pax_cancelled == 220
    # connecting pax F2->F3 lose leg 1 and are counted as cancelled itinerary, re-protected onto nothing (no JAI->BOM)
    i23 = next(i for i in cyc.itineraries if i.itinerary_id == "I23")
    assert i23.status == "cancelled" and i23.stranded_pax == 20


def test_delay_propagates_through_turnaround_and_absorbs_slack(config: EngineConfig):
    inst = tiny_instance()
    d = Decisions(delays={"F1": 60})
    r = run(inst, config, d)
    # F1 60 late -> arrives 08:00, turnaround 30 -> F2 earliest 08:30 vs STD 07:30 => 60 min late
    assert r.legs["F1"].delay_min == 60 and r.legs["F2"].delay_min == 60
    # F2 arrives 09:30, turnaround 30 -> F3 earliest 10:00 vs STD 09:15 => 45 late (15 min slack absorbed)
    assert r.legs["F3"].delay_min == 45
    # F4: F3 arrives 12:00, +30 -> 12:30 vs STD 12:00 => 30 late (15 more absorbed)
    assert r.legs["F4"].delay_min == 30
    assert r.metrics.buffer_consumed_min == 30
    # every minute beyond the *known* source delay counts - the imposed 60 on F1 included - so an imposed DELAY
    # can never launder delay out of the score (Phase 6 case fix)
    assert r.metrics.propagated_delay_min == 60 + 60 + 45 + 30
    assert r.metrics.delays == 1


def test_misconnect_and_reprotection(config: EngineConfig):
    from aeronexus_core.model import Crew, Itinerary
    from tests.factories import flight

    inst = tiny_instance()
    # Move the connecting pax to F2 -> F5 (different aircraft) and add a later DEL->BOM flight F7 (11:00, tail T3)
    f7 = flight("F7", "DEL", "BOM", 660, 120, "T3", "C4", 100)
    c4 = Crew(id="C4", base="DEL", type_ratings=["A320"], duty_start=600, fdp_limit_min=780, location="DEL", pairing=["F7"])
    inst = inst.model_copy(update={
        "itineraries": [i.model_copy(update={"legs": ["F2", "F5"]}) if i.id == "I23" else i for i in inst.itineraries]
        + [Itinerary(id="I7", legs=["F7"], pax_count=100)],
        "flights": [f.model_copy(update={"pax_connecting": 0, "booked_pax": 130}) if f.id == "F3" else
                    f.model_copy(update={"pax_connecting": 20, "booked_pax": 120}) if f.id == "F5" else f for f in inst.flights]
        + [f7],
        "crews": [*inst.crews, c4],
    })
    assert validate_instance(inst) == []
    # delay F2 by 60: arr 09:30 + MCT 45 = 10:15 > F5 dep 10:00 => misconnect
    r = run(inst, config, Decisions(delays={"F2": 60}))
    i23 = next(i for i in r.itineraries if i.itinerary_id == "I23")
    assert i23.status == "misconnect" and r.metrics.misconnects == 20
    # F3 departs 10:00 (too early) and F5 10:00 (missed); F7 at 11:00 has 80 spare seats -> all 20 re-protected
    assert i23.reprotected_on == ["F7"] and i23.reprotected_pax == 20 and i23.stranded_pax == 0
    assert i23.delay_min == 20 * 60  # F7 arrives 13:00 vs scheduled 12:00
    assert r.metrics.pax_stranded_overnight == 0 and r.metrics.pax_reprotected_same_day == 20
    assert r.metrics.pax_reprotect_delay_hours == pytest.approx(20.0)


def test_cancelled_flight_reprotects_with_overflow_stranded(config: EngineConfig):
    inst = tiny_instance()
    r = run(inst, config, Decisions(cancelled=["F3"]))
    # 150 pax on F3 DEL->BOM: F5 has 80 spare seats -> 80 re-protected, 70 stranded
    outs = {i.itinerary_id: i for i in r.itineraries}
    assert outs["I3"].status == "cancelled" and outs["I23"].status == "cancelled"
    assert outs["I3"].reprotected_pax + outs["I23"].reprotected_pax == 80
    assert outs["I3"].stranded_pax + outs["I23"].stranded_pax == 70
    # F4 is forced too: aircraft T1 never reaches BOM -> its 140 pax re-protect onto F6 (80 spare), 60 stranded
    assert r.legs["F4"].status == "CANCELLED_FORCED"
    assert outs["I4"].reprotected_on == ["F6"] and outs["I4"].reprotected_pax == 80 and outs["I4"].stranded_pax == 60
    assert r.metrics.pax_cancelled == 290 and r.metrics.pax_stranded_overnight == 130
    assert r.metrics.compensation_inr == 290 * 7500  # 120-min blocks -> 1-2 h band
    assert r.metrics.forced_downstream_cancellations == 1


def _with_bom_curfew(inst, start: int, end: int):
    bom = inst.airport("BOM").model_copy(update={"curfew_windows": [TimeWindow(start=start, end=end)]})
    return inst.model_copy(update={"airports": [bom if a.code == "BOM" else a for a in inst.airports]})


def test_curfew_ground_holds_then_forces_cancellation(config: EngineConfig):
    # F3 scheduled arr 11:15 (675). Delaying it by 30 -> arr 11:45 (705) inside a 11:40-12:40 curfew: the
    # aircraft waits on the ground at DEL (ATC ground-delay behaviour) and departs so as to arrive at curfew end.
    inst = _with_bom_curfew(tiny_instance(), 700, 760)
    r = run(inst, config, Decisions(delays={"F3": 30}))
    assert r.legs["F3"].operated and r.legs["F3"].arr == 760 and r.legs["F3"].delay_min == 85
    assert r.legs["F4"].operated
    # a curfew so long that the ground hold exceeds the cancellation cap (300 min) forces the cancellation,
    # and the reason names the curfew
    inst2 = _with_bom_curfew(tiny_instance(), 700, 1000)
    r2 = run(inst2, config, Decisions(delays={"F3": 30}))
    assert r2.legs["F3"].status == "CANCELLED_FORCED" and "curfew" in r2.legs["F3"].reason
    assert r2.legs["F4"].status == "CANCELLED_FORCED"  # aircraft never reached BOM


def test_fdp_breach_uses_standby_then_forces_when_none(config: EngineConfig):
    inst = tiny_instance()
    # C2 reports 08:15 (495); FDP limit for 2 sectors reporting 06:00-12:59 = 780 -> ends 21:15. Push F4 late by 8h
    r = run(inst, config, Decisions(delays={"F4": 300}))
    # F4 dep 17:00 arr 19:00 + 30 = 19:30 -> duty 675 <= 780 fine, no standby
    assert r.legs["F4"].operated and not r.legs["F4"].standby_called
    # a 240-min delay on F3 pushes F4 out: F3 dep 13:15 arr 15:15, F4 earliest 15:45 -> arr 17:45 -> duty 17:45+30-08:15 = 600 ok.
    # make the crew tighter: fdp via config table is fixed, so shrink by reporting earlier (duty_start 60)
    c2 = inst.crew("C2").model_copy(update={"duty_start": 60})
    inst2 = inst.model_copy(update={"crews": [c2 if c.id == "C2" else c for c in inst.crews]})
    r2 = run(inst2, config, Decisions(delays={"F3": 240}))
    # duty from 01:00 (00:00-05:59 band, 2 sectors -> 600): F3 arr 15:15 + 30 - 01:00 = 885 > 600 -> illegal at DEL,
    # where standby S1 exists -> S1 takes over F3 *and the rest of C2's pairing* (F4), which is then legal for S1.
    assert r2.legs["F3"].operated and r2.legs["F3"].standby_called and r2.legs["F3"].crew_id == "S1"
    assert r2.legs["F4"].operated and r2.legs["F4"].crew_id == "S1" and not r2.legs["F4"].standby_called
    assert r2.metrics.crew_standby_used == 1
    assert r2.metrics.crew_out_of_position == 0  # C2 never left DEL, its base
    # with no standby anywhere the breach is a forced cancellation with an FDP reason
    inst3 = inst2.model_copy(update={"crews": [c for c in inst2.crews if not c.is_standby]})
    r3 = run(inst3, config, Decisions(delays={"F3": 240}))
    assert r3.legs["F3"].status == "CANCELLED_FORCED" and "FDP" in r3.legs["F3"].reason


def test_capacity_queue_pushes_movements_to_next_hour(config: EngineConfig):
    inst = tiny_instance()
    # cut DEL to 1 movement/hour between 05:00 and 08:00: F1 (06:00 dep) and F5? no - F2 arrives 08:30 (outside).
    # Add a capacity cut covering 06:00-10:59 with 1/hour: F1 dep 06:00 (hour 6, slot 1). F2 arr 08:30 (hour 8, slot 1).
    # F3 dep 09:15 (hour 9, slot 1), F5 dep 10:00 (hour 10, slot 1). Now cut to 0 for 06:00-06:59 -> F1 pushed to 07:00.
    inst = inject(inst, airport_capacity_cut("DEL", 360, 60, 0.0))
    r = run(inst, config)
    assert r.legs["F1"].dep == 420 and r.legs["F1"].delay_min == 60
    assert r.legs["F2"].delay_min == 60  # turnaround propagation


def test_aog_forces_cancellations_and_swap_recovers(config: EngineConfig):
    inst = inject(tiny_instance(), aog("T1", 500))  # T1 grounded from 08:20 -> F3, F4 cannot operate
    r = run(inst, config)
    assert r.legs["F1"].operated and r.legs["F2"].operated
    assert r.legs["F3"].status == "CANCELLED_FORCED" and "AOG" in r.legs["F3"].reason
    assert r.legs["F4"].status == "CANCELLED_FORCED"
    assert r.metrics.forced_downstream_cancellations == 2
    # swap F3 onwards to the spare tail T3 parked at DEL
    st = State(clock=480, instance=inst).apply(Action(type="SWAP", target_flights=["F3"], params={"swap_tail": "T3"}))
    assert st.decisions.tail_override == {"F3": "T3", "F4": "T3"}
    r2 = run(inst, config, st.decisions, clock=480)
    assert r2.legs["F3"].operated and r2.legs["F3"].tail == "T3" and r2.legs["F4"].operated
    assert r2.metrics.forced_downstream_cancellations == 0 and r2.metrics.swaps == 1
    assert r2.tail_end_location["T1"] == "DEL" and r2.tail_end_location["T3"] == "DEL"


def test_crew_unavailable_disruption_uses_standby_once(config: EngineConfig):
    inst = inject(tiny_instance(), crew_unavailable("DEL", 2, 400))  # C2 (08:15) and C3 (09:00) become unavailable
    r = run(inst, config, clock=400)
    # only one standby at DEL: first leg processed (F3 at 09:15) gets S1, F5 (10:00) is forced
    assert r.legs["F3"].operated and r.legs["F3"].standby_called
    assert r.legs["F5"].status == "CANCELLED_FORCED" and "no standby" in r.legs["F5"].reason
    assert r.metrics.crew_standby_used == 1


def test_source_delay_and_past_flights(config: EngineConfig):
    inst = inject(tiny_instance(), flight_delay("F1", 30))
    r = run(inst, config, clock=400)
    assert r.legs["F1"].delay_min == 30 and r.legs["F1"].status == "PAST"  # departed before the clock with its known delay
    assert r.legs["F2"].delay_min == 30 and r.legs["F2"].status == "OPERATED"
    # F1's own known delay is not "propagated"; F2 inherits 30 and F3 15 (turnaround slack absorbed 15)
    assert r.legs["F3"].delay_min == 15 and r.metrics.propagated_delay_min == 45


def test_lvp_waits_for_clearance_or_uses_cat3_standby(config: EngineConfig):
    inst = inject(tiny_instance(), lvp("DEL", 500, 120, 0.5))  # LVP 08:20-10:20 at DEL
    r = run(inst, config, clock=480)
    # F3 (crew C2 has no CAT3) departs DEL 09:15 inside LVP: standby S1 has CAT3 -> called out
    assert r.legs["F3"].operated and r.legs["F3"].standby_called and r.legs["F3"].crew_id == "S1"
    # F5 (crew C3 has CAT3) departs 10:00 inside LVP: fine, no standby
    assert r.legs["F5"].operated and not r.legs["F5"].standby_called
    # F2 arrives DEL 08:30 inside LVP: crew C1 has CAT3 -> fine
    assert r.legs["F2"].operated and r.legs["F2"].delay_min == 0


def test_scenario_sampling_changes_disruption_end_deterministically(config: EngineConfig):
    inst = inject(generate_size("small", seed=1), lvp("DEL", 300, 240, 0.4))
    s1 = sample_scenarios(inst, 5, seed=3)
    s2 = sample_scenarios(inst, 5, seed=3)
    assert [s.disruption_end for s in s1] == [s.disruption_end for s in s2]
    ends = {s.disruption_end["D-LVP-DEL-300"] for s in s1}
    assert len(ends) > 1 and all(e > 300 for e in ends)
    sim = Simulator(inst, config)
    totals = {sim.run(Decisions(), clock=300, sample=s).metrics.total_delay_min for s in s1}
    assert len(totals) > 1


@pytest.mark.parametrize("size", ["small", "medium"])
def test_generated_day_simulates_clean_without_disruptions(config: EngineConfig, size: str):
    inst = generate_size(size, seed=2)
    r = run(inst, config)
    assert all(o.operated for o in r.legs.values()), [r.legs[f].reason for f in r.forced_ids()][:3]
    assert r.metrics.total_delay_min == 0
