# AeroNexus

**AI-Based Cancellation Prioritization for Flight Disruptions** — advisory decision support for an airline
Operations Control Centre. IndiGo × UPES AI Challenge, Problem Statement 01.

When a disruption puts many flights at risk, AeroNexus shows the controller the three best plans
(cancel / delay / bounded swap), what each does to the rest of the day across aircraft, crew and
passengers, and why — in seconds, with every recommendation reproducible from its `config_hash`.

The single source of truth for design and roadmap is
[docs/AeroNexus_Implementation_Plan.md](docs/AeroNexus_Implementation_Plan.md).

## Status — Phase 0 complete

| Capability | Where |
|---|---|
| Domain model (airports, fleet, flights, crew, itineraries, disruptions, actions, plans, runs) | `packages/core/aeronexus_core/model.py` |
| Configuration registries + versioned `config_hash` (parameters, objective terms, constraints, search) | `packages/core/aeronexus_core/config/`, `configs/*.yaml` |
| Safe expression language for score terms and user rules | `packages/core/aeronexus_core/expressions.py` |
| Hard-constraint catalogue H1–H10 as plugins (static rules live; simulated rules land in Phase 2) | `packages/core/aeronexus_core/constraints/` |
| Network Impact Score with `composite` and `priority` ranking | `packages/core/aeronexus_core/scoring/` |
| Seeded IndiGo-like generator (`small` / `medium` / `large`) + disruption templates | `packages/datagen/` |
| Structural instance validator | `packages/core/aeronexus_core/validate.py` |
| FastAPI service with SQLite (local) / Postgres (Supabase) storage | `apps/api/` |
| React UI shell with the Notion-style design system (Data, Parameters pages) | `apps/web/` |
| 47 tests, ruff, CI | `tests/`, `.github/workflows/ci.yml` |

Phases 1–7 (simulator, constraints, search, UI, ML, validation, demo) are laid out in the plan §22.

## Quick start

```bash
# Python (3.11+)
python -m venv .venv && source .venv/Scripts/activate      # Windows Git Bash; use .venv/bin/activate elsewhere
pip install -r requirements-dev.txt
python -m pytest -q                                          # 47 tests
aeronexus-gen --size medium --seed 1 --disruption fog:DEL --validate --summary

# API
uvicorn aeronexus_api.main:app --reload --port 8000          # http://127.0.0.1:8000/docs

# Web (Node 22)
cd apps/web && npm install && npm run dev                    # http://localhost:5173 (proxies /api -> :8000)
```

## Conventions

* **Time** is integer minutes from `Instance.day_start` (00:00 local); values > 1440 are the next day.
* **Nothing is rigid**: anything that can change a recommendation is in `configs/` and editable via the API/UI;
  every run records the effective `config_hash`.
* **Determinism**: same instance + same config hash → same output. Seeds everywhere.
* **Values marked VERIFY** (FDTL tables, DGCA compensation) are placeholders to be checked against the
  current CAR before the pitch.

## Repository layout

```
apps/api        FastAPI service            apps/web        React UI (Vite, Tailwind v4)
packages/core   engine                     packages/datagen synthetic generator
packages/ml     surrogate models (P5)      configs/        YAML registries + presets
data/cases      hand-crafted cases         data/instances  generated days (git-ignored)
docs/           plan + ADRs                tests/          pytest suite
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `AERONEXUS_DB_URL` | `sqlite:///<repo>/aeronexus.db` | Storage; set to the Supabase Postgres URL for the hosted demo |
| `AERONEXUS_CONFIG_DIR` | `<repo>/configs` | YAML registries seeded into the DB on first start |
| `AERONEXUS_CORS` | localhost dev origins | Allowed origins for the hosted UI |
| `NARRATION_ENABLED` | `false` | LLM narration feature flag (Plan §14.1) |
| `VITE_API_URL` (web) | unset → `/api` proxy | Production API origin |
