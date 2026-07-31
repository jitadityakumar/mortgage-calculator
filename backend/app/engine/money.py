"""
All monetary values inside the engine are handled as integer pence to avoid
floating point drift compounding across hundreds of amortization periods.
UI-facing inputs/outputs use pounds (regular numbers); conversion happens
only at the boundary.
"""

import math


def js_round(x: float) -> int:
    """Replicates JavaScript's Math.round semantics (round half toward
    +Infinity), which differs from Python's banker's-rounding built-in
    round(). Required for pence-exact parity with the ported TS engine.

    Deliberately not `math.floor(x + 0.5)`: that expression rounds
    0.49999999999999994 up to 1 (the float sum itself rounds to exactly 0.5
    before the floor), while JS's Math.round correctly returns 0 for that
    input. Comparing against the integer part directly avoids the
    intermediate sum losing precision."""
    f = math.floor(x)
    return f if x - f < 0.5 else f + 1


def pounds_to_pence(pounds: float) -> int:
    return js_round(pounds * 100)


def pence_to_pounds(pence: int) -> float:
    return pence / 100
