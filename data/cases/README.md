# Hand-crafted validation cases (Plan §17.1)

Each case is one YAML file describing a small, fully specified situation, the disruption, and what a
competent duty manager would do. The case suite runs in pytest (Phase 3) and on the Cases page (Phase 4).

## File layout

```yaml
id: case_01_heavy_vs_light
title: Heavy vs light flight on one rotation
rationale: >
  Cancelling the light feeder keeps the aircraft available for the 200-seat trunk sector; cancelling
  the trunk flight would strand far more passengers even though the feeder has fewer legs downstream.
instance:
  base: small            # generator size, or "inline" with a full instance below
  seed: 1
  overrides: {}          # GeneratorParams overrides
  patches:               # targeted edits applied after generation (by id)
    flights:
      6E2001: {booked_pax: 30}
disruptions:             # CLI-style specs or full Disruption objects
  - delay:6E2001:120
decision_time: 420       # minutes from day start
expected:
  top1:                  # exact action expected at rank 1
    type: CANCEL_CYCLE
    target_flights: [6E2001, 6E2002]
  acceptable:            # any of these at rank 1 also passes
    - {type: CANCEL_LEG, target_flights: [6E2001]}
  must_exclude:          # candidates that must be reported infeasible, with the constraint id
    - {type: DELAY, target_flights: [6E2005], params: {delay_min: 180}, constraint: H4a}
tolerances:
  max_latency_ms: 5000
```

## The twelve cases

| # | File | Tests |
|---|---|---|
| 1 | case_01_heavy_vs_light | Cancel the light feeder to save the rotation |
| 2 | case_02_connector_vs_local | Protect connections over raw passenger count |
| 3 | case_03_fdp_breach_with_standby | Use standby crew instead of cancelling |
| 4 | case_04_fdp_breach_no_standby | Cancel the leg that causes the breach |
| 5 | case_05_curfew_no_recovery | Delay cannot recover; cancel the curfew-bound leg |
| 6 | case_06_capacity_cut | Remove N movements from a window with least impact |
| 7 | case_07_aog_outstation_spare_at_hub | Swap beats cancel |
| 8 | case_08_cancel_cycle_vs_leg | Aircraft position matters |
| 9 | case_09_cross_midnight | Tonight's choice vs tomorrow's first wave |
| 10 | case_10_thin_vs_trunk_route | Re-accommodation capacity decides |
| 11 | case_11_cat3_in_fog | Qualification is the binding constraint |
| 12 | case_12_crew_shortage_day | Many crews timing out at once |

Cases are authored in Phase 1–3 as the corresponding engine capability lands (Plan §22).
