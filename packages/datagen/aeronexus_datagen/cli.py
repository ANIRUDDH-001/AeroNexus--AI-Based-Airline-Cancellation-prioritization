"""Command line: generate a synthetic day and write it to data/instances.

    aeronexus-gen --size small --seed 1
    aeronexus-gen --size medium --seed 7 --disruption fog:DEL --disruption aog:VT-IAB:600 --out data/instances/x.json
    python -m aeronexus_datagen.cli --size small --validate
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from aeronexus_core.validate import validate_instance

from .disruptions import inject, parse_spec
from .generator import SIZE_PRESETS, GeneratorParams, generate


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="aeronexus-gen", description="AeroNexus synthetic network generator")
    ap.add_argument("--size", choices=sorted(SIZE_PRESETS), default="small")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--disruption", action="append", default=[], metavar="SPEC",
                    help="fog:DEL | capacity:BOM:480:180:0.5 | aog:VT-IAB:600 | crew:DEL:3:420 | atc:BLR | delay:6E2010:90 | closure:MAA")
    ap.add_argument("--out", type=Path, default=None, help="output JSON path (default data/instances/<name>.json)")
    ap.add_argument("--validate", action="store_true", help="run structural validation and print issues")
    ap.add_argument("--summary", action="store_true", help="print the instance summary as JSON")
    args = ap.parse_args(argv)

    inst = generate(GeneratorParams.for_size(args.size, args.seed))
    if args.disruption:
        rng = np.random.default_rng(args.seed)
        inst = inject(inst, *[parse_spec(s, inst, rng) for s in args.disruption])

    if args.validate:
        issues = validate_instance(inst)
        if issues:
            print(f"{len(issues)} issue(s):", file=sys.stderr)
            for i in issues[:50]:
                print("  -", i, file=sys.stderr)
            return 1
        print("instance is structurally valid")

    out = args.out or Path("data") / "instances" / f"{inst.name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(inst.to_json(), encoding="utf-8")
    print(f"wrote {out}")
    if args.summary:
        print(json.dumps(inst.summary(), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
