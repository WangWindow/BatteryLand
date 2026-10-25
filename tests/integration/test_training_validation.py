"""The public validation API signs exact inputs through the local adapter."""

from dataclasses import replace

from fastapi.testclient import TestClient

from batteryland.api.app import create_app


def test_custom_split_is_supported_by_the_batteryland_data_factory(settings):
    configured = replace(settings, validation_secret="validation-secret")
    for name in ("a.pkl", "b.pkl", "c.pkl"):
        (configured.source_roots["demo"] / name).write_bytes(name.encode())
    config = """mate:
  seed: 7
  device: auto
  experiment: custom
datafactory:
  type: BatteryLandBatteryLifeDatasetFactory
  params:
    dataset: custom
"""
    split = '{"dataset":"custom","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'
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
        assert data["receipt"]["execution_supported"] is True
        assert data["receipt"]["component_versions"] == ["model:Demo:hash"]
        assert data["limitations"] == []


def test_custom_split_rejects_a_dataset_name_that_differs_from_config(settings):
    configured = replace(settings, validation_secret="validation-secret")
    for name in ("a.pkl", "b.pkl", "c.pkl"):
        (configured.source_roots["demo"] / name).write_bytes(name.encode())
    config = """mate:
  seed: 7
  device: auto
  experiment: custom
datafactory:
  type: BatteryLandBatteryLifeDatasetFactory
  params:
    dataset: configured-name
"""
    split = '{"dataset":"different-name","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'
    with TestClient(create_app(configured, start_monitor=False)) as client:
        service = client.app.state.container.training_runs
        service.gateway.identity = lambda: "6b4c76d6e639ddaf9db9c15bf04771179a68d988"
        service.gateway.validate_structure = lambda value: {
            "valid": True,
            "components": [],
        }
        response = client.post(
            "/api/v1/training/validation",
            json={"config_text": config, "split_text": split},
        )
        assert response.status_code == 422
        assert response.json()["data"]["error"] == "invalid_input"
