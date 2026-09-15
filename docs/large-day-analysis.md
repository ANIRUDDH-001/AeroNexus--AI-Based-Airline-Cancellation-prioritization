# The large day: what went wrong at 07:00 and what to do about it

Instance `synthetic-large-seed2` (1,909 flights, 300 aircraft, 875 crews, 50 airports, 289,493 booked passengers,
5 disruptions). Run `8d5accea1c7a` at 07:00, 2026-09-15. Measured on the laptop with `configs/` defaults
(K=5, D=3, M=12, N=8, S=10, latency budget 5,000 ms).

## What the run said

- 891 flights at risk (164 would cancel themselves, 727 delayed beyond 45 min); 19,409 stranded overnight;
  1,923 missed connections; 1,867 h of delay; ₹22 crore compensation.
- `plans_evaluated: 1`, `depth_reached: 0`, `effective.budget_cuts: ["candidates depth 1", "S 1"]`, latency 32 s.
- The only plan scored was "do nothing", which the console then labelled *Recommended: wait*.

The engine did **not** decide that waiting is best. It ran out of budget before simulating a single action and
said so in `run.notes`; the console's labelling was the misleading part (fixed: the console now shows
"No action could be evaluated in the search budget" with the notes, *Run again* and *Raise the search budget*).

## Where the time went (profiled in-process, `scripts` in the session scratchpad)

| stage | time | note |
|---|---|---|
| baseline simulation | 161 ms | the simulator is not the problem |
| at-risk detection | 5 ms | 891 at risk, 385 beyond the 8 h horizon |
| candidate generation | 678 ms | **12,426 candidates**: 10,787 swaps, 628 delays, 506 cancel-leg, 505 cancel-cycle |
| static hard-rule checks | 177 ms | all 12,426 pass the static phase |
| **surrogate pre-rank** | **6.4 s** (15.7 s under the profiler) | `aeronexus_ml/features.py: spare_tails → tail_location` called **3.7 million times** (candidates × 300 aircraft), nothing cached |
| one candidate simulation | 78 ms | a full depth-1 pass of 12 candidates would take ~1 s |

The budget check fires at 0.8 × 5 s = 4 s, but 7.4 s of fixed overhead comes first, so the search loop exits
before its first simulation. The remaining seconds in the 32 s API latency are explanation, narration and storage.

Same run without the surrogate: **4.9 s**, depth 1, 2 plans, top plan swap 6E3888 (impact −2.2 %). With a 60 s
budget and the heuristic pre-rank: 30.6 s, 36 plans to depth 3, S=5, top plan two swaps → 157 cancellations
instead of 164, 18,666 stranded instead of 19,409. With a 60 s budget **and** the surrogate: 58 s, only 14 plans
to depth 2, S=1 — the model re-scores every expansion and eats the budget again.

## Why the day is so bad in the first place

Of the 164 forced cancellations: 100 are downstream (aircraft out of position after an upstream cancellation),
51 are **crew FDP time-outs "by 5–80 min" at outstations with no standby**, 10 are crews out of position, 2 crews
unavailable (the DEL disruption), 1 AOG. The generator gives a large day 17 standby crews for 875 (2 %, hubs only;
`generator.py: standby_per_hub = (2, 4)`), versus 13 for 129 (10 %) on the medium day. The fog at DEL (50 %
capacity for four hours) pushes crews over FDP at outstations, nothing can rescue them, and each cancellation
strands the aircraft for the rest of its rotation. The engine's action vocabulary (cancel leg/cycle, hold, re-fleet)
cannot touch the crew problem, so even a complete search only trims the edges (−4 % cancellations at 60 s).

## Action plan (in order; each item is independently verifiable)

1. **Cache the surrogate's features** (`packages/ml/aeronexus_ml/features.py`). Compute tail locations and spare
   tails once per state (a dict keyed by tail and station), not once per candidate. Target: pre-rank under 300 ms
   for 12k candidates. Test: profile `score_actions` on the large day; `tests/test_surrogate*.py` unchanged.
2. **Cap the surrogate's input** (`search/candidates.py: prerank`). Order by the heuristic first, keep the top
   10 × M (120), then let the model reorder those. Bounded cost whatever the day size; ranking quality on the medium
   day unchanged (benchmark ladder as the check).
3. **Generate swaps sensibly** (`search/candidates.py: generate_candidates`). Index aircraft by station and time
   once per state instead of testing all 300 per at-risk flight (127k `_tail_position_at` calls); keep at most the
   three best spare tails per flight (same type first, longest idle slack). Expect ~10× fewer candidates.
4. **Guarantee minimum useful work** (`search/recommend.py`). Always simulate at least the M depth-1 candidates
   before the budget can stop the loop; the budget then governs deepening and sampling. A run that evaluated nothing
   is worth less than a run that is two seconds late.
5. **Size the budget to the day** (`configs/search.yaml` or per-run). 5 s is right for a 250-flight day; a 1,900-
   flight day needs 30–60 s. Either scale `latency_budget_ms` with flight count in the API, or add an optional
   `budget_ms` to `RecommendRequest` so the console's *Run again* can pass 30 s on large days.
6. **Calibrate the generator for large days** (`packages/datagen`). Standby crews proportional to crews per base
   (5–10 %), standby at the larger outstations, and FDP margins that leave the usual buffer; regenerate the large
   day and re-read the forced-cancellation causes.
7. **Add crew actions** (engine, larger). "Call standby at station", "reposition crew", and FDP extension by
   commander's discretion as a soft-cost action, bounded and reported. This is the only way the engine can address
   the dominant failure mode on a large day. Verify the discretion limits against the current DGCA CAR before
   encoding them.
8. **Re-run the benchmark ladder** after 1–5 on a large-day set, so the "AeroNexus with the ML pre-ranker" row is
   measured where it currently loses, not only on medium days.

Console-side changes already made in this pass: honest exhausted-search panel, `?tab=search` deep link, map
readability at 50 airports, and the score definition on every plan card.
