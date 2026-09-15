# Console ↔ API contract matrix

Every feature of the console, the endpoint it uses, and the state of that endpoint (spec §10.3). Types in
`apps/occ/src/lib/api.types.ts` are generated from `apps/occ/openapi.json` (`python scripts/export_openapi.py`,
then `npm run api:types`); `tests/test_api_schemas.py` fails when the committed document is stale.

Status: **existing** — served and typed; **typed in Phase 0** — existed as an untyped dict, now has a response
model; **optional** — a nicety the console lives without.

| feature | endpoint | status | notes |
|---|---|---|---|
| Engine status, demo pill, banner | `GET /health` | typed in Phase 0 (`HealthOut`) | narration mode, write-key flag |
| Day switcher, default demo day | `GET /data/instances` | typed in Phase 0 (`InstanceRowOut`) | |
| Headline, KPIs, board, at-risk list, decision-time sentence | `GET /timeline?instance_id&t` | typed in Phase 0 (`TimelineOut`) | per-flight outcomes, at-risk reasons, committed summary |
| Board after view, changes only, map deltas, protected flights | `POST /timeline/plan` | existing (was uncommitted; committed with Phase 0) | `build_timeline(..., actions)` |
| Get a recommendation, run again, auto-run after a disruption | `POST /recommend` | existing (`Run`) | `seed`, `previous_run_id` for hysteresis |
| Plan cards, chain, reliability, why-over-next, ML drivers, narration | `Run.plans[].explanation` | existing | `score_drivers` on the recommended plan when the surrogate is loaded; `scenario_stats.values` was uncommitted, committed with Phase 0 |
| Latest run at this decision time, today's decisions | `GET /runs?instance_id` | typed in Phase 0 (`RunRowOut`) | `effective` = budget used |
| Open a run, Runs page detail | `GET /runs/{id}` | existing (`Run`) | |
| Accept, override | `POST /runs/{id}/decision` | existing (`Run`) | accepted plan is committed to the day |
| Committed chips, reset the day | `GET/POST /data/instances/{id}/committed[/reset]` | typed in Phase 0 (`CommittedOut`) | |
| Add / remove a disruption, impact after add | `POST/DELETE /data/instances/{id}/disruptions[/{did}]` | existing (`InstanceSummary`) | impact = timeline before vs after; no dry run |
| Network map airports | `GET /data/instances/{id}/table/airports` | typed in Phase 2 (`TableOut`) | |
| Flights & resources tables, drawer, inline edit, add column | `GET .../table/{entity}`, `PATCH .../{entity}/{key}`, `POST .../columns` | typed in Phase 2 / existing | write key when the API requires one |
| Data: generate, import, delete | `POST /data/generate`, `POST /data/import`, `DELETE /data/instances/{id}` | existing (`InstanceCreated`, `DeletedOut`) | import was never exposed by the old UI |
| Parameters: read, terms, rules, search, values, presets, reset | `GET /config`, `PUT /config/{terms,constraints,parameters,search}`, `GET/POST /config/presets…`, `POST /config/reset` | existing (`ConfigEnvelope`); presets typed in Phase 0 | |
| Glossary completeness test | `GET /config/metrics` | typed in Phase 0 (`MetricsOut`) | test reads the static bundle's copy |
| Cases list, run, latest | `GET /cases`, `POST /cases/run`, `GET /cases/latest` | typed in Phase 2 (`CaseDefOut`, `CasesRunOut`) | latest is 404 until a run on this engine; the console falls back to the bundle's copy |
| Benchmark ladder | `GET /benchmark/latest`, `POST /benchmark/run` | typed in Phase 2 (`BenchmarkOut`) | `stale` when the hash differs |
| Demo mode | `public/static-runs/*` | bundle, deterministic (`scripts/precompute_demo.py`) | parity with the engine checked by `scripts/check_static_parity.py` |

## Optional additions (not needed by the console)

| idea | why it would help |
|---|---|
| `POST /timeline/preview` with ad-hoc disruptions | impact before adding a disruption, instead of add → impact → undo |
| `created_at` on disruptions | the decisions trail could show when a disruption was added, not only when it starts |
| a baseline `nis` on the run | the score definition could show "1,842 against 4,110" without a do-nothing finalist |
