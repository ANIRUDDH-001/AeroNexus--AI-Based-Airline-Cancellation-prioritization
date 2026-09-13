# AeroNexus — Technical Brief

**AI-Based Cancellation Prioritization for Flight Disruptions**
IndiGo × UPES AI Challenge, Problem Statement 01 · Student track · Prachi Agarwalla, Aniruddh Vijayvargia · September 2026

---

## 1. The problem in one paragraph

When fog closes Delhi for three hours, or an aircraft goes technical at an outstation, the Operations Control
Centre (OCC) has minutes to decide which flights to cancel, delay or re-fleet so that the *rest* of the day —
aircraft rotations, crew duty limits, passenger connections, tomorrow's first wave — degrades as little as
possible. Today that judgement is made by experienced duty managers under time pressure, with spreadsheets
and phone calls. The cost of a wrong call is not the one flight cancelled; it is the three downstream flights
that cancel themselves an hour later because the aircraft or crew never arrived. AeroNexus is an advisory
system that ranks the options, shows the network consequences of each, and explains why — the controller
decides.

## 2. What we built

A working, deployable system (monorepo `aeronexus/`), free-tier throughout:

| Layer | Content |
|---|---|
| **Engine** (`packages/core`) | Domain model; discrete-event simulator; hard-constraint plugins; Network Impact Score; beam search; explanations; 12-case suite; benchmark ladder |
| **Synthetic data** (`packages/datagen`) | Seeded IndiGo-like network generator (12 airports, 40 A320/A321/ATR tails, ~250 flights, crews with FDTL windows, passenger itineraries) and disruption templates |
| **Learning** (`packages/ml`) | LightGBM surrogate pre-ranker trained on simulated evaluations; SHAP score drivers |
| **API** (`apps/api`) | FastAPI, 36 endpoints; SQLite locally, Supabase Postgres hosted; every run stored with its `config_hash` |
| **UI** (`apps/web`) | React + TypeScript, Notion-style light theme: Overview, Disruptions, Recommendations, Flights & resources, Parameters, Cases & benchmarks, Runs, Data |
| **Quality** | 93 pytest tests, ruff, GitHub Actions CI; offline `static-runs` demo bundle |

No real IndiGo data is used or assumed. Every number in this brief is reproducible from a seed.

## 3. How a recommendation is produced

```
disruption ──► at-risk detection ──► candidate actions ──► hard-constraint filter ──► beam search
                (simulate "do nothing")   cancel leg / cycle,     H1–H10, with reasons      (K=5, D=3, M=12, S=10)
                                          delay, swap                                          │
      controller ◄── ranked plans + reasons + confidence ◄── Network Impact Score ◄── simulator on sampled futures
```

**Simulator.** For any plan it replays the day: each leg waits for its aircraft (previous leg + turnaround),
its crew (report time, FDTL limit, location, CAT-III qualification; standby call-out if the rostered crew
is illegal or absent), a departure slot (hourly capacity, closures, curfews — with *ground-hold* rather than
airborne holding when the destination is closed) and cancels itself if the delay exceeds the configured cap.
Passengers on cancelled or missed connections are re-protected onto later flights with seats, or counted as
stranded overnight. Output: per-leg outcomes and ~20 day-level metrics (forced downstream cancellations,
propagated delay, next-wave shortfall, misconnects, stranded passengers, standby use, compensation exposure…).

**Hard constraints (P2).** Crew legality, AOG, curfews, fleet/type compatibility, protected flights,
minimum turnaround, delay caps, and user-defined rules (`H10`) are plugins. A violated constraint removes
the action and records *why* ("[H4a] would arrive BOM inside curfew"); it is never traded off against cost.

**Score.** The Network Impact Score is a registry of 18 weighted terms in four levels (operational →
passenger → cost → strategic), 1 point ≈ ₹1,000, editable at run time and hashed into every result. Two
ranking modes: `composite` (weighted sum) and `priority` (lexicographic by level).

**Search.** Candidates are pre-ranked (heuristic or surrogate), the best M are simulated on S sampled
futures (disruption end time, block-time noise), scored, and the best K nodes are extended up to depth D;
equivalent plans are grouped; the finalists are re-evaluated on a fresh sample set; hysteresis keeps the
previous recommendation unless the new one is clearly better. Typical latency on the medium network:
1.7 s mean, 3.2 s p95, within the 5 s budget.

**Explanations.** Every plan carries templated reasons from its own metrics ("cancels 3 flights affecting
599 passengers; forces 1 downstream cancellation: 6E2018; 341 passengers miss a connection"), deltas versus
do-nothing, why it beats #2, equivalent alternatives, and a four-part confidence readout (feasibility share,
data age, stability, scenario sensitivity). An LLM narration adapter exists behind a flag and may only
reword these facts — it never sees anything the templates did not compute.

## 4. Where the AI is — and where it is not

* **Deciding** is done by search over a simulator with explicit constraints: deterministic, auditable,
  reproducible. This is deliberate — an OCC will not act on a black box, and a model trained on synthetic
  data cannot be trusted to *decide* for a real airline.
* **Learning** makes the search affordable: a LightGBM surrogate trained on 4,368 simulated
  (state, action) → score pairs predicts which candidates are worth simulating (held-out Spearman 0.56
  against the simulator's ranking). SHAP contributions of the top plan are shown as "score drivers". If the
  model file is removed the engine falls back to a heuristic order and still passes every case.
* **Not used**: LLM decision-making, reinforcement learning, or any API key. The system runs entirely on a
  laptop.

## 5. Nothing is rigid

The brief asked for a system that a user can extend. Concretely: add a column on the Flights page (say
`vip_count`), reference it in a new score term `sum_affected('vip_count') * 300` or in a rule
`flight.vip_count > 10 → protected`, and re-run — no code change. Parameters, weights, constraints, search
settings and presets are all YAML registries surfaced in the Parameters page; every edit bumps the config
version and hash. Expressions are evaluated by a whitelisted AST interpreter (no `eval`).

## 6. Validation

**Hand-crafted cases (12, all passing).** Each is a small day with a known right answer and a rationale a
duty manager would recognise: heavy vs light flight on one rotation; connector vs local; FDP breach with /
without standby; a curfew no delay can recover; a capacity cut; AOG with a spare at the hub; cancel the
cycle, not the leg; tonight's choice vs tomorrow's first wave; thin vs trunk route; CAT-III qualification as
the binding constraint; a crew-shortage day. Cases assert the top-1 plan, flights that must survive, actions
that must be *excluded by a named constraint*, and metric bounds.

**Benchmark ladder.** Every policy's chosen plan is scored on a *separate* evaluation simulator (different
random seed, block-time noise the search never sees, 40 futures per plan), so the engine cannot grade its
own homework.

| Policy | Mean NIS | vs B0 | Win rate vs B0 | Forced cancels | Pax stranded | Latency |
|---|---|---|---|---|---|---|
| Do nothing | 54,780 | −9.5 % | 33 % | 5.17 | 650 | — |
| B0 naive (cancel the at-risk flight with fewest pax) | 60,536 | — | — | 5.59 | 734 | — |
| B1 weighted heuristic (pax + downstream legs + crew risk) | 56,000 | −7.5 % | 28 % | 4.61 | 692 | — |
| **B2 AeroNexus** | **44,537** | **−26.4 %** | **83 %** | **2.08** | **550** | 1.7 s / p95 3.2 s |
| B2s AeroNexus + surrogate pre-rank | 45,921 | −24.1 % | 83 % | 2.07 | 583 | 1.8 s / p95 3.4 s |

30 generated scenarios (small/medium networks; fog, capacity, AOG, crew, ATC, mixed), `data/benchmarks/latest.json`.
The naive rule is *worse than doing nothing*: cancelling the lightest at-risk flight often removes an
aircraft the network still needed. The engine's gain comes mostly from fewer forced downstream cancellations
(2.1 vs 5.6) and fewer stranded passengers.

The same protocol on **200 generated scenarios** (124 with at-risk flights, `data/benchmarks/ladder_200.json`)
gives a more conservative picture, which we report as the headline: **AeroNexus −16.3 % NIS vs B0, win rate
82 %, forced downstream cancellations 4.1 vs 6.9, stranded 650 vs 780** (do nothing −3.3 %, B1 −1.8 %).
By disruption type the gain is largest for AOG (−30 %) and crew shortage (−19 %) and smallest for fog (−11 %):
with a lognormal fog end (σ = 0.5) the engine's plan is worse than waiting in 6 of 30 fog days — the price of
deciding on ten sampled futures when the evaluation draws forty. Raising `S` narrows that gap at the cost of
latency; it is a configuration knob, not a code change.

## 7. Demo and deployment

Hosted: Vercel (UI) + Render free web service (API) + Supabase Postgres (storage). Pitch day: the engine on
a laptop behind a Cloudflare Tunnel (no cold start). If everything is unreachable the UI switches to a
precomputed `static-runs` bundle (demo day, six decision times, cases, ladder) and says so in the sidebar.
`docs/deploy.md` has the steps and a pre-demo checklist.

## 8. Honest limitations

* **Synthetic data.** Network structure, block times, crew pairings and passenger flows are generated to
  look like IndiGo's but are not calibrated on real operations. FDTL limits and DGCA compensation values are
  placeholders marked VERIFY.
* **Single crew set per flight**, no cabin-crew model, no maintenance slots, no slot-swap negotiation with
  ATC, no revenue management feed.
* **Bounded swaps** only (same base, same type or configured compatibility); no full re-fleeting
  optimisation — that is the faculty-track CP-SAT baseline (B3).
* Search is heuristic: no optimality guarantee. The ladder measures improvement over sensible baselines,
  not distance from an optimum.
* Overlapping cycle cancellations inside one plan are correct but could be presented as a single action.

## 9. Roadmap (faculty track, Plan §23)

CP-SAT exact baseline for the optimality gap; calibration on ROADEF/public schedules; learned candidate
guidance and, later, RL over the simulator; cabin crew and maintenance; expert-agreement study (Kendall τ)
with duty managers; hardened multi-user deployment.

---

*Repository: `aeronexus/` — `README.md` for quick start, `docs/AeroNexus_Implementation_Plan.md` for the
full design (26 sections, decision log D1–D12), `docs/adr/` for architecture decisions.*
