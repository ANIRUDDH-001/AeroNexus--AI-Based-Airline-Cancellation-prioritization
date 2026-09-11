"""AeroNexus core engine.

Time convention used everywhere in the engine: integer minutes from ``Instance.day_start`` (00:00 local).
Values above 1440 are the following day (cross-midnight). This keeps the simulator fast and makes
cross-midnight cases first-class. Convert to clock time only at the UI/API boundary.
"""

ENGINE_VERSION = "0.1.0"
