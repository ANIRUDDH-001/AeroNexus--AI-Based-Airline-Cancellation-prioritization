"""Write the API's OpenAPI document to apps/occ/openapi.json (spec §10.3).

The console generates its TypeScript types from that file (``npm run api:types`` in apps/occ), so a change to
any response model shows up as a compile error in the UI instead of a runtime surprise.

    python scripts/export_openapi.py          # write the file
    python scripts/export_openapi.py --check  # exit 1 if the committed file is stale (used by the tests)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for p in ("packages/core", "packages/datagen", "packages/ml", "apps/api"):
    sys.path.insert(0, str(REPO / p))

OUT = REPO / "apps" / "occ" / "openapi.json"


def document() -> str:
    from aeronexus_api.main import app

    return json.dumps(app.openapi(), indent=1, sort_keys=True) + "\n"


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    text = document()
    if "--check" in argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is stale: run python scripts/export_openapi.py and npm run api:types in apps/occ")
            return 1
        print("openapi.json is current")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({len(json.loads(text)['paths'])} paths)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
