from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict

from batteryland.config import Settings
from batteryland.domain.errors import DomainError
from batteryland.interfaces.api.app import create_app


def test_business_failures_have_http_semantics_and_no_internal_details(tmp_path: Path) -> None:
    app = create_app(Settings(data_dir=tmp_path))

    @app.get("/probe")
    def probe() -> None:
        raise DomainError("conflict", "Version has changed")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/probe")
    assert response.status_code == 409
    assert response.json() == {
        "code": 1003,
        "message": "Version has changed",
        "data": {"error": "conflict", "fields": [], "details": {}},
    }


def test_request_validation_uses_the_same_error_contract(tmp_path: Path) -> None:
    class Input(BaseModel):
        model_config = ConfigDict(extra="forbid")
        value: int

    app = create_app(Settings(data_dir=tmp_path))

    @app.post("/input")
    def receive(body: Input) -> int:
        return body.value

    with TestClient(app) as client:
        response = client.post("/input", json={"value": "wrong", "unexpected": True})
    assert response.status_code == 422
    assert response.json()["code"] == 1001
    assert response.json()["data"]["error"] == "invalid_input"
    assert len(response.json()["data"]["fields"]) == 2
