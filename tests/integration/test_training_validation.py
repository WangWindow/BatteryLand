"""The public validation API signs exact inputs through the local adapter."""

from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.interfaces.api.app import create_app


def test_custom_split_is_saved_as_valid_but_declared_unavailable(settings):
    configured = replace(settings, validation_secret="validation-secret")
    config = "mate:\n  device: auto\n"
    split = '{"dataset":"custom","train":["a.pkl"],"val":[],"test":[]}'
    with TestClient(create_app(configured, start_monitor=False)) as client:
        service = client.app.state.container.training_runs
        service.gateway.identity = lambda: "6b4c76d6e639ddaf9db9c15bf04771179a68d988"
        service.gateway.validate_structure = lambda value: {
            "valid": True,
            "components": [{"scope": "model", "type": "Demo", "source_hash": "hash"}],
        }
        response = client.post(
            "/api/v1/training/validation",
            json={"config_text": config, "split_text": split},
        )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["receipt"]["execution_supported"] is False
        assert data["receipt"]["component_versions"] == ["model:Demo:hash"]
        assert data["limitations"] == ["custom_split_unavailable"]
