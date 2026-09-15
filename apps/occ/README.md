# AeroNexus console (`apps/occ`)

The operations console: one screen that says what is at risk today, what the engine proposes, why, and what it
costs — then the pages behind it (Flights & resources, Runs, Parameters, Cases & benchmarks, Data, How it works).
Next.js 16 (App Router), React 19, Tailwind v4, Radix primitives, d3-geo. Design notes in `DESIGN.md`; the spec in
`docs/superpowers/specs/2026-09-13-occ-console-design.md`.

## Run it

```bash
# engine (from the repo root)
.venv/Scripts/python -m uvicorn aeronexus_api.main:app --port 8000

# console
cd apps/occ
npm install
npm run dev          # http://localhost:3000, /api proxied to the engine on :8000
```

With no `NEXT_PUBLIC_API_URL`, `next.config.ts` rewrites `/api/*` to `API_PROXY_TARGET` (default
`http://127.0.0.1:8000`). With it set, the browser calls the engine directly (production).

When the engine is unreachable the console answers read-only calls from `public/static-runs` (copied from
`data/static-runs` before `dev` and `build` by `scripts/sync-static.mjs`) and says so everywhere: a persistent
demo pill, a banner, and a "Demo result" tag on every result. `python scripts/precompute_demo.py` regenerates the
bundle in deterministic mode; `python scripts/check_static_parity.py` proves it matches the engine.

## Environment

| variable | where | meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Vercel | the engine's base URL, no trailing slash |
| `NEXT_PUBLIC_API_KEY` | Vercel, optional | sent as `X-AeroNexus-Key` when the API has `AERONEXUS_WRITE_KEY` |
| `API_PROXY_TARGET` | local, optional | where `/api` proxies in development |

## Checks

```bash
npm run verify       # typecheck, lint, unit tests (vitest)
npm run test:e2e     # playwright, desktop and phone projects (see e2e/console.spec.ts for the two modes)
npm run shots        # screenshots at 1440 / 1024 / 768 / 390 into .shots/
node scripts/pages.mjs http://localhost:3000 1440   # every page at one width
npm run api:types    # regenerate src/lib/api.types.ts from openapi.json (after python scripts/export_openapi.py)
```

The e2e static suite expects a console whose engine is unreachable, so it is deterministic:

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:9 npx next build && npx next start --port 3100
BASE_URL=http://localhost:3100 npx playwright test
```

Set `ENGINE_URL` to run the engine suite against a console proxying to a live engine instead.

## Layout of the code

```
src/app/(console)/           routes: /, /flights, /runs, /parameters, /cases, /data, /how-it-works
src/components/shell/        top bar, day switcher, clock control, engine status, phone tab bar
src/components/ops/          the operations screen: headline, KPIs, at-risk list, decisions trail
src/components/board/        the rotations board
src/components/map/          the night map
src/components/plans/        baseline card, plan cards, chain, expanded details, what changed
src/components/disruptions/  chips, the add-disruption sheet
src/components/ui/           the kit: button, panel, pill, overlays, controls, table
src/lib/                     api.ts (typed by api.types.ts), query keys, glossary, diff, format, url state
src/hooks/                   useDay (URL-synced day and decision time), useEngine, useTimeline, useIsPhone
```
