"""Digital-twin simulator (Plan §7). Implemented in Phase 1.

Contract (fixed now so Phase 2/3 can code against it):

    apply(state: State, action: Action, config: EngineConfig) -> tuple[State, Metrics]

* re-propagates only the tails, crews and itineraries touched by the action (§7.6)
* never mutates its input (State is a snapshot)
* returns the Metrics namespace consumed by aeronexus_core.scoring
"""
