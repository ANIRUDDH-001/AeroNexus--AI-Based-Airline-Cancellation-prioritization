"""Flight Duty Period limits (DGCA CAR Section 7 Series J Part III).

One implementation shared by the generator (to build legal pairings) and the crew_fdtl constraint (to
reject illegal ones). The default table below is a PLACEHOLDER transcribed for development; the
editable copy lives in configs/constraints.yaml (H3a) and overrides this when the engine runs.
VERIFY against the current CAR revision before the pitch.
"""
from __future__ import annotations

from typing import Any

DEFAULT_FDP_TABLE: list[dict[str, Any]] = [
    {"band": [360, 779], "by_sectors": {1: 780, 2: 780, 3: 750, 4: 720, 5: 690, 6: 660}},
    {"band": [780, 1079], "by_sectors": {1: 750, 2: 750, 3: 720, 4: 690, 5: 660, 6: 630}},
    {"band": [1080, 1439], "by_sectors": {1: 660, 2: 660, 3: 630, 4: 600, 5: 570, 6: 540}},
    {"band": [0, 359], "by_sectors": {1: 600, 2: 600, 3: 570, 4: 540, 5: 510, 6: 480}},
]
DEFAULT_MAX_SECTORS = 6
DEFAULT_REPORT_BEFORE_STD_MIN = 60


def fdp_limit(report_min: int, sectors: int, table: list[dict[str, Any]] | None = None) -> int:
    """Max FDP in minutes for a duty reporting at ``report_min`` (minutes from day start) flying ``sectors`` legs."""
    table = table or DEFAULT_FDP_TABLE
    rep = report_min % 1440
    sectors = max(1, sectors)
    for row in table:
        lo, hi = row["band"]
        if lo <= rep <= hi:
            by = {int(k): int(v) for k, v in row["by_sectors"].items()}
            if sectors in by:
                return by[sectors]
            return by[max(by)]  # beyond the table: use the most restrictive listed value
    raise ValueError(f"no FDP band covers report time {report_min}")
