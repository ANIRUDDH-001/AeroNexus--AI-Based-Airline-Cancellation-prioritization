"""Plan search (Plan §11): recommend(instance, config, clock) -> Run."""
from .candidates import AtRisk, detect_at_risk, generate_candidates
from .recommend import recommend

__all__ = ["AtRisk", "detect_at_risk", "generate_candidates", "recommend"]
