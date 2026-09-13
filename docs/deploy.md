# Deploying the demo (Plan §20, P7)

Everything below is free tier. Three layers, each replaceable:

| Layer | Hosted demo | Pitch day | Fallback |
|---|---|---|---|
| Web UI | Vercel Hobby (`apps/web`) | same | `npm run preview` on the laptop |
| API | Render free web service (`render.yaml`) | Cloudflare Tunnel from the laptop | `uvicorn` on localhost |
| Storage | Supabase Postgres (project **Aeronexus**, ap-south-1) | same | SQLite (`aeronexus.db`) |
| If the API is unreachable | `static-runs/` bundle served by the UI (read-only demo of the precomputed day, cases and ladder) | | |

## 1. Supabase (already provisioned)

* Tables `instances`, `configs`, `runs` were created by migration `aeronexus_core_schema`; RLS is on with no
  policies, so only the database role the API uses can read or write.
* `configs.current` is seeded with hash `8ad297501ff2a755`. The API re-seeds from `configs/*.yaml` if the row is missing.
* Connection string (Project Settings → Database → *Session pooler*), with the SQLAlchemy driver prefix:
  `postgresql+psycopg://postgres.xewatixpposjmhqghmth:<PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
* Free projects **pause after ~7 days idle** — open the dashboard and un-pause the day before a demo.

## 2. API on Render

1. Push the repo to GitHub (branch `main`).
2. Render → *New* → *Blueprint* → select the repo. Render reads `render.yaml`.
3. In the service's *Environment* tab set `AERONEXUS_DB_URL` (the Supabase URL above) and `AERONEXUS_CORS`
   (your Vercel **origin**, comma-separated if several). Never put the password in the repo.

   > **CORS gotcha (this is what broke the first deployment).** Browsers send `Origin: https://aeronexus-app.vercel.app`
   > — scheme and host only — and the match is exact. A value such as `https://aeronexus-app.vercel.app/#` never
   > matches, every preflight (`OPTIONS …`) returns `400 Bad Request`, and the UI falls back to the precomputed
   > bundle. The API now normalises pasted values, but keep the variable clean. Verify with
   > `curl -sI -H "Origin: https://aeronexus-app.vercel.app" https://<service>.onrender.com/health | grep -i access-control`
   > — the `access-control-allow-origin` header must come back.

   Optional: `NARRATION_ENABLED=true` + `NARRATION_API_KEY` (Google AI Studio key; the base URL and model default
   to Gemini's OpenAI-compatible endpoint and `gemini-3.5-flash-lite`), and `AERONEXUS_WRITE_KEY` to lock the
   generate/edit/config routes (then set `VITE_API_KEY` on Vercel to the same value). `/health` reports the
   effective narration mode and whether a write key is required.

   **Secrets hygiene:** never screenshot the Environment page with values revealed; if a DB password or API key
   has been shown anywhere, rotate it (Supabase → Settings → Database → *Reset database password*; Google AI
   Studio → delete and re-create the key) and update the variable.
4. Deploy. Health check: `https://<service>.onrender.com/health` → `{"status":"ok", ...}`.
5. The surrogate model (`packages/ml/models/surrogate.joblib`, 1.2 MB) ships with the repo and is loaded at
   startup; if LightGBM is missing the API silently falls back to heuristic pre-rank.

Limits to remember: 750 instance-hours/month, **15-min idle spin-down, ~60 s cold start**, 512 MB RAM
(one worker) and roughly **4× slower CPU than a laptop**: a medium-day recommendation takes 6–10 s there and the
engine reduces sampled futures and depth to stay inside the latency budget (every run says so in its notes and
`effective` block; the UI shows "uncertainty not evaluated" when fewer than three futures fitted). For a live
pitch, prefer the laptop + Cloudflare Tunnel (section 4) or raise `latency_budget_ms` in Search settings.
Hit `/health` a few minutes before presenting.

Local Docker equivalent (same image Render would build): `docker build -f apps/api/Dockerfile -t aeronexus-api . && docker run -p 8000:8000 aeronexus-api`.

## 3. Web on Vercel

1. Vercel → *Add New Project* → import the repo, set **Root Directory** to `apps/web` (framework: Vite).
2. Environment variable `VITE_API_URL=https://<service>.onrender.com` (no trailing slash).
3. Deploy. `apps/web/vercel.json` rewrites every route to `index.html` except `/static-runs/*`.
4. Before each deploy that should carry a fresh fallback bundle, run `python scripts/precompute_demo.py`
   and commit `data/static-runs/` — `vite build` copies it into `dist/static-runs/`.

## 4. Pitch day: Cloudflare Tunnel (no cold start, full laptop CPU)

```bash
uvicorn aeronexus_api.main:app --port 8000            # engine on the laptop (SQLite or Supabase, your choice)
cloudflared tunnel --url http://127.0.0.1:8000        # prints https://<random>.trycloudflare.com
```

Set `AERONEXUS_CORS` to include the Vercel origin before starting uvicorn, then either redeploy the web app
with `VITE_API_URL=https://<random>.trycloudflare.com` or run the UI locally (`npm run dev`, which proxies
`/api` → `:8000` and needs no CORS at all). Quick tunnels need no account; a named tunnel gives a stable URL.

## 5. Static fallback (what happens if everything is down)

`scripts/precompute_demo.py` writes `data/static-runs/`: the demo day (`instance.json`, entity tables), the
baseline timeline and a full recommendation at 05:00, 06:00, 07:00, 08:00, 09:00 and 10:00, the case-suite
result, the benchmark ladder and the configuration snapshot. The web client (`apps/web/src/lib/api.ts`)
switches to this bundle automatically when the API returns a network error or a 502/503/504, shows
**"Precomputed demo (engine not reachable)"** in the sidebar, and serves the nearest precomputed decision time.
Edits, what-if and re-runs need the live engine and fail with a clear 503 message.

## 6. Pre-demo checklist

- [ ] Supabase project un-paused; `GET /health` on Render returns 200 (warm) **and** the CORS check above passes.
- [ ] A demo day exists on the hosted DB (Data page → medium, seed 1, `fog:DEL:300:240:0.5, aog:VT-IAD:520`) — the DB starts empty.
- [ ] `python -m pytest -q` green; `data/benchmarks/latest.json` and `data/static-runs/` regenerated on the current `config_hash`.
- [ ] Laptop fallback rehearsed: `uvicorn` + `npm run dev`, and the static bundle with the API stopped.
- [ ] Values marked VERIFY in `configs/parameters.yaml` (FDTL table, DGCA compensation) checked against the current CAR.
