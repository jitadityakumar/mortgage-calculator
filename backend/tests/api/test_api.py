from fastapi.testclient import TestClient

from app.engine import load_seed_defaults
from app.main import app

client = TestClient(app)
DEFAULT_DEPOSIT = load_seed_defaults().deposit


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
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["principal"] == 200_000
    assert len(body["schedule"]) == 300
    assert body["schedule"][-1]["closingBalance"] == 0


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
    assert body["withOverpayments"]["principal"] == 250_000 - DEFAULT_DEPOSIT
    assert body["withoutOverpayments"]["principal"] == 250_000 - DEFAULT_DEPOSIT


def test_calculate_with_only_property_value_uses_defaults() -> None:
    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    body = response.json()
    assert body["principal"] == 250_000 - DEFAULT_DEPOSIT
    assert len(body["schedule"]) == 300


def test_calculate_with_property_value_and_deposit_only_uses_defaults_for_rest() -> None:
    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000, "deposit": 50_000})
    assert response.status_code == 200
    body = response.json()
    assert body["principal"] == 200_000
    assert len(body["schedule"]) == 300


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
