from app.engine.money import pence_to_pounds, pounds_to_pence


def test_converts_pounds_to_pence_without_float_drift():
    assert pounds_to_pence(1169.18) == 116918
    assert pounds_to_pence(0.1) == 10
    assert pounds_to_pence(250_000) == 25_000_000


def test_round_trips_pence_back_to_pounds_exactly():
    assert pence_to_pounds(116918) == 1169.18
    assert pence_to_pounds(10) == 0.1
