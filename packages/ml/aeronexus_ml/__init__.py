"""ML surrogate for candidate pre-ranking and score-driver explanations (Plan §13).

The surrogate orders candidates before the simulator judges them; it never decides."""
from .features import FEATURE_NAMES, build_context, features_for
from .surrogate import Surrogate, build_dataset, evaluate, load_default, train

__all__ = ["FEATURE_NAMES", "Surrogate", "build_context", "build_dataset", "evaluate", "features_for", "load_default", "train"]
