from __future__ import annotations

import pytest
from pydantic import ValidationError

from aeronexus_core.expressions import ExpressionError, Namespace, evaluate, validate_expression
from aeronexus_core.model import Action, Flight, Instance, TimeWindow, fmt_time

# ---------------------------------------------------------------- model


def test_flight_consistency_rules():
    ok = Flight(id="F1", number="6E1", origin="DEL", dest="BOM", std=600, sta=730, block_min=130,
                aircraft_type="A320", seats=180, booked_pax=150, pax_connecting=20)
    assert ok.sta == 730
    with pytest.raises(ValidationError):
        Flight(id="F2", number="6E2", origin="DEL", dest="DEL", std=600, sta=730, block_min=130, aircraft_type="A320", seats=180)
    with pytest.raises(ValidationError):
        Flight(id="F3", number="6E3", origin="DEL", dest="BOM", std=600, sta=700, block_min=130, aircraft_type="A320", seats=180)
    with pytest.raises(ValidationError):
        Flight(id="F4", number="6E4", origin="DEL", dest="BOM", std=600, sta=730, block_min=130, aircraft_type="A320",
               seats=180, booked_pax=200)


def test_time_window_and_fmt():
    w = TimeWindow(start=1380, end=1500)
    assert w.contains(1400) and not w.contains(1500)
    with pytest.raises(ValidationError):
        TimeWindow(start=10, end=5)
    assert fmt_time(90) == "01:30"
    assert fmt_time(1500) == "01:00+1"


def test_action_key_is_stable():
    a = Action(type="DELAY", target_flights=["6E2001"], params={"delay_min": 60})
    assert a.key() == "DELAY(6E2001;delay_min=60)"


def test_instance_roundtrip_and_lookups(small_instance: Instance):
    text = small_instance.to_json()
    again = Instance.from_json(text)
    assert again.to_json() == text
    f = small_instance.flights[0]
    assert small_instance.flight(f.id) is f
    assert small_instance.aircraft_by_tail[f.tail].type_code == f.aircraft_type
    rot = small_instance.rotations()
    assert all(legs == sorted(legs, key=lambda x: x.std) for legs in rot.values())
    cycles = small_instance.cycles()
    for tail, cyc in cycles.items():
        assert sum(len(c) for c in cyc) == len(rot[tail])
        for c in cyc[:-1]:
            assert c[-1].dest in small_instance.hubs


def test_instance_copy_invalidates_lookup_caches(small_instance: Instance):
    tail = small_instance.aircraft[0].tail
    _ = small_instance.aircraft_by_tail  # warm the cache on the original
    changed = small_instance.model_copy(update={
        "aircraft": [small_instance.aircraft[0].model_copy(update={"status": "AOG"}), *small_instance.aircraft[1:]]
    })
    assert changed.aircraft_by_tail[tail].status == "AOG"
    assert small_instance.aircraft_by_tail[tail].status == "OK"


# ---------------------------------------------------------------- expressions


def test_expression_arithmetic_and_names():
    ns = {"a": 3, "b": 4.5, "flag": True}
    assert evaluate("a * 2 + b", ns) == 10.5
    assert evaluate("max(a, b) if flag else 0", ns) == 4.5
    assert evaluate("clamp(a * 10, 0, 20)", ns) == 20
    assert evaluate("a > 2 and b < 5", ns) is True
    assert evaluate("1 < a <= 3", ns) is True


def test_expression_namespace_attribute_access():
    ns = {"flight": {"attrs": {"vip_count": 7}, "booked_pax": 150}}
    assert evaluate("flight.attrs.vip_count * 2", ns) == 14
    assert evaluate("flight.attrs.get('missing', 5)", ns) == 5
    assert evaluate("flight['booked_pax'] > 100", ns) is True
    assert isinstance(Namespace({"x": {"y": 1}}).x, Namespace)


@pytest.mark.parametrize(
    "bad",
    [
        "__import__('os')",
        "().__class__",
        "flight.__dict__",
        "lambda: 1",
        "[x for x in range(3)]",
        "open('f')",
        "a = 1",
        "import os",
        "10 ** 10 ** 10",
        "min(a, key=abs)",
        "",
    ],
)
def test_expression_rejects_unsafe_syntax(bad):
    with pytest.raises(ExpressionError):
        evaluate(bad, {"a": 1, "flight": {"x": 1}})


def test_expression_unknown_name_and_validate():
    with pytest.raises(ExpressionError):
        evaluate("nope + 1", {})
    assert validate_expression("a + 1", {"a": 1}) == []
    assert validate_expression("nope + 1", {"a": 1}) == ["unknown name 'nope'"]
    assert validate_expression("'text'", {"a": 1})  # non-numeric result is a problem


def test_expression_division_by_zero_is_reported():
    with pytest.raises(ExpressionError):
        evaluate("1 / a", {"a": 0})
