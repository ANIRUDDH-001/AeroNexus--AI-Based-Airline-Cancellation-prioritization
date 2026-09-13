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
    "forced_downstream_cancellations": "flights left to fail at departure (no decision, no notice)",
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


def describe_plan(actions: list[Action], inst: Instance) -> list[str]:
    """Plan-level labels: cancellations whose flight sets overlap (a cycle chosen for one at-risk flight and
    a cycle for its neighbour on the same rotation) are merged into one line so the controller reads
    "cancel these four legs" rather than two overlapping cycles. Other actions keep describe_action()."""
    groups: list[tuple[int, set[str]]] = []  # (position of first member, flight ids)
    labels: list[tuple[int, str]] = []
    for i, a in enumerate(actions):
        if a.type not in ("CANCEL_LEG", "CANCEL_CYCLE"):
            labels.append((i, describe_action(a, inst)))
            continue
        fids = set(a.target_flights)
        hit = next((g for g in groups if g[1] & fids), None)
        if hit is None:
            groups.append((i, fids))
        else:
            hit[1].update(fids)
            # absorb any later group that now overlaps too
            for g in [g for g in groups if g is not hit and g[1] & hit[1]]:
                hit[1].update(g[1])
                groups.remove(g)
    for pos, fids in groups:
        singles = [a for a in actions if a.type in ("CANCEL_LEG", "CANCEL_CYCLE") and set(a.target_flights) == fids]
        if singles:
            labels.append((pos, describe_action(singles[0], inst)))
            continue
        legs = sorted((inst.flight(f) for f in fids), key=lambda f: (f.std, f.id))
        route = "→".join([legs[0].origin, *[f.dest for f in legs]])
        labels.append((pos, f"Cancel {len(legs)} legs {route} ({', '.join(f.number for f in legs)})"))
    return [lbl for _, lbl in sorted(labels, key=lambda t: t[0])]


def plan_reasons(m: Metrics, res: SimResult, inst: Instance, actions: list[Action]) -> list[str]:
    reasons: list[str] = []
    decided = {fid for a in actions if a.type in ("CANCEL_LEG", "CANCEL_CYCLE") for fid in a.target_flights}
    forced = [fid for fid in res.forced_ids()]
    if not actions:
        reasons.append("No action taken (do nothing).")
    # passengers on the flights this plan cancels, separately from those on flights that cancel anyway
    decided_pax = sum(inst.flight(f).booked_pax for f in decided if f in inst.flights_by_id)
    forced_pax = sum(inst.flight(f).booked_pax for f in forced if f in inst.flights_by_id)
    if decided:
        reasons.append(f"Cancels {len(decided)} flight(s) carrying {decided_pax} passengers.")
    if forced:
        nums = ", ".join(inst.flight(f).number for f in forced[:4]) + (" …" if len(forced) > 4 else "")
        reasons.append(f"Forces {len(forced)} downstream cancellation(s) ({forced_pax} passengers): {nums}.")
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


MIN_SAMPLES_FOR_UNCERTAINTY = 3


def confidence(feasible_share: float, stability: float | None, mean: float, p90: float, samples: int,
               data_age_min: int | None) -> dict[str, Any]:
    """Four-part readout. With fewer than MIN_SAMPLES_FOR_UNCERTAINTY sampled futures (a latency-budget
    cut on a slow machine) the stability and sensitivity fields are reported as *not evaluated* rather than
    as a confident-looking 100 % / "low" computed from one draw."""
    feas = "certain" if feasible_share >= 0.999 else "probable" if feasible_share >= 0.8 else "marginal"
    evaluated = samples >= MIN_SAMPLES_FOR_UNCERTAINTY
    sens = (p90 - mean) / mean if (mean > 0 and evaluated) else None
    sens_label = None if sens is None else "low" if sens < 0.15 else "moderate" if sens < 0.5 else "high"
    stab_label = None
    if stability is not None and evaluated:
        # stability = share of sampled futures in which this plan is the best of the finalists; a plan that is
        # merely dominated by a near-identical one scores 0 and is labelled "dominated", not "unstable"
        stab_label = "stable" if stability >= 0.8 else "sensitive" if stability >= 0.5 else "dominated" if stability == 0 else "unstable"
    return {
        "feasibility": feas,
        "feasible_share": round(feasible_share, 3),
        "data_freshness_min": data_age_min,
        "stability": stability if evaluated else None,
        "stability_label": stab_label if evaluated else "not evaluated",
        "scenario_sensitivity": round(sens, 3) if sens is not None else None,
        "scenario_sensitivity_label": sens_label if evaluated else "not evaluated",
        "samples": samples,
        "uncertainty_evaluated": evaluated,
    }
