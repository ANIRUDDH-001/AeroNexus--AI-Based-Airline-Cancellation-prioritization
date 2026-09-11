"""Network Impact Score (Plan §10).

``compute_nis`` evaluates every enabled objective term against the metrics namespace (plus global
parameters and the ``sum_affected``/``max_affected``/``count_affected`` helpers bound to the affected
flights) and returns the composite total, per-level subtotals and per-term contributions.

``rank_plans`` implements the two ranking modes (§10.4):
* ``composite`` – ascending NIS
* ``priority``  – lexicographic over levels L1..L4 with per-level tolerances
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from ..config.registry import EngineConfig, ObjectiveLevel, ObjectiveTerm
from ..expressions import ExpressionError, evaluate, validate_expression
from ..model import Flight
from .metrics import Metrics

LEVELS: tuple[ObjectiveLevel, ...] = ("L1", "L2", "L3", "L4")


@dataclass
class NISResult:
    total: float
    by_level: dict[str, float]
    by_term: dict[str, float]
    errors: dict[str, str] = field(default_factory=dict)  # term -> error (term skipped)

    def breakdown(self) -> dict[str, float]:
        out = {f"level:{k}": v for k, v in self.by_level.items()}
        out.update({f"term:{k}": v for k, v in self.by_term.items()})
        return out


def _flight_ns(f: Flight) -> dict[str, Any]:
    d = f.model_dump()
    d["attrs"] = dict(f.attributes)
    return d


def affected_helpers(affected: Sequence[Flight]) -> dict[str, Callable[..., Any]]:
    """Helpers that aggregate a core field or an attribute column over the affected flights."""

    def _get(f: Flight, attr: str) -> float:
        if attr in f.attributes:
            v = f.attributes[attr]
        else:
            v = getattr(f, attr, 0)
        try:
            return float(v or 0)
        except (TypeError, ValueError) as e:
            raise ExpressionError(f"attribute {attr!r} is not numeric on flight {f.id}") from e

    return {
        "sum_affected": lambda attr: sum(_get(f, attr) for f in affected),
        "max_affected": lambda attr: max((_get(f, attr) for f in affected), default=0.0),
        "count_affected": lambda: float(len(affected)),
    }


def build_namespace(metrics: Metrics | Mapping[str, Any], config: EngineConfig) -> dict[str, Any]:
    ns: dict[str, Any] = dict(config.parameter_values())
    ns.update(metrics.as_namespace() if isinstance(metrics, Metrics) else dict(metrics))
    return ns


def compute_nis(
    metrics: Metrics | Mapping[str, Any],
    config: EngineConfig,
    affected: Sequence[Flight] = (),
) -> NISResult:
    ns = build_namespace(metrics, config)
    fns = affected_helpers(affected)
    by_level = {lvl: 0.0 for lvl in LEVELS}
    by_term: dict[str, float] = {}
    errors: dict[str, str] = {}
    for term in config.objective_terms:
        if not term.enabled:
            continue
        try:
            raw = evaluate(term.expression, ns, fns)
            value = float(raw) * term.weight
        except (ExpressionError, TypeError, ValueError) as e:
            errors[term.name] = str(e)
            continue
        by_term[term.name] = value
        by_level[term.level] += value
    return NISResult(total=sum(by_level.values()), by_level=by_level, by_term=by_term, errors=errors)


def validate_terms(terms: Iterable[ObjectiveTerm], config: EngineConfig) -> dict[str, list[str]]:
    """Dry-run each term against a sample namespace; returns {term_name: [problems]} for failing terms."""
    ns = build_namespace(Metrics.sample(), config)
    fns = affected_helpers(())
    problems: dict[str, list[str]] = {}
    for t in terms:
        p = validate_expression(t.expression, ns, fns)
        if p:
            problems[t.name] = p
    return problems


def rank_plans(results: Sequence[tuple[Any, NISResult]], config: EngineConfig) -> list[tuple[Any, NISResult]]:
    """Order (plan, NISResult) pairs best-first according to ``config.search.ranking_mode``."""
    mode = config.search.ranking_mode
    if mode == "composite":
        return sorted(results, key=lambda pr: pr[1].total)
    # priority: lexicographic over levels with tolerances (relative to the best value at that level)
    tol = config.search.level_tolerances
    remaining = list(results)
    ordered: list[tuple[Any, NISResult]] = []
    while remaining:
        pool = remaining
        for lvl in LEVELS:
            best = min(pr[1].by_level[lvl] for pr in pool)
            band = abs(best) * tol.get(lvl, 0.0)
            pool = [pr for pr in pool if pr[1].by_level[lvl] <= best + band]
            if len(pool) == 1:
                break
        # tie-break inside the surviving pool by composite total for determinism
        winner = min(pool, key=lambda pr: (pr[1].total, str(pr[0])))
        ordered.append(winner)
        remaining = [pr for pr in remaining if pr is not winner]
    return ordered
