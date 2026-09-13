"""LLM narration adapter (Plan §14.1). Feature-flagged; never part of the decision record.

Contract:
* input  = the structured explanation of the top plan only (actions, reasons, key metrics)
* output = at most two sentences; every number in the output must already appear in the input,
           otherwise the text is rejected and the deterministic template is used instead
* provider-agnostic: any OpenAI-compatible chat endpoint (most free tiers expose one) via
  NARRATION_BASE_URL / NARRATION_API_KEY / NARRATION_MODEL; 3 s timeout; failures fall back silently
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from aeronexus_core.model import Run

_NUM = re.compile(r"\d[\d,]*\.?\d*")


def template(run: Run) -> str:
    p = run.plans[0]
    acts = "; ".join(p.explanation.get("actions", [])) or "no action"
    reasons = p.explanation.get("reasons", [])
    lead = reasons[0] if reasons else ""
    return f"Recommended: {acts}. {lead}".strip()


def _numbers(text: str) -> set[str]:
    return {n.replace(",", "").rstrip(".") for n in _NUM.findall(text)}


def narrate(run: Run) -> str | None:
    if not run.plans:
        return None
    base = os.getenv("NARRATION_BASE_URL", "").rstrip("/")
    key = os.getenv("NARRATION_API_KEY", "")
    model = os.getenv("NARRATION_MODEL", "")
    fallback = template(run)
    if not (base and key and model):
        return fallback
    p = run.plans[0]
    facts = {
        "actions": p.explanation.get("actions", []),
        "reasons": p.explanation.get("reasons", []),
        "confidence": p.explanation.get("confidence", {}),
        "why_over_next": p.explanation.get("why_over_next", {}).get("differences", []),
    }
    prompt = (
        "You write one or two plain sentences for an airline operations controller. Use ONLY the facts below; "
        "do not add numbers, flights or claims that are not in the facts. No preamble.\n\nFACTS:\n"
        + json.dumps(facts, ensure_ascii=False)
    )
    body = json.dumps({"model": model, "messages": [{"role": "user", "content": prompt}], "temperature": 0.2,
                       "max_tokens": 120}).encode("utf-8")
    req = urllib.request.Request(f"{base}/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:  # noqa: S310 - fixed https endpoint from env
            data = json.loads(resp.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError, OSError):
        return fallback
    sentences = re.split(r"(?<=[.!?])\s+", text)
    text = " ".join(sentences[:2]).strip()
    allowed = _numbers(json.dumps(facts))
    if not text or not _numbers(text).issubset(allowed):
        return fallback
    return text
