# AeroNexus — 10-minute pitch script

Two presenters. Live demo on the laptop (uvicorn + `npm run dev`); hosted URL as backup; static bundle as
last resort. Rehearse the fallback switch once — it is silent apart from the sidebar label.

| Min | Beat | On screen | Say |
|---|---|---|---|
| 0–1 | The problem | Slide: fog at DEL, one cancelled flight, three forced cancellations two hours later | "The expensive decision is never the flight you cancel — it's the ones that cancel themselves because the aircraft or crew never arrived. OCC has minutes." |
| 1–2 | What we built | Overview page, demo day loaded, decision time 05:00 | "A synthetic IndiGo-like day: ~250 flights, 40 aircraft, fog at Delhi plus an aircraft technical. If nobody acts: 11 flights cancel themselves during the day and ~700 passengers are stranded." (read the live numbers off the Overview KPIs) |
| 2–4 | The recommendation | Recommendations → *Recommend* | "Under five seconds. Three plans, each simulated through the whole day and on ten sampled futures. Plan 1 cancels the doomed cycles early instead of letting them fail one by one: forced cancellations drop from 11 to 6 and fewer passengers are stranded. Every bullet is computed, not generated." Open *why over #2* and the confidence readout. |
| 4–5 | Hard constraints | Expand *Excluded by hard constraints* | "These options were not scored low — they were removed, with the rule that removed them: crew duty limit, curfew, CAT-III. The score never trades against safety." |
| 5–6 | Nothing is rigid | Flights page → add column `vip_count`; Parameters → new term `sum_affected('vip_count') * 300`; re-run | "Airlines change their minds about what matters. Add a column, use it in the score or in a rule, re-run. The config hash on every run means any answer can be reproduced later." |
| 6–7 | What-if | Recommendations → what-if: cancel the flight a naive rule would pick | "The controller's own idea is evaluated on the same engine: it would rank #9 and cost ₹1.4 crore more." |
| 7–8 | Proof | Cases & benchmarks page | "Twelve hand-written situations with a known right answer — all pass. And a ladder: doing nothing, a naive rule, a weighted heuristic, AeroNexus — scored on futures the search never saw. On 200 generated days: 14 % lower network impact than doing nothing, 17 % lower than the naive rule, forced cancellations cut from 5.2 to 2.9." |
| 8–9 | Where the AI is | Slide: simulator → constraints → search → surrogate → explanations | "Search over a simulator decides; a LightGBM surrogate trained on 4,000 simulated evaluations makes the search fast; SHAP shows the drivers. No black box decides, and no real IndiGo data was needed to build it." |
| 9–10 | Ask + roadmap | Slide: limitations, faculty track | "Placeholder FDTL and compensation values to verify; calibration on real schedules; CP-SAT optimality gap next. We'd like a duty manager's afternoon to run the case suite against their judgement." |

**Questions we expect**
* *Why not an LLM?* — It cannot simulate a day or guarantee a duty limit; we use it (optionally) only to reword computed facts.
* *How do you know the score weights are right?* — They are explicit, editable, versioned; the ladder and the case suite are re-run on every change; priority mode exists for airlines that refuse to trade levels.
* *Latency at IndiGo scale (2,000 flights)?* — Honest answer: not yet. A hub fog puts ~40 % of a 2,000-flight network at risk; the engine limits candidates to an 8-hour decision horizon and degrades gracefully (fewer samples, shallower depth, and the run says so), but incremental simulation and parallel evaluation are the next engineering step.
* *What if the data is stale?* — Data age is part of the confidence readout; hysteresis avoids flip-flopping; every run is stored with its inputs.

**Demo safety**
* Warm the Render service and un-pause Supabase the evening before; open `/health` (the sidebar shows a green dot when the engine is awake, and a *Wake engine* button when it is not; the keep-alive workflow pings it every 10 min).
* Keep `python scripts/precompute_demo.py` output committed — the UI serves it automatically if the API dies.
* Decision times with precomputed runs: 05:00, 06:00, 07:00, 08:00, 09:00, 10:00.
