import tempfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base, get_db
from app.engine import load_seed_defaults
from app.main import app

SEED = load_seed_defaults()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    # A fresh temp-file DB per test, same pattern as test_saved_calculations.py
    # — deliberately has no defaults_config row (main.py's startup seeding
    # only runs against the app's real DATABASE_URL-bound engine, not this
    # per-test override), which exercises load_current_defaults()'s
    # defensive fallback to the shipped seed defaults.
    db_fd, db_path = tempfile.mkstemp(suffix=".db")
    test_engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    def override_get_db() -> Iterator:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_get_defaults_on_fresh_db_returns_shipped_values(client: TestClient) -> None:
    response = client.get("/api/v1/defaults")
    assert response.status_code == 200
    body = response.json()
    assert body["deposit"] == SEED.deposit
    assert body["fixedRateAnnualPct"] == SEED.fixedRateAnnualPct
    assert body["fixedMonthlyOverpayment"] == SEED.fixedMonthlyOverpayment
    assert body["targetAllowanceUtilizationPct"] == SEED.targetAllowanceUtilizationPct
    assert body["currentRent"] == SEED.currentRent
    assert body["monthlySavings"] == SEED.monthlySavings
    assert body["serviceCharge"] == SEED.serviceCharge
    assert body["rateAfterFixedTermMode"] == SEED.rateAfterFixedTermMode


def test_put_defaults_persists_and_is_reflected_by_later_get(client: TestClient) -> None:
    updated = {**SEED.model_dump(exclude={"updatedAt"}), "fixedRateAnnualPct": 6.25}
    put_response = client.put("/api/v1/defaults", json=updated)
    assert put_response.status_code == 200
    assert put_response.json()["fixedRateAnnualPct"] == 6.25
    assert put_response.json()["updatedAt"] is not None

    get_response = client.get("/api/v1/defaults")
    assert get_response.json()["fixedRateAnnualPct"] == 6.25


def test_put_defaults_changes_what_partial_calculate_resolves_to(client: TestClient) -> None:
    # deriveDepositFromSavings=false so the flat `deposit` default (not
    # depositSavings minus SDLT) is what a partial /calculate resolves to.
    updated = {**SEED.model_dump(exclude={"updatedAt"}), "deposit": 12345, "deriveDepositFromSavings": False}
    client.put("/api/v1/defaults", json=updated)

    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    assert response.json()["principal"] == 250_000 - 12345


def test_put_defaults_changes_what_partial_calculate_resolves_to_via_derived_deposit(
    client: TestClient,
) -> None:
    # deriveDepositFromSavings stays on (the seed default) — editing
    # depositSavings should move what a partial /calculate resolves deposit
    # to, proving the SDLT-derivation path (not just the flat `deposit`
    # fallback) reads the live admin-edited defaults.
    updated = {**SEED.model_dump(exclude={"updatedAt"}), "depositSavings": 120_000}
    client.put("/api/v1/defaults", json=updated)

    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    # SDLT for an FTB at £250,000 is £0 (under the £300k zero-rate threshold).
    assert response.json()["principal"] == 250_000 - 120_000


def test_put_defaults_changes_what_partial_calculate_resolves_to_for_fixed_overpayment(
    client: TestClient,
) -> None:
    updated = {
        **SEED.model_dump(exclude={"updatedAt"}),
        "monthlyOverpaymentAmountMode": "fixed",
        "fixedMonthlyOverpayment": 999,
    }
    client.put("/api/v1/defaults", json=updated)

    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    # First month's overpayment is the fixed amount itself (before any
    # allowance/ERC capping could reduce it) — proves the admin-edited
    # default flowed all the way into the engine, not just the response echo.
    assert response.json()["schedule"][0]["overpaymentPaid"] == 999


def test_put_defaults_changes_what_partial_calculate_resolves_to_for_the_rent_savings_pool(
    client: TestClient,
) -> None:
    updated = {
        **SEED.model_dump(exclude={"updatedAt"}),
        "monthlyOverpaymentAmountMode": "fixed",
        "fixedMonthlyOverpayment": 0,
        "currentRent": 1200,
        "monthlySavings": 300,
        "serviceCharge": 100,
    }
    client.put("/api/v1/defaults", json=updated)

    # Fixed monthly overpayment is 0, so the whole pool (1200 + 300 - 100 =
    # 1400) left over after the scheduled payment banks into savings instead
    # — proves all three admin-edited defaults flowed into the engine's pool,
    # not just the response echo.
    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    body = response.json()
    assert body["schedule"][0]["overpaymentPaid"] == 0
    assert body["schedule"][0]["savingsAddedThisMonth"] == pytest.approx(
        1400 - body["schedule"][0]["scheduledPayment"], abs=0.5
    )


def test_put_defaults_changes_what_partial_calculate_resolves_to_for_rate_after_fixed_term(
    client: TestClient,
) -> None:
    updated = {
        **SEED.model_dump(exclude={"updatedAt"}),
        "rateAfterFixedTermMode": "stayOnVariable",
        "monthlyOverpaymentAmountMode": "none",
        "currentRent": 0,
        "monthlySavings": 0,
        "serviceCharge": 0,
    }
    client.put("/api/v1/defaults", json=updated)

    response = client.post("/api/v1/calculate", json={"propertyValue": 250_000})
    assert response.status_code == 200
    body = response.json()
    # Shortly after the fixed term + remortgage gap ends, the shipped
    # remortgageToNewFixed default would cycle back to the fixed rate —
    # stayOnVariable keeps the variable rate applied instead, proving the
    # admin-set default (not the seed) flowed into the engine.
    post_gap_month = int(SEED.fixedTermMonths + SEED.remortgageGapMonths + 1)
    entry = next(e for e in body["schedule"] if e["month"] == post_gap_month)
    assert entry["ratePct"] == SEED.variableRateAnnualPct


def test_put_defaults_changes_what_saved_calculation_resolves_to(client: TestClient) -> None:
    # deriveDepositFromSavings=false so the flat `deposit` default (not
    # depositSavings minus SDLT) is what a partial save resolves to.
    updated = {**SEED.model_dump(exclude={"updatedAt"}), "deposit": 54321, "deriveDepositFromSavings": False}
    client.put("/api/v1/defaults", json=updated)

    response = client.post(
        "/api/v1/saved-calculations",
        json={"name": "partial", "inputs": {"propertyValue": 250_000}},
    )
    assert response.status_code == 201
    assert response.json()["deposit"] == 54321


def test_post_reset_defaults_restores_shipped_values(client: TestClient) -> None:
    updated = {**SEED.model_dump(exclude={"updatedAt"}), "deposit": 1}
    client.put("/api/v1/defaults", json=updated)

    reset_response = client.post("/api/v1/defaults/reset")
    assert reset_response.status_code == 200
    assert reset_response.json()["deposit"] == SEED.deposit

    get_response = client.get("/api/v1/defaults")
    assert get_response.json()["deposit"] == SEED.deposit


@pytest.mark.parametrize(
    "override",
    [
        {"deposit": -1},
        {"fixedRateAnnualPct": 500},
        {"totalTermMonths": 0},
        {"fixedTermMonths": 400, "totalTermMonths": 300},
        {"depositSavings": -1},
        {"fixedMonthlyOverpayment": -1},
        {"targetAllowanceUtilizationPct": 101},
        {"currentRent": -1},
        {"monthlySavings": -1},
        {"serviceCharge": -1},
    ],
)
def test_put_defaults_rejects_invalid_values(client: TestClient, override: dict) -> None:
    updated = {**SEED.model_dump(exclude={"updatedAt"}), **override}
    response = client.put("/api/v1/defaults", json=updated)
    assert response.status_code == 400
    assert response.json()["issues"]
