# The console, screen by screen

What each screen shows, where every number comes from, and how it is computed. Paths are under `apps/occ/src`
unless stated; engine code is under `packages/core/aeronexus_core`.

## The shell (every screen)

| element | what it is | how it works |
|---|---|---|
| Wordmark + page tabs | Operations, Flights & resources, Runs, Parameters, Cases & benchmarks, Data, How it works | `components/shell/TopBar.tsx`; on tablets three tabs + *More*, on phones a bottom tab bar (`MobileTabBar.tsx`) with Today / Board / Map / Plans / More |
| Day switcher | which generated day the console looks at | `GET /data/instances`; the choice lives in the URL (`?day=`) so every screen is linkable; `hooks/useDay.ts` |
| Decision time | the moment the engine decides from (default 07:00) | `?t=` on a 15-minute grid; everything before it is "already happened", everything after is forecast; `ClockControl.tsx` |
| Engine status | online / starting / unavailable / error, with the demo pill and banner | `GET /health` polled by `hooks/useEngine.tsx`; "Wake engine" probes the Render service until it answers |
| Live engine / Demo result tags | on every result, which engine produced it | every API result is tagged `{ data, origin: "live" \| "demo" }` in `lib/api.ts`; when the engine is unreachable, read-only calls are answered from the precomputed bundle in `public/static-runs` |
| Definitions (dotted underline) | what each number means | `lib/glossary.ts`, rendered by `<Define>`: tooltip on desktop, popover on touch |
| Install app | Chrome's install prompt, or the iOS route | `components/shell/InstallApp.tsx`; the service worker (`src/sw/sw.js`) precaches every page and the demo bundle |

## Operations (`/`)

The centre of the console. One question: *what is at risk today, what does the engine propose, why, and what does
it cost?* Reasoning order is always **if nobody acts → recommended → alternatives**.

**Headline and context** (`components/ops/Headline.tsx`). One sentence built from `GET /timeline?instance_id&t`:
"If nobody acts, N flights cancel themselves today and M passengers are stranded overnight." Below it the
disruptions in words (`components/disruptions/describe.ts`), and "X flights have already departed; Y remain under
consideration from HH:MM". The six KPI tiles are the timeline summary (`at_risk`, `forced`, `delayed`,
`misconnects`, `stranded`, `standby_used`); clicking one filters the board.

**How the timeline is computed.** The engine replays the whole day from the decision time (`simulator/engine.py`):
each leg needs its aircraft at the origin, a legal crew (FDTL rules in `fdtl.py`), a slot and an open airport;
delays propagate along the rotation and through crews; passengers miss connections. A flight that cannot operate
"cancels itself" (`CANCELLED_FORCED`). `detect_at_risk` (`search/candidates.py`) then lists every flight that is
forced or delayed beyond `at_risk_delay_threshold_min` (45 min), with the reason in words.

**Rotations board** (`components/board/`). One row per tail, sorted AOG → forced → at risk → tail; strips are
flights positioned by scheduled time on a Day / 12 h / 6 h window with the amber decision-time line and lilac
weather bands. Strip states: on time, delayed (+40), at risk, cancels itself (hatched), cancelled by plan, protected
(check), committed (pin), already happened (shaded); state never travels by colour alone. Views: *If nobody acts*
(the timeline), *With plan* (`POST /timeline/plan` with the shown plan's actions — the engine re-simulates the day
with those decisions applied), *Changes only* (`lib/diff.ts` compares the two timelines and keeps the tails that
change). Rows are virtualised (TanStack Virtual) so 300 tails scroll smoothly; hover or tap a strip for its story.

**Network map** (`components/map/NetworkMap.tsx`). Airports from `GET .../table/airports`, projected with d3-geo
onto land drawn from Natural Earth's India point-of-view boundaries (`public/geo/south-asia.json`, built by
`scripts/build-geo.mjs` — the Survey of India external boundary). Arcs are routes flown today, coral where a flight
cancels, amber by share of the day's worst at-risk route; airports are lit by at-risk count relative to the day's
worst airport, halos on the twelve worst, lilac pulse on airports with an unconsidered disruption. Labels are
capped at fourteen and never overlap; every airport keeps its tooltip and aria-label. Situational awareness only —
the board is the argument.

**Disruptions** (`components/disruptions/`). Chips for what has gone wrong; *Add disruption* opens a sheet whose
form matches the generator grammar (`toSpec`), posts `POST /data/instances/{id}/disruptions`, then shows the impact
as "before → after" by comparing the timeline before and after, with *Undo* (`DELETE .../disruptions/{did}`).

**At risk now** (`components/ops/AtRiskList.tsx`). The timeline's `at_risk` list: flight, route, time and the
engine's reason ("aircraft VT-IAD is AOG", "crew C0554 would exceed FDP by 25 min; no standby available at IXM").

**Plans** (`components/plans/`). *Get a recommendation* calls `POST /recommend` and shows the working bar; the
result is a `Run`. Layout: the **If nobody acts** card (`run.baseline_metrics`), the **Recommended** card
(`plans[0]`), then alternatives. Each card in a fixed order:

1. *Do this* — the actions as one sentence (`actionSentence`): cancel a leg or a cycle, hold by N minutes,
   re-fleet onto another tail, or wait.
2. *Impact avoided if we act* — baseline metrics minus plan metrics (cancellations, stranded, delay, missed
   connections).
3. *Why* — the causal chain (`CausalChain.tsx`) from `explanation.reasons`, `forced_cancellations` and what the
   plan prevents (`preventsFromRun` in `lib/diff.ts`).
4. *Result* — outcomes side by side with the baseline; rupees second.
5. *Reliability* — from `explanation.confidence` and `scenario_stats`: feasible in k of S sampled futures,
   lowest-impact in k of S, sensitivity, and the network impact score in a definition.

Buttons: *Accept plan* (`POST /runs/{id}/decision` → the actions are committed to the day → the screen moves to
**What changed** with "continue to the next decision"), *Show changes* (puts the plan on the board), *Why plan 1 over
plan 2?* (`explanation.comparison`), *How this plan was found* (`Expanded.tsx`: operational reason, search result
with the sampled-futures strip, ML pre-ranking with SHAP drivers in words, narration), *Record an override*.

When the engine's time budget ran out before it could simulate a single action (`depth_reached === 0`), the console
says so instead of calling "wait" a recommendation, lists the engine's own notes, and offers *Run again* and *Raise
the search budget*.

**Today's decisions** (`components/ops/DecisionsList.tsx`). The day's trail: disruptions by start time and every
run at its decision time with its status (recommended / accepted / overridden); committed chips; *Reset the day*
(`POST .../committed/reset`).

## Flights & resources (`/flights`)

`components/flights/EntityBrowser.tsx`. Tabs for flights, aircraft, crews, airports, itineraries from
`GET /data/instances/{id}/table/{entity}`; filters by state and airport; a table on desktop, cards on phones.
Opening a row shows a drawer with inline edits (`PATCH .../{entity}/{key}`, write key when the API requires one)
and *Add column* (`POST .../columns`). Flight state comes from the timeline at the current decision time.

## Runs (`/runs`)

`components/runs/RunsPage.tsx`. `GET /runs?instance_id` (or all days): when, decision time, recommended actions,
status, at-risk count, plans evaluated, budget used (futures and depth), time, configuration hash and day
fingerprint — the audit trail. Opening a run (`GET /runs/{id}`) shows its plan cards read-only.

## Parameters (`/parameters`)

`components/parameters/ParametersPage.tsx`. `GET /config`. Two levels: **Operational policy** (what a duty manager
may change: decision horizon, plans returned, hysteresis, deterministic replay) and **Engine configuration**
(experimental — it changes what the benchmark means): what the engine minimises (the objective terms by level,
weight and on/off), the hard rules, the search budget (K, D, M, N, S, time budget), and cost and policy values.
Saves go to `PUT /config/{terms,constraints,parameters,search}`; presets to `GET/POST /config/presets`;
*Restore defaults* to `POST /config/reset`. The configuration hash is shown because every run records the hash it
used; same hash, same engine. `?tab=search` opens the search-budget tab directly.

## Cases & benchmarks (`/cases`)

`components/cases/CasesPage.tsx`. The twelve hand-crafted cases (`GET /cases`, `POST /cases/run`, `GET
/cases/latest`; the console falls back to the bundle's copy when this engine has not run them yet) with expected
vs. got, and the benchmark ladder (`GET /benchmark/latest`): mean network impact per policy over the benchmark
days — do nothing, the naive rule, the weighted rule of thumb, AeroNexus, AeroNexus with the ML pre-ranker — plus
the limitations block.

## Data (`/data`)

`components/data/DataPage.tsx`. The days that exist (`GET /data/instances`), *Generate a synthetic day*
(`POST /data/generate` with size, seed and the disruption presets), *Import a day* (`POST /data/import`, the
engine's validation problems are listed), delete.

## How it works (`/how-it-works`)

`components/how/HowItWorks.tsx`. The seven pipeline steps with today's live numbers — the day, what happens if
nobody acts, candidate actions, search, sampled futures, ranking, explanation — each with "what this is not", and
the glossary.

## The engine pipeline behind a recommendation (`search/recommend.py`)

1. **Baseline** — simulate the day from the decision time with the committed decisions; detect at-risk flights.
2. **Candidates** — for each at-risk flight inside the decision horizon (8 h): cancel the leg, cancel its cycle,
   hold it (30/60/90/120/180 min), or re-fleet it onto an aircraft parked at the origin at departure time.
3. **Hard rules** — every candidate is checked against the static rules (aircraft continuity, crew limits, curfews,
   slots, protected flights); failures are listed with the reason as *excluded*.
4. **Pre-rank** — the surviving candidates are ordered, by the LightGBM surrogate when loaded, else by a heuristic;
   only the top M (12) per step are simulated. The model orders; it never decides.
5. **Beam search** — simulate each candidate (a full-day replay), keep the K (5) best partial plans, deepen up to
   D (3) actions; "do nothing" always stays in the race. The latency budget trims S, then depth, and says so in
   `run.notes`.
6. **Sampled futures** — the uncertain parts (fog end, block-time noise) are drawn S (10) times and the N (8)
   finalists replayed under each: expected impact, P90, stability, feasibility share.
7. **Rank and explain** — composite or priority ranking on expected impact; reasons, deltas versus doing nothing,
   comparison with the next plan, SHAP drivers for the recommended plan, optional LLM narration that never adds a
   number the engine did not compute.

Determinism: same day, same committed decisions, same configuration hash, same seed → same run. `search.deterministic`
turns the budget cuts off for audits and for the demo bundle (`scripts/precompute_demo.py`, checked by
`scripts/check_static_parity.py`).
