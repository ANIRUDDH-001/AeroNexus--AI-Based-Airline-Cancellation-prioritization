"""Constraint plugin interface (Plan §8, decision D2).

A constraint is a registered class with an ``id``, a ``config`` dict (from constraints.yaml, editable in
the UI) and ``check(state, action) -> Violation | None``. Violations carry a human-readable reason that
the UI shows next to the excluded option. Hard constraints are never traded off (principle P2).

Two evaluation phases (§8, last paragraph):
* ``static``     – decidable from the snapshot alone (AOG, protected, curfew, delay bound, closure, user rules)
* ``simulated``  – need the propagated state (continuity, turnaround, FDTL, slots, stands, swap); Phase 2
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from ..config.registry import ConstraintDef, EngineConfig
from ..model import Action, State

Phase = Literal["static", "simulated"]


@dataclass(frozen=True)
class Violation:
    constraint_id: str
    reason: str
    details: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return f"[{self.constraint_id}] {self.reason}"


class Constraint(ABC):
    plugin_id: ClassVar[str]
    phase: ClassVar[Phase] = "static"

    def __init__(self, definition: ConstraintDef):
        self.definition = definition
        self.id = definition.id
        self.config = dict(definition.config)

    @abstractmethod
    def check(self, state: State, action: Action) -> Violation | None: ...

    def check_simulated(self, state: State, action: Action, result: Any) -> Violation | None:
        """Phase 2 hook: inspect the simulated consequences of ``action`` (a ``SimResult``). A rule that
        needs propagation to decide (continuity, turnaround, FDTL, slots, swap) implements this and
        typically asks: did a flight the action *targets* end up forced-cancelled for my reason?"""
        return None

    def violation(self, reason: str, **details: Any) -> Violation:
        return Violation(self.id, reason, details)


_REGISTRY: dict[str, type[Constraint]] = {}


def register(cls: type[Constraint]) -> type[Constraint]:
    """Class decorator: make a Constraint subclass available under its ``plugin_id``."""
    if not getattr(cls, "plugin_id", None):
        raise ValueError(f"{cls.__name__} needs a plugin_id")
    if cls.plugin_id in _REGISTRY:
        raise ValueError(f"duplicate constraint plugin id {cls.plugin_id!r}")
    _REGISTRY[cls.plugin_id] = cls
    return cls


def available_plugins() -> dict[str, type[Constraint]]:
    return dict(_REGISTRY)


def build_constraints(config: EngineConfig, phase: Phase | None = None) -> list[Constraint]:
    """Instantiate the enabled constraints from the config, in file order."""
    from . import builtin  # noqa: F401  - ensure builtin plugins are registered

    out: list[Constraint] = []
    for d in config.constraints:
        if not d.enabled:
            continue
        if d.kind == "expression":
            cls: type[Constraint] = _REGISTRY["expression_rule"]
        else:
            assert d.plugin is not None
            try:
                cls = _REGISTRY[d.plugin]
            except KeyError as e:
                raise ValueError(f"constraint {d.id}: unknown plugin {d.plugin!r}") from e
        inst = cls(d)
        if phase is None or inst.phase == phase:
            out.append(inst)
    return out


def check_all(
    constraints: Iterable[Constraint],
    state: State,
    action: Action,
    stop_at_first: bool = False,
) -> list[Violation]:
    found: list[Violation] = []
    for c in constraints:
        v = c.check(state, action)
        if v is not None:
            found.append(v)
            if stop_at_first:
                break
    return found


def check_all_simulated(constraints: Iterable[Constraint], state: State, action: Action, result: Any) -> list[Violation]:
    found: list[Violation] = []
    for c in constraints:
        v = c.check_simulated(state, action, result)
        if v is not None:
            found.append(v)
    return found


def feasibility_filter(
    constraints: Iterable[Constraint],
    state: State,
    actions: Iterable[Action],
) -> tuple[list[Action], list[Action]]:
    """Split actions into (feasible, infeasible); infeasible ones get their reasons filled in."""
    cs = list(constraints)
    feasible: list[Action] = []
    infeasible: list[Action] = []
    for a in actions:
        vs = check_all(cs, state, a)
        if vs:
            a.feasibility.status = "infeasible"
            a.feasibility.reasons = [str(v) for v in vs]
            infeasible.append(a)
        else:
            a.feasibility.status = "feasible"
            a.feasibility.reasons = []
            feasible.append(a)
    return feasible, infeasible


FlightPredicate = Callable[[Any], bool]
