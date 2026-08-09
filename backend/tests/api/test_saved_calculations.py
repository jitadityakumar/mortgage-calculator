import os
import tempfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import Base, get_db
from app.engine import load_seed_defaults
from app.main import app

DEFAULT_DEPOSIT = load_seed_defaults().deposit

SAMPLE_INPUTS = {
    "propertyValue": 250_000,
    "deposit": 50_000,
    "fixedRateAnnualPct": 5,
    "fixedTermMonths": 300,
    "variableRateAnnualPct": 5,
    "totalTermMonths": 300,
}


@pytest.fixture()
def client() -> Iterator[TestClient]:
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
        app.dependency_overrides.clear()
        os.close(db_fd)
        os.unlink(db_path)


def test_create_returns_summary(client: TestClient) -> None:
    response = client.post("/api/v1/saved-calculations", json={"name": "My plan", "inputs": SAMPLE_INPUTS})
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "My plan"
    assert body["propertyValue"] == 250_000
    assert body["deposit"] == 50_000
    assert "id" in body and "createdAt" in body


def test_create_rejects_empty_name(client: TestClient) -> None:
    response = client.post("/api/v1/saved-calculations", json={"name": "", "inputs": SAMPLE_INPUTS})
    assert response.status_code == 422


def test_create_rejects_whitespace_only_name(client: TestClient) -> None:
    response = client.post("/api/v1/saved-calculations", json={"name": "   ", "inputs": SAMPLE_INPUTS})
    assert response.status_code == 422


def test_create_strips_surrounding_whitespace_from_name(client: TestClient) -> None:
    response = client.post("/api/v1/saved-calculations", json={"name": "  Plan  ", "inputs": SAMPLE_INPUTS})
    assert response.status_code == 201
    assert response.json()["name"] == "Plan"


def test_list_returns_all_saved_newest_first(client: TestClient) -> None:
    first = client.post("/api/v1/saved-calculations", json={"name": "Plan A", "inputs": SAMPLE_INPUTS}).json()
    second = client.post("/api/v1/saved-calculations", json={"name": "Plan B", "inputs": SAMPLE_INPUTS}).json()

    response = client.get("/api/v1/saved-calculations")
    assert response.status_code == 200
    items = response.json()
    assert [item["id"] for item in items] == [second["id"], first["id"]]


def test_get_returns_full_inputs(client: TestClient) -> None:
    created = client.post("/api/v1/saved-calculations", json={"name": "Plan A", "inputs": SAMPLE_INPUTS}).json()

    response = client.get(f"/api/v1/saved-calculations/{created['id']}")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Plan A"
    assert body["inputs"]["propertyValue"] == 250_000
    assert body["inputs"]["fixedTermMonths"] == 300


def test_get_missing_returns_404(client: TestClient) -> None:
    response = client.get("/api/v1/saved-calculations/999")
    assert response.status_code == 404


def test_delete_removes_it(client: TestClient) -> None:
    created = client.post("/api/v1/saved-calculations", json={"name": "Plan B", "inputs": SAMPLE_INPUTS}).json()

    response = client.delete(f"/api/v1/saved-calculations/{created['id']}")
    assert response.status_code == 204
    assert client.get(f"/api/v1/saved-calculations/{created['id']}").status_code == 404
    assert client.get("/api/v1/saved-calculations").json() == []


def test_delete_missing_returns_404(client: TestClient) -> None:
    response = client.delete("/api/v1/saved-calculations/999")
    assert response.status_code == 404


def test_created_at_is_timezone_aware(client: TestClient) -> None:
    # A naive datetime string (no UTC offset) gets misread as local time by
    # JS's `new Date()` on the frontend — createdAt must carry an offset.
    created = client.post("/api/v1/saved-calculations", json={"name": "Plan A", "inputs": SAMPLE_INPUTS}).json()
    assert created["createdAt"].endswith("+00:00") or created["createdAt"].endswith("Z")

    detail = client.get(f"/api/v1/saved-calculations/{created['id']}").json()
    assert detail["createdAt"].endswith("+00:00") or detail["createdAt"].endswith("Z")


def test_create_with_only_property_value_resolves_defaults_before_storing(client: TestClient) -> None:
    response = client.post(
        "/api/v1/saved-calculations", json={"name": "Quick estimate", "inputs": {"propertyValue": 250_000}}
    )
    assert response.status_code == 201
    body = response.json()
    # The point of this test is that these are real numbers rather than
    # nulls (which would otherwise crash summary serialization and any
    # later list call — see issue #5), not the exact default values
    # themselves (covered in test_mortgage.py / test_api.py).
    assert body["deposit"] == DEFAULT_DEPOSIT
    assert body["totalTermMonths"] == 300

    listing = client.get("/api/v1/saved-calculations")
    assert listing.status_code == 200

    detail = client.get(f"/api/v1/saved-calculations/{body['id']}").json()
    assert detail["inputs"]["fixedRateAnnualPct"] == 4.5


def test_saved_calculation_stores_inputs_not_computed_result(client: TestClient) -> None:
    # Saving twice with the same inputs should be independent rows, each
    # recomputable on load rather than sharing a cached result.
    first = client.post("/api/v1/saved-calculations", json={"name": "A", "inputs": SAMPLE_INPUTS}).json()
    second = client.post("/api/v1/saved-calculations", json={"name": "B", "inputs": SAMPLE_INPUTS}).json()
    assert first["id"] != second["id"]

    detail_a = client.get(f"/api/v1/saved-calculations/{first['id']}").json()
    detail_b = client.get(f"/api/v1/saved-calculations/{second['id']}").json()
    assert detail_a["inputs"] == detail_b["inputs"]
    assert "schedule" not in detail_a["inputs"]
