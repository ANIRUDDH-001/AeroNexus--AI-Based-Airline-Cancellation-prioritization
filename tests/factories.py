"""Test factories: the tiny hand-built network lives in aeronexus_datagen.presets so cases can use it too."""
from aeronexus_datagen.presets import A320, flight, tiny_instance  # noqa: F401

__all__ = ["A320", "flight", "tiny_instance"]
