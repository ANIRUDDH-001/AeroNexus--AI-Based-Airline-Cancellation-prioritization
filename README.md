# AeroNexus

**AI-Based Cancellation Prioritization for Flight Disruptions** — advisory decision support for an airline
Operations Control Centre. IndiGo × UPES AI Challenge, Problem Statement 01.

When a disruption puts many flights at risk, AeroNexus shows the controller the three best plans
(cancel / delay / bounded swap), what each does to the rest of the day across aircraft, crew and
passengers, and why — in seconds, with every recommendation reproducible from its `config_hash`.

The single source of truth for design and roadmap is
[docs/AeroNexus_Implementation_Plan.md](docs/AeroNexus_Implementation_Plan.md). Deployment lives in
[docs/deploy.md](docs/deploy.md); the technical brief in [docs/AeroNexus_Technical_Brief.md](docs/AeroNexus_Technical_Brief.md).

## How it works (no LLM in the loop)

1. **Simulate** — a discrete-event simulator propagates a plan through the day: aircraft rotations and
   turnarounds, crew FDTL limits and standby call-outs, airport closures / curfews / capacity (ground-hold),
   passenger connections and re-protection (`packages/core/aeronexus_core/simulator`).
2. **Filter** — hard constraints H1–H10 are plugins that reject infeasible actions with a reason; they are
   never traded off against the score (`constraints/`).
3. **Search** — candidates (cancel leg, cancel cycle, delay, swap) are pre-ranked, simulated on sampled
   futures, scored with the Network Impact Score (18 configurable terms, 1 point ≈ ₹1,000) and extended by
   beam search to depth 3 (`search/`).
4. **Explain** — templated reasons, a four-part confidence readout, "why over #2", equivalents and
   counterfactuals (`search/explain.py`). Optional LLM narration is behind `NARRATION_ENABLED` and may only
   reword facts the engine computed.
5. **Learn** — a LightGBM surrogate trained on simulated evaluations pre-ranks candidates so the simulator
   spends its budget well; SHAP drivers are shown for rank 1. It never decides (`packages/ml`).

All data is synthetic and seeded (`packages/datagen`): an IndiGo-like network of 12 airports, 40 tails,
~250 flights, crews and passenger itineraries, with disruption templates (fog/LVP, AOG, crew shortage,
capacity cut, ATC flow). No real IndiGo data is used.

## Status — Phases 0–7 complete (student track)

| Phase | Delivered |
|---|---|
| P0 Foundations | Domain model, YAML registries + `config_hash`, safe expression language, generator, API + UI shell, CI |
| P1 Simulator | Aircraft / crew / passenger propagation, ground-hold, standby, re-protection, next-wave metrics |
| P2 Constraints + candidates | H1–H10 plugins (static + simulated), user rules via expressions, cycle detection, swaps |
| P3 Score + search | NIS with `composite` / `priority` modes, beam search (K, D, M, N, S), scenario sampling, hysteresis, what-if |
| P4 API + UI | 30+ endpoints; Overview, Disruptions, Recommendations, Flights & resources, Parameters, Runs, Data pages |
| P5 ML + explanations | Surrogate pre-ranker (Spearman 0.56 held-out), SHAP drivers, confidence, narration adapter behind a flag |
| P6 Validation | 12 hand-crafted cases (all pass), benchmark ladder B0/B1/B2/B2s on a separate evaluation simulator, Cases & benchmarks page |
| P7 Demo | Render + Vercel + Supabase configs, Cloudflare Tunnel notes, `static-runs` offline fallback, technical brief |

Benchmark ladder, scored on a separate evaluation simulator (different seed, block-time noise the search
never sees, 40 futures per plan):

| Run | AeroNexus vs naive B0 | Win rate | Forced cancellations | Stranded pax |
|---|---|---|---|---|
| 30 scenarios (`data/benchmarks/latest.json`) | 44,537 vs 60,536 NIS (**−26 %**) | 83 % | 2.1 vs 5.6 | 550 vs 734 |
| 200 scenarios, 124 with at-risk flights (`ladder_200.json`) | 59,339 vs 70,903 NIS (**−16 %**) | 82 % | 4.1 vs 6.9 | 650 vs 780 |

Engine latency on the medium network: 1.7 s mean, 3.2 s p95 (5 s budget; degrades gracefully by reducing samples and depth).

## Quick start

```bash
# Python (3.11+)
python -m venv .venv && source .venv/Scripts/activate      # Windows Git Bash; use .venv/bin/activate elsewhere
pip install -r requirements-dev.txt lightgbm shap            # lightgbm/shap optional: enables the surrogate
python -m pytest -q                                          # 93 tests incl. the 12 cases
aeronexus-gen --size medium --seed 1 --disruption fog:DEL --validate --summary

# API
uvicorn aeronexus_api.main:app --reload --port 8000          # http://127.0.0.1:8000/docs

# Web (Node 22)
cd apps/web && npm install && npm run dev                    # http://localhost:5173 (proxies /api -> :8000)
```

## Reproduce the numbers

```bash
python -m aeronexus_core.cases [--surrogate]                            # 12-case pass/fail table
python -m aeronexus_core.benchmark --scenarios 30 --seed 2026 --s-eval 40   # ladder -> data/benchmarks/latest.json
python -m aeronexus_ml.surrogate build --scenarios 60 --seed 0          # retrain the pre-ranker -> packages/ml/models/
python -m aeronexus_ml.surrogate evaluate                               # held-out rank metrics
python scripts/precompute_demo.py                                       # offline demo bundle -> data/static-runs/
```

Same instance + same `config_hash` + same seed ⇒ identical output. Every run stored by the API carries the
hash, the engine version, the inputs and the controller's decision.

## Conventions

* **Time** is integer minutes from `Instance.day_start` (00:00 local); values > 1440 are the next day.
* **Nothing is rigid**: anything that can change a recommendation is in `configs/` and editable via the API/UI
  (add a column on the Flights page → use it in a score term or a rule on the Parameters page → re-run);
  every run records the effective `config_hash`.
* **Determinism**: seeds everywhere; the surrogate only orders candidates, the simulator decides.
* **Values marked VERIFY** (FDTL tables, DGCA compensation) are placeholders to be checked against the
  current CAR before the pitch.

## Repository layout

```
apps/api        FastAPI service            apps/web        React UI (Vite, Tailwind v4)
packages/core   engine                     packages/datagen synthetic generator
packages/ml     surrogate pre-ranker       configs/        YAML registries + presets
data/cases      12 hand-crafted cases      data/benchmarks ladder results
data/static-runs offline demo bundle       data/instances  generated days (git-ignored)
docs/           plan, brief, ADRs, deploy  scripts/        precompute_demo.py
tests/          pytest suite               render.yaml     Render blueprint (API)
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `AERONEXUS_DB_URL` | `sqlite:///<repo>/aeronexus.db` | Storage; set to the Supabase Postgres URL for the hosted demo |
| `AERONEXUS_CONFIG_DIR` | `<repo>/configs` | YAML registries seeded into the DB on first start |
| `AERONEXUS_CORS` | localhost dev origins | Allowed origins for the hosted UI |
| `AERONEXUS_SURROGATE_PATH` | `packages/ml/models/surrogate.joblib` | Pre-ranker model; absent ⇒ heuristic pre-rank |
| `NARRATION_ENABLED` | `false` | LLM narration feature flag (Plan §14.1) |
| `VITE_API_URL` (web) | unset → `/api` proxy | Production API origin |
