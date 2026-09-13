"""Optional write protection for the hosted demo. When AERONEXUS_WRITE_KEY is set, routes that change data
or configuration require the header ``X-AeroNexus-Key``; recommendations, what-ifs and decisions stay open
so the demo works read/advise-only for anyone with the link. Unset (local development) = no checks."""
from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from . import settings


def require_write_key(x_aeronexus_key: str | None = Header(default=None)) -> None:
    key = settings.WRITE_KEY
    if key is None:
        return
    if not x_aeronexus_key or not hmac.compare_digest(x_aeronexus_key, key):
        raise HTTPException(status_code=401, detail="write key required (X-AeroNexus-Key)")
