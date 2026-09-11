"""Scenario sampling (Plan §12, student-track 'light' version).

Each sample draws the end time of every uncertain disruption from its ``end_distribution`` (lognormal on
duration, anchored at the disruption start) and, optionally, multiplicative block-time noise. Samples are
seeded so a run is reproducible from its seed.
"""
from __future__ import annotations

import numpy as np

from ..model import Instance
from .engine import ScenarioSample


def sample_scenarios(instance: Instance, n: int, seed: int = 0, block_sigma: float = 0.0) -> list[ScenarioSample]:
    rng = np.random.default_rng(seed)
    out: list[ScenarioSample] = []
    for k in range(n):
        ends: dict[str, int] = {}
        for d in instance.disruptions:
            dist = d.end_distribution
            if not dist:
                continue
            if dist.get("dist") == "lognormal":
                mean = float(dist.get("mean_min", 120))
                sigma = float(dist.get("sigma", 0.4))
                mu = np.log(max(mean, 1.0)) - sigma**2 / 2  # so that E[duration] = mean
                dur = float(rng.lognormal(mu, sigma))
                ends[d.id] = int(dist.get("anchor", d.start) + max(5.0, dur))
        block: dict[str, float] = {}
        if block_sigma > 0:
            for f in instance.flights:
                block[f.id] = float(np.clip(rng.normal(1.0, block_sigma), 0.85, 1.5))
        out.append(ScenarioSample(disruption_end=ends, block_factor=block, label=f"s{k}"))
    return out
