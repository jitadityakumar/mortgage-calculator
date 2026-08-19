from fastapi.testclient import TestClient

from app.engine import calculate_sdlt, load_seed_defaults
from app.main import app

client = TestClient(app)
_SEED = load_seed_defaults()
DEFAULT_DEPOSIT = _SEED.deposit
# The seed ships deriveDepositFromSavings=true, so a request that omits
# `deposit` actually resolves via depositSavings minus SDLT, not the flat
# DEFAULT_DEPOSIT above — see resolve_mortgage_inputs().
DERIVED_DEPOSIT_250K = max(0, round(_SEED.depositSavings - calculate_sdlt(250_000, _SEED.isFirstTimeBuyer).totalTax))


def test_health() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_calculate_returns_full_result() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "propertyValue": 250_000,
            "deposit": 50_000,
            "fixedRateAnnualPct": 5,
            "fixedTermMonths": 300,
            "variableRateAnnualPct": 5,
            "totalTermMonths": 300,
            # Explicit zero pool: currentRent/monthlySavings/serviceCharge
            # otherwise resolve from the admin-editable defaults, which would
            # inject a real overpayment pool and pay this off early — this
            # test wants a plain, full-length schedule.
            "currentRent": 0,
            "monthlySavings": 0,
            "serviceCharge": 0,
            "includeSchedule": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["principal"] == 200_000
    assert len(body["schedule"]) == 300
    assert body["schedule"][-1]["closingBalance"] == 0


def test_calculate_echoes_the_resolved_rate_after_fixed_term_mode() -> None:
    # A request that omits rateAfterFixedTermMode resolves from the
    # admin-editable default (shipped default: remortgageToNewFixed) — the
    # response should say so, since the caller has no other way to know
    # which mode was actually applied without a second round-trip.
    omitted = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert omitted.json()["rateAfterFixedTermMode"] == "remortgageToNewFixed"

    explicit = client.post(
        "/api/v1/calculate",
        json={"propertyValue": 250_000, "rateAfterFixedTermMode": "hybrid"},
    )
    assert explicit.json()["rateAfterFixedTermMode"] == "hybrid"


def test_compare_returns_both_scenarios() -> None:
    response = client.post(
        "/api/v1/compare",
        json={
            "propertyValue": 250_000,
            "deposit": 50_000,
            "fixedRateAnnualPct": 5,
            "fixedTermMonths": 300,
            "variableRateAnnualPct": 5,
            "totalTermMonths": 300,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert "withOverpayments" in body
    assert "withoutOverpayments" in body


def test_calculate_returns_400_with_issues_for_invalid_inputs() -> None:
    response = client.post(
        "/api/v1/calculate",
        json={
            "propertyValue": 100_000,
            # deposit >= propertyValue triggers MortgageValidationError, not
            # a Pydantic 422 - this is the custom exception handler's path.
            "deposit": 150_000,
            "fixedRateAnnualPct": 5,
            "fixedTermMonths": 300,
            "variableRateAnnualPct": 5,
            "totalTermMonths": 300,
        },
    )
    assert response.status_code == 400
    body = response.json()
    assert "issues" in body
    assert any("Deposit must be less than" in issue for issue in body["issues"])


def test_compare_with_only_property_value_uses_defaults() -> None:
    response = client.post("/api/v1/compare", json={"propertyValue": 250_000})
    assert response.status_code == 200
    body = response.json()
    assert body["withOverpayments"]["principal"] == 250_000 - DERIVED_DEPOSIT_250K
    assert body["withoutOverpayments"]["principal"] == 250_000 - DERIVED_DEPOSIT_250K


def test_calculate_with_only_property_value_uses_defaults() -> None:
    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000, "includeSchedule": True})
    assert response.status_code == 200
    body = response.json()
    # deriveDepositFromSavings is on by default, so deposit resolves to
    # depositSavings minus SDLT (SDLT is £0 here — FTB, under the £300k
    # zero-rate threshold), not the flat `deposit` default.
    assert body["principal"] == 250_000 - DERIVED_DEPOSIT_250K
    # Every other field defaults too, including the rent+savings pool and
    # 'auto' overpayment mode — real overpayments pay this off well before
    # the default 300-month term.
    assert len(body["schedule"]) == 61


def test_calculate_with_property_value_and_deposit_only_uses_defaults_for_rest() -> None:
    response = client.post(
        "/api/v1/calculate", json={"propertyValue": 250_000, "deposit": 50_000, "includeSchedule": True}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["principal"] == 200_000
    # rateAfterFixedTermMode now defaults to remortgageToNewFixed (was
    # implicitly stayOnVariable before this field existed) — the loan cycles
    # back into a new fixed deal after the fixed term + remortgage gap instead
    # of paying off shortly after moving to the variable rate, extending the
    # payoff schedule (was 67 months).
    # 71 (was 123 before issue #12's fix): the 60-month fixed term is a
    # multiple of 12, so the old absolute-loan-age allowance-year reset
    # always landed on the SVR gap month, and the gap's lump-sum sweep
    # silently consumed the entire next fixed deal's auto-pacing target —
    # stalling 'auto' overpayments for ~11 months after every remortgage
    # cycle and dragging out payoff. Fixed pacing now clears the loan much
    # sooner.
    assert len(body["schedule"]) == 71


def test_get_defaults_returns_the_shared_default_values() -> None:
    response = client.get("/api/v1/defaults")
    assert response.status_code == 200
    body = response.json()
    assert body["deposit"] == DEFAULT_DEPOSIT
    assert body["fixedRateAnnualPct"] == 4.5
    assert body["fixedTermMonths"] == 60
    assert body["totalTermMonths"] == 300
    assert body["variableRateAnnualPct"] == 7.25
    assert body["overpaymentMode"] == "reduceTerm"
    assert body["monthlyOverpaymentAmountMode"] == "auto"
    assert body["bankedSavingsDestination"] == "lumpSumEachCycle"
    assert body["config"]["annualOverpaymentAllowancePct"] == 10


def test_calculate_returns_422_for_malformed_request_body() -> None:
    response = client.post("/api/v1/calculate", json={"propertyValue": "not-a-number"})
    assert response.status_code == 422


def test_cors_allows_configured_frontend_origin() -> None:
    response = client.options(
        "/api/v1/calculate",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
