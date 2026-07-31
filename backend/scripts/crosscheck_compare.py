"""
One-off cross-check: reads TS-engine-generated cases (inputs + TS outputs)
from ../scripts/crosscheck/ts_output.json and recomputes each with the
Python engine, asserting the two agree. See migration.md "Parity validation".
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.engine.mortgage import calculate_mortgage, compare_with_and_without_overpayments
from app.engine.types import MortgageInputs

TOLERANCE = 1e-6

CASES_PATH = Path(__file__).resolve().parent.parent.parent / "scripts" / "crosscheck" / "ts_output.json"


def _close(a: object, b: object, path: str, mismatches: list[str]) -> None:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        if abs(a - b) > TOLERANCE:
            mismatches.append(f"{path}: ts={a!r} py={b!r}")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            mismatches.append(f"{path}: length ts={len(a)} py={len(b)}")
            return
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}[{i}]", mismatches)
    elif isinstance(a, dict) and isinstance(b, dict):
        keys = set(a) | set(b)
        for k in keys:
            _close(a.get(k), b.get(k), f"{path}.{k}", mismatches)
    else:
        if a != b:
            mismatches.append(f"{path}: ts={a!r} py={b!r}")


def main() -> int:
    cases = json.loads(CASES_PATH.read_text())
    print(f"Loaded {len(cases)} cross-check cases from {CASES_PATH}")

    total_mismatches = 0
    for i, case in enumerate(cases):
        inputs = MortgageInputs(**case["inputs"])

        py_calculate = json.loads(calculate_mortgage(inputs).model_dump_json())
        py_compare = json.loads(compare_with_and_without_overpayments(inputs).model_dump_json())

        mismatches: list[str] = []
        _close(case["calculate"], py_calculate, f"case[{i}].calculate", mismatches)
        _close(case["compare"], py_compare, f"case[{i}].compare", mismatches)

        if mismatches:
            total_mismatches += len(mismatches)
            print(f"\nCase {i} MISMATCH ({len(mismatches)} field(s)):")
            for m in mismatches[:10]:
                print(f"  {m}")
            if len(mismatches) > 10:
                print(f"  ... and {len(mismatches) - 10} more")

    if total_mismatches:
        print(f"\nFAILED: {total_mismatches} field mismatches across {len(cases)} cases.")
        return 1

    print(f"\nPASSED: all {len(cases)} cases match between TS and Python engines (tolerance {TOLERANCE}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
