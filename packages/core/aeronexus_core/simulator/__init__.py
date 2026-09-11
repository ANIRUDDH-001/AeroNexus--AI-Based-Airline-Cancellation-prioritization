"""Digital-twin simulator (Plan §7).

    sim = Simulator(instance, config)
    result = sim.run(decisions, clock=t, sample=None)   # -> SimResult with per-leg outcomes + Metrics

Re-propagates the whole day (fast enough: ~ms for a medium network); never mutates its inputs.
"""
from .engine import ItineraryOutcome, LegOutcome, ScenarioSample, SimResult, Simulator
from .scenarios import sample_scenarios

__all__ = ["ItineraryOutcome", "LegOutcome", "ScenarioSample", "SimResult", "Simulator", "sample_scenarios"]
