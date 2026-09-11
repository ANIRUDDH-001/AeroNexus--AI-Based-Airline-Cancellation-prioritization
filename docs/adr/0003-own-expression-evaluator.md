# ADR-0003: Own whitelisted expression evaluator instead of a third-party library

Status: accepted · Date: 2026-09-11

## Context
Score terms and user rules (§10.3, §15) are text expressions edited from the UI. They must never execute arbitrary
code. The plan named `simpleeval`; it is not installed in the team environment and its behaviour on attribute access
is broader than we need.

## Decision
`aeronexus_core.expressions` implements a ~150-line AST whitelist: arithmetic, comparisons, boolean logic,
conditional expressions, names from an explicit namespace, attribute access on `Namespace` objects, `.get()` as the
only method, and calls to a fixed function set (`min`, `max`, `abs`, `round`, `clamp`, `sum_affected`,
`max_affected`, `count_affected`). Unknown functions, dunder names, lambdas, comprehensions and keyword arguments
are rejected at parse time; terms are dry-run against a sample namespace before they are saved.

## Consequences
No dependency to audit; the whitelist is the specification; adding a helper is a one-line, reviewed change to
`KNOWN_HELPER_NAMES`.
