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
   (your Vercel URL, comma-separated if several). Never put the password in the repo.
4. Deploy. Health check: `https://<service>.onrender.com/health` → `{"status":"ok", ...}`.
5. The surrogate model (`packages/ml/models/surrogate.joblib`, 1.2 MB) ships with the repo and is loaded at
   startup; if LightGBM is missing the API silently falls back to heuristic pre-rank.

Limits to remember: 750 instance-hours/month, **15-min idle spin-down, ~60 s cold start**, 512 MB RAM
(one worker). Hit `/health` a few minutes before presenting.

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
**"Static demo mode (API unreachable)"** in the sidebar, and serves the nearest precomputed decision time.
Edits, what-if and re-runs need the live engine and fail with a clear 503 message.

## 6. Pre-demo checklist

- [ ] Supabase project un-paused; `GET /health` on Render returns 200 (warm).
- [ ] `python -m pytest -q` green; `data/benchmarks/latest.json` and `data/static-runs/` regenerated on the current `config_hash`.
- [ ] The demo day exists in the hosted DB (Data page → generate `medium`, seed 1, `fog:DEL` + `aog:<tail>`).
- [ ] Laptop fallback rehearsed: `uvicorn` + `npm run dev`, and the static bundle with the API stopped.
- [ ] Values marked VERIFY in `configs/parameters.yaml` (FDTL table, DGCA compensation) checked against the current CAR.
