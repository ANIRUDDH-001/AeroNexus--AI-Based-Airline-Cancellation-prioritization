"""Plan search and recommendation (Plan §11).

    run = recommend(instance, config, clock=t)

1. Baseline simulation of the current state ("do nothing") -> at-risk flights.
2. Candidate actions -> static constraint filter -> simulate each -> simulated constraint filter -> NIS.
3. Beam search: keep the best K partial plans, up to depth D; every partial plan is also a terminal
   candidate, so "one action" can beat "three actions" and "do nothing" is always in the race.
4. Re-evaluate the best N plans under S sampled scenarios -> expected NIS, P90, stability.
5. Rank (composite or priority), explain, and return a ``Run`` with the top plans and every excluded
   candidate with its constraint reason.

Deterministic for a given (instance, decisions, config hash, seed). Respects ``latency_budget_ms`` by
reducing S, then D, then K, and says so in ``run.notes``.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .. import ENGINE_VERSION
from ..config.registry import EngineConfig, config_hash
from ..constraints import Violation, build_constraints, check_all, check_all_simulated
from ..model import Action, Instance, Plan, Run, ScenarioStats, State, fmt_time
from ..scoring.metrics import Metrics
from ..scoring.nis import NISResult, compute_nis, rank_plans
from ..simulator import Simulator, sample_scenarios
from ..simulator.engine import SimResult
from .candidates import AtRisk, detect_at_risk, generate_candidates, prerank
from .explain import (
    MIN_SAMPLES_FOR_UNCERTAINTY,
    compare,
    confidence,
    deltas_vs_baseline,
    describe_plan,
    plan_reasons,
)


@dataclass
class PlanNode:
    state: State
    actions: list[Action]
    result: SimResult
    nis: NISResult
    at_risk: list[AtRisk] = field(default_factory=list)
    scenario_nis: list[float] = field(default_factory=list)
    scenario_feasible: list[bool] = field(default_factory=list)
    scenario_levels: list[dict[str, float]] = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.state.decisions.key()


def _affected(inst: Instance, m: Metrics):
    return [inst.flight(f) for f in m.affected_flights if f in inst.flights_by_id]


def _targets_survive(res: SimResult, action: Action) -> bool:
    if action.type in ("DELAY", "SWAP"):
        return all(res.legs[f].operated for f in action.target_flights if f in res.legs)
    return True


def recommend(
    instance: Instance,
    config: EngineConfig,
    clock: int = 0,
    seed: int = 0,
    previous_top_key: str | None = None,
    extra_plans: list[list[Action]] | None = None,
    data_age_min: int | None = None,
    surrogate: Any | None = None,
) -> Run:
    """``surrogate``: optional object with ``score_actions(state, actions, baseline, n_at_risk)`` and
    ``drivers(state, action, baseline, n_at_risk)`` (the Phase 5 model). Pre-ranks candidates; never decides."""
    t0 = time.perf_counter()
    s = config.search
    notes: list[str] = []
    ranker = surrogate.score_actions if surrogate is not None else None
    if surrogate is not None:
        meta = getattr(surrogate, "meta", {}) or {}
        rho = (meta.get("heldout_metrics") or {}).get("spearman_mean")
        notes.append(f"surrogate pre-rank active (held-out rank correlation {rho:.2f})" if rho is not None
                     else "surrogate pre-rank active")
    sim = Simulator(instance, config)
    static_rules = build_constraints(config, phase="static")
    sim_rules = build_constraints(config, phase="simulated")

    def evaluate(state: State) -> tuple[SimResult, NISResult]:
        res = sim.run(state.decisions, clock=clock)
        return res, compute_nis(res.metrics, config, _affected(instance, res.metrics))

    base_state = State(clock=clock, instance=instance, decisions=instance.committed)
    base_res, base_nis = evaluate(base_state)
    if instance.committed.cancelled or instance.committed.swaps or instance.committed.delays:
        notes.append(f"starts from {len(instance.committed.cancelled)} committed cancellation(s), "
                     f"{len(instance.committed.swaps)} swap(s), {len(instance.committed.delays)} delay(s)")
    root = PlanNode(base_state, [], base_res, base_nis, detect_at_risk(base_state, base_res, config))
    beyond = [r for r in root.at_risk if instance.flight(r.flight_id).std > clock + int(s.horizon_hours * 60)]
    if beyond:
        notes.append(f"{len(beyond)} at-risk flight(s) depart more than {s.horizon_hours:g} h from now and are left "
                     "for a later decision (search.horizon_hours)")

    seen: dict[str, PlanNode] = {root.key: root}
    excluded: dict[str, Action] = {}
    beam = [root]
    depth_reached = 0
    budget = s.latency_budget_ms / 1000.0

    budget_cuts: list[str] = []
    for depth in range(s.D):
        if not s.deterministic and time.perf_counter() - t0 > budget * 0.6:
            notes.append(f"latency budget: stopped deepening at depth {depth}")
            budget_cuts.append(f"depth {depth}")
            break
        expansions: list[PlanNode] = []
        for node in beam:
            if not node.at_risk:
                continue
            all_cands = generate_candidates(node.state, node.at_risk, node.result, config, limit=10**6)
            feasible: list[Action] = []
            for a in all_cands:
                vs = check_all(static_rules, node.state, a)
                if vs:
                    a.feasibility.status = "infeasible"
                    a.feasibility.reasons = [str(v) for v in vs]
                    excluded.setdefault(a.key(), a)
                else:
                    feasible.append(a)
            cands = prerank(feasible, node.state, node.at_risk, s.M, node.result, ranker)
            for a in cands:
                if not s.deterministic and time.perf_counter() - t0 > budget * 0.8:
                    note = f"latency budget: stopped evaluating candidates at depth {depth + 1}"
                    if note not in notes:
                        notes.append(note)
                        budget_cuts.append(f"candidates depth {depth + 1}")
                    break
                st2 = node.state.apply(a)
                if st2.decisions.key() in seen:
                    continue
                res, nis = evaluate(st2)
                vs2 = check_all_simulated(sim_rules, st2, a, res)
                if not vs2 and not _targets_survive(res, a):
                    why = "; ".join(res.legs[f].reason or "" for f in a.target_flights if not res.legs[f].operated)
                    vs2 = [Violation("H1", f"{a.type} target could not operate: {why}")]
                if vs2:
                    a.feasibility.status = "infeasible"
                    a.feasibility.reasons = [str(v) for v in vs2]
                    excluded.setdefault(a.key(), a)
                    continue
                a.feasibility.status = "feasible"
                a.metrics = {k: float(v) for k, v in res.metrics.as_namespace().items() if isinstance(v, (int, float))}
                child = PlanNode(st2, [*node.actions, a], res, nis, detect_at_risk(st2, res, config))
                seen[child.key] = child
                expansions.append(child)
        if not expansions:
            break
        depth_reached = depth + 1
        pool = list(seen.values())
        ranked = rank_plans([(n, n.nis) for n in pool], config)
        beam = [n for n, _ in ranked[: s.K]]
        if all(not n.at_risk for n in beam):
            break

    # what-if plans supplied by the caller are evaluated on the same engine and always reported
    whatif_nodes: list[PlanNode] = []
    for acts in extra_plans or []:
        st = base_state
        ok = True
        for a in acts:
            vs = check_all(static_rules, st, a)
            departed = [f for f in a.target_flights if f in base_res.legs and base_res.legs[f].status == "PAST"]
            if departed:
                vs = [*vs, Violation("H0", "flight already departed: " + ", ".join(
                    f"{f} at {fmt_time(base_res.legs[f].dep or instance.flight(f).std)}" for f in departed))]
            if vs:
                a.feasibility.status = "infeasible"
                a.feasibility.reasons = [str(v) for v in vs]
                ok = False
                break
            st = st.apply(a)
        if not ok:
            continue
        node = seen.get(st.decisions.key())
        if node is None:
            res, nis = evaluate(st)
            node = PlanNode(st, list(acts), res, nis, detect_at_risk(st, res, config))
            seen[node.key] = node
        whatif_nodes.append(node)

    # ---- collapse plans with identical outcomes (e.g. swap onto either of two parked aircraft)
    ranked_all = rank_plans([(n, n.nis) for n in seen.values()], config)
    equivalents: dict[str, list[PlanNode]] = {}
    distinct: list[PlanNode] = []
    sig_of: dict[str, str] = {}
    for n, _ in ranked_all:
        sig = "|".join(f"{k}={round(v, 3)}" for k, v in sorted(n.result.metrics.as_namespace().items())
                       if isinstance(v, (int, float)))
        if sig in sig_of:
            equivalents.setdefault(sig_of[sig], []).append(n)
            continue
        sig_of[sig] = n.key
        distinct.append(n)
    finalists = distinct[: max(s.N, s.top_n_returned)]
    # "do nothing" is always a finalist: under uncertainty (fog end times, block noise) the nominal ranking
    # can favour an intervention that loses to waiting once the scenarios are sampled, and the reference
    # must be compared on the same footing rather than dropped by the nominal cut-off
    if root not in finalists:
        finalists.append(root)
    for n in whatif_nodes:
        if n not in finalists:
            finalists.append(n)
    n_samples = s.S
    elapsed = time.perf_counter() - t0
    per_eval = max(elapsed / max(1, len(seen)), 0.002)
    affordable = int((budget - elapsed) / max(per_eval * len(finalists), 1e-6))
    if affordable < n_samples and not s.deterministic:
        n_samples = max(1, affordable)
        notes.append(f"latency budget: scenarios reduced to S={n_samples}")
        budget_cuts.append(f"S {n_samples}")
    if n_samples < MIN_SAMPLES_FOR_UNCERTAINTY:
        notes.append(f"uncertainty not evaluated: only {n_samples} sampled future(s) fitted in the latency budget "
                     "(set search.deterministic or a larger latency_budget_ms for the full readout)")
    samples = sample_scenarios(instance, n_samples, seed=seed)
    for n in finalists:
        for smp in samples:
            r = sim.run(n.state.decisions, clock=clock, sample=smp)
            nis = compute_nis(r.metrics, config, _affected(instance, r.metrics))
            n.scenario_nis.append(nis.total)
            n.scenario_levels.append(dict(nis.by_level))
            n.scenario_feasible.append(all(_targets_survive(r, a) for a in n.actions))
    # stability: share of samples in which each finalist is the best
    wins = {n.key: 0 for n in finalists}
    for i in range(len(samples)):
        best = min(finalists, key=lambda n: n.scenario_nis[i])
        wins[best.key] += 1

    def mean_stats(n: PlanNode) -> ScenarioStats:
        vals = sorted(n.scenario_nis) or [n.nis.total]
        mean = sum(vals) / len(vals)
        p90 = vals[min(len(vals) - 1, int(round(0.9 * (len(vals) - 1))))]
        return ScenarioStats(mean=mean, p90=p90, stability=wins[n.key] / max(1, len(samples)), samples=len(samples))

    # final ranking on expected NIS (composite) or mean levels (priority)
    def mean_nis(n: PlanNode) -> NISResult:
        st = mean_stats(n)
        lv = {k: sum(d[k] for d in n.scenario_levels) / len(n.scenario_levels) for k in n.nis.by_level} if n.scenario_levels else dict(n.nis.by_level)
        tail = max(0.0, st.p90 - st.mean)
        by_term = dict(n.nis.by_term)
        w = next((t.weight for t in config.objective_terms if t.name == "tail_risk" and t.enabled), 0.0)
        by_term["tail_risk"] = tail * w
        lv["L4"] = lv.get("L4", 0.0) + tail * w
        return NISResult(total=st.mean + tail * w, by_level=lv, by_term=by_term)

    final = rank_plans([(n, mean_nis(n)) for n in finalists], config)

    # the returned top-N must differ in *what* is done to the schedule: plans whose only difference is the
    # spare tail chosen for a swap collapse into the best of them, the others become listed alternatives
    def decision_signature(n: PlanNode) -> str:
        parts = []
        for a in n.actions:
            if a.type == "SWAP":
                parts.append(f"SWAP:{'+'.join(sorted(a.target_flights))}")
            elif a.type == "DELAY":
                parts.append(f"DELAY:{'+'.join(sorted(a.target_flights))}:{a.params.get('delay_min')}")
            else:
                parts.append(f"{a.type}:{'+'.join(sorted(a.target_flights))}")
        return "|".join(sorted(parts))

    collapsed: list[tuple[PlanNode, NISResult]] = []
    sig_seen: dict[str, PlanNode] = {}
    for n, r in final:
        sig = decision_signature(n)
        keeper = sig_seen.get(sig)
        if keeper is None or n in whatif_nodes:
            sig_seen.setdefault(sig, n)
            collapsed.append((n, r))
        else:
            equivalents.setdefault(keeper.key, []).append(n)
    final = collapsed

    # hysteresis: keep the previous top unless the new one is clearly better
    if previous_top_key and len(final) > 1 and s.hysteresis_pct > 0:
        prev = next(((n, r) for n, r in final if n.key == previous_top_key), None)
        top = final[0]
        if prev and prev[0] is not top[0]:
            if top[1].total >= prev[1].total * (1 - s.hysteresis_pct / 100.0):
                final = [prev, *[x for x in final if x[0] is not prev[0]]]
                notes.append("hysteresis: previous recommendation kept (improvement below threshold)")
            else:
                notes.append(f"recommendation changed: new plan improves expected NIS by "
                             f"{(1 - top[1].total / max(prev[1].total, 1e-9)) * 100:.1f}%")

    def build_plan(n: PlanNode, nis_mean: NISResult, rank: int) -> Plan:
        st = mean_stats(n)
        feas_share = sum(n.scenario_feasible) / len(n.scenario_feasible) if n.scenario_feasible else 1.0
        expl = {
            "actions": describe_plan(n.actions, instance),
            "reasons": plan_reasons(n.result.metrics, n.result, instance, n.actions),
            "vs_do_nothing": deltas_vs_baseline(n.result.metrics, base_res.metrics),
            "remaining_at_risk": [r.flight_id for r in n.at_risk],
            "confidence": confidence(feas_share, st.stability, st.mean, st.p90, st.samples, data_age_min),
            "forced_cancellations": [
                {"flight": fid, "reason": n.result.legs[fid].reason} for fid in n.result.forced_ids()
            ],
            "standby_used": list(n.result.standby_used),
            "equivalent_alternatives": [
                describe_plan(e.actions, instance) for e in equivalents.get(n.key, [])
            ],
        }
        if surrogate is not None and n.actions and rank == 1:
            try:
                expl["score_drivers"] = surrogate.drivers(base_state, n.actions[0], base_res, len(root.at_risk))
            except Exception:  # noqa: BLE001 - explanation extras must never break a run
                expl["score_drivers"] = []
        if rank < len(final):
            nxt, nxt_nis = final[rank]
            expl["why_over_next"] = compare(nis_mean, nxt_nis, config, f"#{rank}", f"#{rank + 1}")
        if rank > 1:
            expl["vs_top"] = compare(final[0][1], nis_mean, config, "#1", f"#{rank}")
        return Plan(
            actions=n.actions,
            metrics={k: float(v) for k, v in n.result.metrics.as_namespace().items() if isinstance(v, (int, float))},
            nis=nis_mean.total,
            nis_breakdown=nis_mean.breakdown(),
            scenario_stats=st,
            explanation=expl,
            rank=rank,
        )

    plans: list[Plan] = [build_plan(n, nis_mean, rank) for rank, (n, nis_mean) in enumerate(final[: s.top_n_returned], start=1)]
    whatif_plans: list[Plan] = []
    for n in whatif_nodes:
        pos = next(i for i, (x, _) in enumerate(final) if x is n)
        whatif_plans.append(build_plan(n, final[pos][1], pos + 1))

    latency = (time.perf_counter() - t0) * 1000
    return Run(
        id=uuid.uuid4().hex[:12],
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
        decision_time=clock,
        instance_name=instance.name,
        config_hash=config_hash(config),
        engine_version=ENGINE_VERSION,
        plans=plans,
        excluded=list(excluded.values()),
        latency_ms=round(latency, 1),
        notes=notes,
        at_risk=[{"flight": r.flight_id, "reasons": r.reasons, "delay_min": r.delay_min, "forced": r.forced}
                 for r in root.at_risk],
        baseline_metrics={k: float(v) for k, v in base_res.metrics.as_namespace().items() if isinstance(v, (int, float))},
        plans_evaluated=len(seen),
        depth_reached=depth_reached,
        whatif=whatif_plans,
        effective={"samples": len(samples), "depth": depth_reached, "candidates_per_node": s.M,
                   "deterministic": s.deterministic, "budget_cuts": budget_cuts,
                   "surrogate": surrogate is not None},
    )
