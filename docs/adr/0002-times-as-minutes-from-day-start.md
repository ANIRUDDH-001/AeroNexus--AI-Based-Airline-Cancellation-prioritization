# ADR-0002: Engine times are integer minutes from day start

Status: accepted · Date: 2026-09-11

## Context
The simulator (§7) must evaluate thousands of candidate actions per recommendation. Timezone-aware datetimes are
slow to compare and awkward for cross-midnight arithmetic, which the plan treats as first-class (§7.7).

## Decision
All engine-side times are `int` minutes from `Instance.day_start` 00:00 local. Values above 1440 belong to the next
day. Conversion to clock time (`fmt_time`) happens only at the API/UI boundary.

## Consequences
Fast integer arithmetic; trivial cross-midnight handling; a single `day_start` per instance. Multi-day instances
(faculty track) extend the same scheme by allowing larger values, without a schema change.
