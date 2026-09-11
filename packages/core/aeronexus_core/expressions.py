"""Safe expression language for score terms and user-defined rules (Plan §10.3, §15).

A tiny whitelisted subset of Python expressions, evaluated over an explicit namespace:

* literals, ``+ - * / // % **``, unary ``-``/``not``, comparisons, ``and``/``or``, ``x if c else y``
* names from the namespace (metrics, parameters)
* attribute access on ``Namespace`` objects (e.g. ``flight.attrs.vip_count``)
* subscripts on dicts/lists (``attrs["vip_count"]``)
* calls to whitelisted functions only (``min``, ``max``, ``abs``, ``round``, ``sum_affected`` ...)

Anything else (imports, lambdas, comprehensions, dunder access, arbitrary calls) is rejected at parse time,
so a bad term can never execute code. Terms are validated with a dry run before they are saved (§15.3).
"""
from __future__ import annotations

import ast
import operator
from collections.abc import Callable, Mapping
from typing import Any

__all__ = ["ExpressionError", "Namespace", "compile_expression", "evaluate", "validate_expression"]


class ExpressionError(ValueError):
    """Raised for disallowed syntax, unknown names or runtime failures inside an expression."""


class Namespace:
    """Read-only attribute bag so expressions can write ``flight.attrs.x`` instead of dict lookups."""

    __slots__ = ("_data",)

    def __init__(self, data: Mapping[str, Any]):
        object.__setattr__(self, "_data", dict(data))

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise ExpressionError(f"attribute {name!r} is not accessible")
        try:
            v = self._data[name]
        except KeyError as e:
            raise ExpressionError(f"unknown attribute {name!r}") from e
        return Namespace(v) if isinstance(v, Mapping) else v

    def __getitem__(self, key: str) -> Any:
        v = self._data[key]
        return Namespace(v) if isinstance(v, Mapping) else v

    def __contains__(self, key: str) -> bool:
        return key in self._data

    def get(self, key: str, default: Any = 0) -> Any:
        v = self._data.get(key, default)
        return Namespace(v) if isinstance(v, Mapping) else v

    def keys(self):
        return self._data.keys()


_BIN_OPS: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_CMP_OPS: dict[type[ast.cmpop], Callable[[Any, Any], bool]] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}
_UNARY_OPS: dict[type[ast.unaryop], Callable[[Any], Any]] = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Not: operator.not_,
}

_MAX_POW = 1_000  # guards against 10 ** 10 ** 10 style blow-ups


def _safe_pow(a: Any, b: Any) -> Any:
    if isinstance(b, (int, float)) and abs(b) > _MAX_POW:
        raise ExpressionError("exponent too large")
    return operator.pow(a, b)


_BIN_OPS[ast.Pow] = _safe_pow

BUILTIN_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "min": min,
    "max": max,
    "abs": abs,
    "round": round,
    "int": int,
    "float": float,
    "bool": bool,
    "clamp": lambda x, lo, hi: max(lo, min(hi, x)),
}


# Helper functions the engine binds at evaluation time (scoring.nis.affected_helpers). Listed here so a
# term can be validated structurally before any state exists.
KNOWN_HELPER_NAMES: frozenset[str] = frozenset({"sum_affected", "max_affected", "count_affected"})
SAFE_METHODS: frozenset[str] = frozenset({"get"})  # methods allowed on namespaces / dicts


def known_function_names() -> frozenset[str]:
    return frozenset(BUILTIN_FUNCTIONS) | KNOWN_HELPER_NAMES


class _Evaluator(ast.NodeVisitor):
    def __init__(self, names: Mapping[str, Any], functions: Mapping[str, Callable[..., Any]]):
        self.names = names
        self.functions = functions

    # -- entry
    def eval(self, node: ast.AST) -> Any:
        return self.visit(node)

    def generic_visit(self, node: ast.AST) -> Any:  # anything not explicitly allowed
        raise ExpressionError(f"syntax not allowed: {type(node).__name__}")

    # -- allowed nodes
    def visit_Expression(self, node: ast.Expression) -> Any:
        return self.visit(node.body)

    def visit_Constant(self, node: ast.Constant) -> Any:
        if isinstance(node.value, (int, float, str, bool)) or node.value is None:
            return node.value
        raise ExpressionError(f"constant not allowed: {node.value!r}")

    def visit_Name(self, node: ast.Name) -> Any:
        if node.id in self.names:
            v = self.names[node.id]
            return Namespace(v) if isinstance(v, Mapping) else v
        if node.id in self.functions:
            return self.functions[node.id]
        raise ExpressionError(f"unknown name {node.id!r}")

    def visit_Attribute(self, node: ast.Attribute) -> Any:
        if node.attr.startswith("_"):
            raise ExpressionError(f"attribute {node.attr!r} is not accessible")
        base = self.visit(node.value)
        if isinstance(base, Namespace):
            return getattr(base, node.attr)
        raise ExpressionError(f"attribute access only allowed on namespaces, not {type(base).__name__}")

    def visit_Subscript(self, node: ast.Subscript) -> Any:
        base = self.visit(node.value)
        key = self.visit(node.slice)
        if isinstance(base, (Namespace, dict, list, tuple, str)):
            try:
                return base[key]
            except (KeyError, IndexError, TypeError) as e:
                raise ExpressionError(f"bad subscript {key!r}") from e
        raise ExpressionError("subscript not allowed on this value")

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        fn = _BIN_OPS.get(type(node.op))
        if fn is None:
            raise ExpressionError(f"operator not allowed: {type(node.op).__name__}")
        try:
            return fn(self.visit(node.left), self.visit(node.right))
        except ZeroDivisionError as e:
            raise ExpressionError("division by zero") from e

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        fn = _UNARY_OPS.get(type(node.op))
        if fn is None:
            raise ExpressionError(f"operator not allowed: {type(node.op).__name__}")
        return fn(self.visit(node.operand))

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        if isinstance(node.op, ast.And):
            result: Any = True
            for v in node.values:
                result = self.visit(v)
                if not result:
                    return result
            return result
        result = False
        for v in node.values:
            result = self.visit(v)
            if result:
                return result
        return result

    def visit_Compare(self, node: ast.Compare) -> bool:
        left = self.visit(node.left)
        for op, comp in zip(node.ops, node.comparators, strict=True):
            fn = _CMP_OPS.get(type(op))
            if fn is None:
                raise ExpressionError(f"comparison not allowed: {type(op).__name__}")
            right = self.visit(comp)
            if not fn(left, right):
                return False
            left = right
        return True

    def visit_IfExp(self, node: ast.IfExp) -> Any:
        return self.visit(node.body) if self.visit(node.test) else self.visit(node.orelse)

    def visit_Call(self, node: ast.Call) -> Any:
        if node.keywords:
            raise ExpressionError("keyword arguments are not allowed")
        if isinstance(node.func, ast.Attribute):
            # namespace.get('key', default) - the only method calls allowed
            if node.func.attr not in SAFE_METHODS:
                raise ExpressionError(f"method not allowed: {node.func.attr!r}")
            base = self.visit(node.func.value)
            if not isinstance(base, (Namespace, dict)):
                raise ExpressionError(f"{node.func.attr}() only allowed on namespaces")
            args = [self.visit(a) for a in node.args]
            if isinstance(base, dict):
                base = Namespace(base)
            return base.get(*args)
        if not isinstance(node.func, ast.Name):
            raise ExpressionError("only direct calls to whitelisted functions are allowed")
        fn = self.functions.get(node.func.id)
        if fn is None:
            raise ExpressionError(f"function not allowed: {node.func.id!r}")
        args = [self.visit(a) for a in node.args]
        try:
            return fn(*args)
        except ExpressionError:
            raise
        except Exception as e:  # noqa: BLE001 - surface any helper failure as an expression error
            raise ExpressionError(f"{node.func.id}: {e}") from e

    def visit_List(self, node: ast.List) -> list[Any]:
        return [self.visit(e) for e in node.elts]

    def visit_Tuple(self, node: ast.Tuple) -> tuple[Any, ...]:
        return tuple(self.visit(e) for e in node.elts)


def compile_expression(source: str) -> ast.Expression:
    """Parse and structurally validate an expression. Raises ExpressionError on disallowed syntax."""
    if not isinstance(source, str) or not source.strip():
        raise ExpressionError("empty expression")
    try:
        tree = ast.parse(source.strip(), mode="eval")
    except SyntaxError as e:
        raise ExpressionError(f"syntax error: {e.msg}") from e
    # Structural walk with a dummy evaluator that only checks node types (no names needed)
    for node in ast.walk(tree):
        if not isinstance(
            node,
            (
                ast.Expression, ast.Constant, ast.Name, ast.Attribute, ast.Subscript, ast.BinOp, ast.UnaryOp,
                ast.BoolOp, ast.Compare, ast.IfExp, ast.Call, ast.List, ast.Tuple, ast.Load,
                ast.And, ast.Or, ast.operator, ast.unaryop, ast.cmpop,
            ),
        ):
            raise ExpressionError(f"syntax not allowed: {type(node).__name__}")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ExpressionError(f"attribute {node.attr!r} is not accessible")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise ExpressionError(f"name {node.id!r} is not accessible")
        if isinstance(node, ast.Call):
            if node.keywords:
                raise ExpressionError("keyword arguments are not allowed")
            if isinstance(node.func, ast.Name):
                if node.func.id not in known_function_names():
                    raise ExpressionError(f"function not allowed: {node.func.id!r}")
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr not in SAFE_METHODS:
                    raise ExpressionError(f"method not allowed: {node.func.attr!r}")
            else:
                raise ExpressionError("only direct calls to whitelisted functions are allowed")
    return tree


def evaluate(
    source: str | ast.Expression,
    names: Mapping[str, Any],
    functions: Mapping[str, Callable[..., Any]] | None = None,
) -> Any:
    """Evaluate ``source`` against ``names`` (metrics/parameters) and whitelisted ``functions``."""
    tree = compile_expression(source) if isinstance(source, str) else source
    fns = dict(BUILTIN_FUNCTIONS)
    if functions:
        fns.update(functions)
    return _Evaluator(names, fns).eval(tree)


def validate_expression(
    source: str,
    sample_names: Mapping[str, Any],
    functions: Mapping[str, Callable[..., Any]] | None = None,
) -> list[str]:
    """Dry-run an expression against a sample namespace; returns a list of problems (empty = ok)."""
    try:
        value = evaluate(source, sample_names, functions)
    except ExpressionError as e:
        return [str(e)]
    if not isinstance(value, (int, float, bool)):
        return [f"expression must evaluate to a number or boolean, got {type(value).__name__}"]
    return []
