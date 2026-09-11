"""Templated, deterministic explanations and confidence readouts (Plan §14).

Everything here phrases numbers the simulator and scorer already produced. No model, no free text.
"""
from __future__ import annotations

from typing import Any

from ..config.registry import EngineConfig
from ..model import Action, Instance, fmt_time
from ..scoring.metrics import Metrics
from ..scoring.nis import NISResult
from ..simulator.engine import SimResult

_TERM_WORDS: dict[str, str] = {
    "forced_downstream_cancellations": "downstream cancellations",
    "propagated_delay": "propagated delay",
    "next_wave_shortfall": "aircraft out of position for tomorrow",
    "pax_cancelled": "passengers on cancelled flights",
    "pax_reprotect_delay": "re-accommodation delay",
    "pax_stranded_overnight": "passengers stranded overnight",
    "misconnects": "missed connections",
    "special_assistance_affected": "special-assistance passengers affected",
    "high_value_affected": "high-value passengers affected",
    "partner_pax_affected": "partner passengers affected",
    "compensation": "compensation",
    "hotel_meal": "hotel and meals",
    "crew_standby_used": "standby crews used",
    "crew_out_of_position": "crews out of position",
    "swap_cost": "aircraft swaps",
    "revenue_loss": "revenue at risk",
    "buffer_consumed": "schedule buffer consumed",
    "tail_risk": "bad-case risk",
}


def describe_action(a: Action, inst: Instance) -> str:
    nums = ", ".join(inst.flight(f).number if f in inst.flights_by_id else f for f in a.target_flights)
    if a.type == "CANCEL_LEG":
        f = inst.flight(a.target_flights[0])
        return f"Cancel {f.number} {f.origin}→{f.dest} {fmt_time(f.std)}"
    if a.type == "CANCEL_CYCLE":
        first = inst.flight(a.target_flights[0])
        last = inst.flight(a.target_flights[-1])
        return f"Cancel cycle {first.origin}→{first.dest}…→{last.dest} ({nums})"
    if a.type == "DELAY":
        f = inst.flight(a.target_flights[0])
        return f"Delay {f.number} {f.origin}→{f.dest} by {a.params.get('delay_min')} min"
    if a.type == "SWAP":
        f = inst.flight(a.target_flights[0])
        return f"Swap {f.number} {f.origin}→{f.dest} onto {a.params.get('swap_tail')}"
    if a.type == "WAIT":
        return f"Wait until {fmt_time(int(a.params.get('wait_until', 0)))} before deciding"
    return f"{a.type} {nums}"


def plan_reasons(m: Metrics, res: SimResult, inst: Instance, actions: list[Action]) -> list[str]:
    reasons: list[str] = []
    decided = {fid for a in actions if a.type in ("CANCEL_LEG", "CANCEL_CYCLE") for fid in a.target_flights}
    forced = [fid for fid in res.forced_ids()]
    if not actions:
        reasons.append("No action taken (do nothing).")
    if decided:
        reasons.append(f"Cancels {len(decided)} flight(s) affecting {int(m.pax_cancelled)} passengers.")
    if forced:
        nums = ", ".join(inst.flight(f).number for f in forced[:4]) + (" …" if len(forced) > 4 else "")
        reasons.append(f"Forces {len(forced)} downstream cancellation(s): {nums}.")
    else:
        reasons.append("No downstream cancellations forced.")
    if m.pax_cancelled or m.misconnects:
        reasons.append(
            f"Re-accommodation: {int(m.pax_reprotected_same_day)} passengers same day "
            f"({int(m.pax_reprotected_within_4h)} within 4 h), {int(m.pax_stranded_overnight)} stranded overnight."
        )
    if m.misconnects:
        reasons.append(f"{int(m.misconnects)} passengers miss a connection.")
    if m.propagated_delay_min:
        n = sum(1 for o in res.legs.values() if o.operated and o.delay_min > 0)
        reasons.append(f"Propagates {int(m.propagated_delay_min)} min of delay across {n} flight(s).")
    if m.crew_standby_used:
        reasons.append(f"Uses {int(m.crew_standby_used)} standby crew(s).")
    if m.crew_out_of_position:
        reasons.append(f"Leaves {int(m.crew_out_of_position)} crew(s) out of position.")
    if m.next_wave_shortfall:
        reasons.append(f"{int(m.next_wave_shortfall)} aircraft end the day away from their planned station.")
    if m.compensation_inr:
        reasons.append(f"Compensation exposure ≈ ₹{int(m.compensation_inr):,}.")
    return reasons


def compare(a_nis: NISResult, b_nis: NISResult, config: EngineConfig, a_label: str = "#1", b_label: str = "#2") -> dict[str, Any]:
    """Why a over b: the largest term-level differences, in words."""
    diffs = []
    for name in set(a_nis.by_term) | set(b_nis.by_term):
        da = a_nis.by_term.get(name, 0.0)
        db = b_nis.by_term.get(name, 0.0)
        if abs(da - db) > 1e-9:
            diffs.append((name, da - db))
    diffs.sort(key=lambda x: abs(x[1]), reverse=True)
    lines = []
    for name, d in diffs[:4]:
        word = _TERM_WORDS.get(name, name)
        better = a_label if d < 0 else b_label
        lines.append(f"{better} is better on {word} by {abs(d):,.0f} points")
    margin = b_nis.total - a_nis.total
    verdict = f"{a_label} wins by {margin:,.0f} points" if margin > 0 else f"{b_label} scores {abs(margin):,.0f} points lower"
    return {"verdict": verdict, "differences": lines, "margin": margin}


def deltas_vs_baseline(m: Metrics, base: Metrics) -> dict[str, float]:
    out: dict[str, float] = {}
    for name in Metrics.names():
        a, b = getattr(m, name), getattr(base, name)
        if a != b:
            out[name] = round(float(a) - float(b), 2)
    return out


def confidence(feasible_share: float, stability: float | None, mean: float, p90: float, samples: int,
               data_age_min: int | None) -> dict[str, Any]:
    feas = "certain" if feasible_share >= 0.999 else "probable" if feasible_share >= 0.8 else "marginal"
    sens = (p90 - mean) / mean if mean > 0 else 0.0
    sens_label = "low" if sens < 0.15 else "moderate" if sens < 0.5 else "high"
    stab_label = None
    if stability is not None:
        stab_label = "stable" if stability >= 0.8 else "sensitive" if stability >= 0.5 else "unstable"
    return {
        "feasibility": feas,
        "feasible_share": round(feasible_share, 3),
        "data_freshness_min": data_age_min,
        "stability": stability,
        "stability_label": stab_label,
        "scenario_sensitivity": round(sens, 3),
        "scenario_sensitivity_label": sens_label,
        "samples": samples,
    }
