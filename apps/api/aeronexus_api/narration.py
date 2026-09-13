"""LLM narration adapter (Plan §14.1). Feature-flagged; never part of the decision record.

Contract:
* input  = the structured explanation of the top plan only (actions, reasons, key metrics)
* output = at most two sentences; every number and every flight/aircraft identifier in the output must
           already appear in the input, and the reply must be complete (finish_reason == "stop"); otherwise
           the text is rejected and the deterministic template is used instead
* provider-agnostic: any OpenAI-compatible chat endpoint via NARRATION_BASE_URL / NARRATION_API_KEY /
  NARRATION_MODEL. Only the key is mandatory: base URL and model default to Gemini's OpenAI-compatible
  endpoint and a non-reasoning model (reasoning models spend the token budget on hidden thinking and return
  a truncated sentence). 6 s timeout; failures fall back silently and are counted in narration_status().
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

from aeronexus_core.model import Run

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
DEFAULT_MODEL = "gemini-3.5-flash-lite"
TIMEOUT_S = 6.0
MAX_TOKENS = 400

_NUM = re.compile(r"\d[\d,]*\.?\d*")
_IDENT = re.compile(r"\b(?:[0-9][A-Z][0-9]{3,4}|VT-[A-Z]{3}|[A-Z]{3}(?:→|->)[A-Z]{3})\b")

_stats = {"calls": 0, "accepted": 0, "rejected": 0, "failed": 0, "last_error": None}


def config() -> dict[str, str | None]:
    return {
        "base_url": (os.getenv("NARRATION_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        "api_key": os.getenv("NARRATION_API_KEY") or None,
        "model": os.getenv("NARRATION_MODEL") or DEFAULT_MODEL,
    }


def narration_status() -> dict:
    """Shown on /health so a missing key or a failing provider is visible instead of silently templated."""
    c = config()
    enabled = os.getenv("NARRATION_ENABLED", "false").lower() in {"1", "true", "yes"}
    mode = "off" if not enabled else "template-only (no NARRATION_API_KEY)" if not c["api_key"] else "llm"
    return {"mode": mode, "model": c["model"] if mode == "llm" else None, **_stats}


def template(run: Run) -> str:
    p = run.plans[0]
    acts = "; ".join(p.explanation.get("actions", [])) or "no action"
    reasons = p.explanation.get("reasons", [])
    lead = reasons[0] if reasons else ""
    return f"Recommended: {acts}. {lead}".strip()


def _numbers(text: str) -> set[str]:
    # whole numbers with two or more digits (single digits like "3 legs" are too weak to prove anything)
    return {n.replace(",", "").rstrip(".") for n in _NUM.findall(text) if len(n.replace(",", "").rstrip(".")) >= 2}


def _idents(text: str) -> set[str]:
    return {m.replace("->", "→") for m in _IDENT.findall(text)}


def validate(text: str, facts: dict, finish_reason: str | None) -> str | None:
    """Return the accepted narration, or None with the reason recorded in _stats."""
    if finish_reason not in (None, "stop"):
        _stats["last_error"] = f"rejected: finish_reason={finish_reason}"
        return None
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    text = " ".join(sentences[:2]).strip()
    if len(text) < 25 or text[-1:] not in ".!?":
        _stats["last_error"] = "rejected: too short or unterminated"
        return None
    facts_json = json.dumps(facts, ensure_ascii=False)
    bad_nums = _numbers(text) - _numbers(facts_json)
    bad_ids = _idents(text) - _idents(facts_json)
    if bad_nums or bad_ids:
        _stats["last_error"] = f"rejected: unknown numbers {sorted(bad_nums)} identifiers {sorted(bad_ids)}"
        return None
    return text


def narrate(run: Run) -> str | None:
    if not run.plans:
        return None
    c = config()
    fallback = template(run)
    if not c["api_key"]:
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
        "do not add numbers, flights or claims that are not in the facts. No preamble, no markdown.\n\nFACTS:\n"
        + json.dumps(facts, ensure_ascii=False)
    )
    body = json.dumps({"model": c["model"], "messages": [{"role": "user", "content": prompt}], "temperature": 0.2,
                       "max_tokens": MAX_TOKENS}).encode("utf-8")
    req = urllib.request.Request(f"{c['base_url']}/chat/completions", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {c['api_key']}"})
    _stats["calls"] += 1
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310 - https endpoint from env
            data = json.loads(resp.read().decode("utf-8"))
        choice = data["choices"][0]
        text = choice["message"]["content"].strip()
        finish = choice.get("finish_reason")
    except urllib.error.HTTPError as e:
        _stats["failed"] += 1
        _stats["last_error"] = f"http {e.code}"
        return fallback
    except (urllib.error.URLError, KeyError, ValueError, TimeoutError, OSError) as e:
        _stats["failed"] += 1
        _stats["last_error"] = f"{type(e).__name__}"
        return fallback
    accepted = validate(text, facts, finish)
    if accepted is None:
        _stats["rejected"] += 1
        return fallback
    _stats["accepted"] += 1
    return accepted
