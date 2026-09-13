"""Hand-crafted validation cases (Plan §17.1): load a YAML case, build its instance, run the engine,
and check the expectation. Used by pytest, the API (/cases/run) and the Cases page.

Case file schema (data/cases/README.md):
    id, title, rationale
    instance: {base: tiny | small | medium, seed, overrides, patches: {flights: {id: {...}}, crews: {...}, airports: {...}, aircraft: {...}},
               remove: {aircraft: [tail], crews: [id]}}
    disruptions: [spec strings]
    decision_time: minutes
    expected: {top1: {type, target_flights, params?}, acceptable: [...], must_exclude: [{type, target_flights, params?, constraint}],
               top1_any_of_types: [...]}
    tolerances: {max_latency_ms}
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import yaml

from .config.registry import EngineConfig
from .model import Action, Instance, Run
from .search import recommend
from .validate import validate_instance

CASES_DIR = Path(__file__).resolve().parents[3] / "data" / "cases"


@dataclass
class CaseResult:
    id: str
    title: str
    passed: bool
    top1: list[str]
    expected: list[str]
    matched: str  # "top1" | "acceptable" | "type" | "none"
    checks: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    latency_ms: float = 0.0
    nis: float | None = None
    baseline_forced: float | None = None
    plan_forced: float | None = None
    rationale: str = ""
    run: Run | None = None


def _action(spec: dict[str, Any]) -> Action:
    return Action(type=spec["type"], target_flights=list(spec["target_flights"]), params=dict(spec.get("params", {})))


def _same(a: Action, b: Action) -> bool:
    return a.type == b.type and list(a.target_flights) == list(b.target_flights) and {k: v for k, v in a.params.items()} == {
        k: v for k, v in b.params.items()}


def build_instance(spec: dict[str, Any]) -> Instance:
    from aeronexus_datagen import GeneratorParams, generate
    from aeronexus_datagen.disruptions import inject, parse_spec
    from aeronexus_datagen.presets import tiny_instance

    base = spec.get("base", "tiny")
    if base == "tiny":
        inst = tiny_instance()
    else:
        inst = generate(GeneratorParams.for_size(base, int(spec.get("seed", 1)), **(spec.get("overrides") or {})))
    patches = spec.get("patches") or {}
    key = {"flights": "id", "crews": "id", "airports": "code", "aircraft": "tail", "itineraries": "id"}
    updates: dict[str, Any] = {}
    for entity, rows in patches.items():
        kf = key[entity]
        new_rows = []
        for r in getattr(inst, entity):
            patch = rows.get(getattr(r, kf))
            # re-validate so nested dicts (e.g. curfew windows) become proper models
            new_rows.append(type(r).model_validate({**r.model_dump(), **patch}) if patch else r)
        updates[entity] = new_rows
    from .model import Crew, Flight, Itinerary

    for entity, rows in (spec.get("add") or {}).items():
        cls = {"flights": Flight, "crews": Crew, "itineraries": Itinerary}[entity]
        current = updates.get(entity, list(getattr(inst, entity)))
        updates[entity] = current + [cls.model_validate(r) for r in rows]
    for entity, ids in (spec.get("remove") or {}).items():
        kf = key[entity]
        rows = updates.get(entity, list(getattr(inst, entity)))
        updates[entity] = [r for r in rows if getattr(r, kf) not in set(ids)]
    if updates:
        inst = inst.model_copy(update=updates)
    disruptions = spec.get("disruptions") or []
    if disruptions:
        rng = np.random.default_rng(0)
        inst = inject(inst, *[parse_spec(d, inst, rng) if isinstance(d, str) else d for d in disruptions])
    return inst


def load_case(path: Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def run_case(case: dict[str, Any], config: EngineConfig, surrogate: Any | None = None) -> CaseResult:
    inst = build_instance({**case["instance"], "disruptions": case.get("disruptions") or []})
    issues = validate_instance(inst)
    result = CaseResult(id=case["id"], title=case.get("title", case["id"]), passed=False, top1=[], expected=[],
                        matched="none", rationale=case.get("rationale", ""))
    if issues:
        result.failures.append(f"instance invalid: {issues[:3]}")
        return result
    run = recommend(inst, config, clock=int(case.get("decision_time", 0)), seed=int(case.get("seed", 1)), surrogate=surrogate)
    result.run = run
    result.latency_ms = run.latency_ms
    top = run.plans[0] if run.plans else None
    result.top1 = top.explanation["actions"] if top else []
    result.nis = top.nis if top else None
    result.baseline_forced = run.baseline_metrics.get("forced_downstream_cancellations")
    result.plan_forced = top.metrics.get("forced_downstream_cancellations") if top else None
    exp = case.get("expected") or {}
    exp_top1 = [_action(a) for a in ([exp["top1"]] if isinstance(exp.get("top1"), dict) else exp.get("top1") or [])]
    acceptable = [[_action(a) for a in (alt if isinstance(alt, list) else [alt])] for alt in exp.get("acceptable") or []]
    if "top1" in exp:
        result.expected = [f"{a.type}({'+'.join(a.target_flights)})" for a in exp_top1] or ["do nothing"]
    else:
        result.expected = [f"includes {_action(m).key()}" for m in exp.get("must_include") or []]

    def plan_matches(plan_actions: list[Action], wanted: list[Action]) -> bool:
        if len(plan_actions) != len(wanted):
            return False
        return all(any(_same(p, w) for w in wanted) for p in plan_actions)

    ok = True
    if "top1" in exp:
        got = top.actions if top else []
        if plan_matches(got, exp_top1):
            result.matched = "top1"
            result.checks.append("top-1 matches the expected plan")
        elif any(plan_matches(got, alt) for alt in acceptable):
            result.matched = "acceptable"
            result.checks.append("top-1 is an acceptable alternative")
        elif exp.get("top1_any_of_types") and got and all(a.type in exp["top1_any_of_types"] for a in got):
            result.matched = "type"
            result.checks.append("top-1 uses the expected action types")
        else:
            ok = False
            result.failures.append(f"top-1 was {result.top1 or ['do nothing']}, expected {result.expected}")
    got_actions = top.actions if top else []
    for mi in exp.get("must_include") or []:
        want = _action(mi)
        if any(_same(a, want) for a in got_actions):
            result.checks.append(f"plan includes {want.key()}")
        else:
            ok = False
            result.failures.append(f"plan does not include {want.key()}")
    for fid in exp.get("must_not_cancel") or []:
        cancelled = {x for a in got_actions if a.type in ("CANCEL_LEG", "CANCEL_CYCLE") for x in a.target_flights}
        forced = {f["flight"] for f in (top.explanation.get("forced_cancellations", []) if top else [])}
        if fid in cancelled or fid in forced:
            ok = False
            result.failures.append(f"{fid} was cancelled")
        else:
            result.checks.append(f"{fid} still operates")
    for me in exp.get("must_exclude") or []:
        want = _action(me)
        hit = next((a for a in run.excluded if _same(a, want)), None)
        cid = me.get("constraint")
        if hit is None:
            ok = False
            result.failures.append(f"{want.key()} was not excluded")
        elif cid and not any(r.startswith(f"[{cid}]") for r in hit.feasibility.reasons):
            ok = False
            result.failures.append(f"{want.key()} excluded but not by {cid}: {hit.feasibility.reasons}")
        else:
            result.checks.append(f"{want.key()} excluded" + (f" by {cid}" if cid else ""))
    for m in exp.get("plan_metrics") or []:
        name, op, val = m["metric"], m.get("op", "<="), float(m["value"])
        got_v = float(top.metrics.get(name, 0)) if top else 0.0
        good = {"<=": got_v <= val, ">=": got_v >= val, "==": got_v == val}[op]
        (result.checks if good else result.failures).append(f"{name} {got_v:g} {op} {val:g}")
        ok = ok and good
    tol = case.get("tolerances") or {}
    if tol.get("max_latency_ms") and run.latency_ms > float(tol["max_latency_ms"]):
        ok = False
        result.failures.append(f"latency {run.latency_ms:.0f} ms > {tol['max_latency_ms']} ms")
    result.passed = ok
    return result


def run_all(config: EngineConfig, cases_dir: Path | str = CASES_DIR, surrogate: Any | None = None) -> list[CaseResult]:
    out = []
    for p in sorted(Path(cases_dir).glob("case_*.yaml")):
        out.append(run_case(load_case(p), config, surrogate))
    return out


def main(argv: list[str] | None = None) -> int:
    """python -m aeronexus_core.cases [--surrogate] - print the pass/fail table for the suite."""
    import argparse
    import sys

    from .config.registry import config_hash, load_config

    ap = argparse.ArgumentParser(prog="aeronexus_core.cases")
    ap.add_argument("--config", default="configs")
    ap.add_argument("--surrogate", action="store_true", help="use the learned pre-ranker instead of the heuristic")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config(args.config)
    sur = None
    if args.surrogate:
        from aeronexus_ml import load_default

        sur = load_default()
    results = run_all(cfg, surrogate=sur)
    print(f"config {config_hash(cfg)}  pre-rank {'surrogate' if sur else 'heuristic'}")
    for r in results:
        top = " + ".join(r.top1) or "do nothing"
        print(f"  {'PASS' if r.passed else 'FAIL'}  {r.id:32s} {r.latency_ms:6.0f} ms  {top}")
        for f in r.failures:
            print(f"        - {f}")
    passed = sum(1 for r in results if r.passed)
    print(f"{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
