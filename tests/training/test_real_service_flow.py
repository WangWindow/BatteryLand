"""Opt-in single-backend GPU acceptance with the pinned DeepPlatform subprocess."""

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from batteryland.config import Settings
from batteryland.infrastructure.training.runs import StartCommand
from batteryland.interfaces.api.app import create_app
from batteryland.scheduler.local import LocalScheduler

ROOT = Path(__file__).resolve().parents[2]
PROVIDER = ROOT / "src/deeplatform"

pytestmark = [pytest.mark.training, pytest.mark.gpu]


@pytest.mark.parametrize("requested_device", ["cuda:0", "cuda:1", "auto"])
def test_real_gpu_experiment_uses_a_fresh_id_and_returns_results(tmp_path, requested_device):
    settings = Settings(
        data_dir=tmp_path / "backend",
        source_roots={"provider": Path("/data/BatteryLife_Processed")},
        validation_secret="real-local-secret",
        auto_index_catalog=False,
    )
    config = (
        (PROVIDER / "configs/calce_seed2021.yaml")
        .read_text()
        .replace("device: cuda:0", f"device: {requested_device}", 1)
        .replace("epochs: 100", "epochs: 1", 1)
        .replace("num_workers: 8", "num_workers: 0", 1)
    )
    split = (PROVIDER / "datasets/batteryLife/data_split/CALCE.json").read_text()
    with TestClient(create_app(settings)) as client:
        container = client.app.state.container
        validated = client.post(
            "/api/v1/training/validation",
            json={"config_text": config, "split_text": split},
        )
        assert validated.status_code == 200, validated.text
        receipt = validated.json()["data"]["receipt"]
        assert receipt["execution_supported"]
        created = client.post(
            "/api/v1/validated-experiments",
            json={
                "name": f"gpu-{requested_device}",
                "config_text": config,
                "split_text": split,
                "receipt": receipt,
            },
        )
        assert created.status_code == 201, created.text
        identity = created.json()["data"]["id"]
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 202
        scheduler = LocalScheduler(
            container.workers,
            container.execution,
            container.training_runs,
            container.results,
            container.artifacts,
            settings.data_dir,
        )
        scheduler.tick()
        active = container.workers.active(scheduler.node_id)
        assert len(active) == 1
        claim = active[0]
        first = container.training_runs.status(identity)["receipt"]
        repeated = container.training_runs.start(
            StartCommand(
                experiment_id=identity,
                intent_id=claim["intent_id"],
                resolved_device=claim["resolved_device"],
                config_text=config,
                split_text=split,
                receipt=receipt,
            )
        )
        assert repeated["pid"] == first["pid"]
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            scheduler.tick()
            experiment = client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]
            if experiment["state"] in {"succeeded", "failed", "stopped", "needs_reconciliation"}:
                break
            time.sleep(2)
        else:
            raise AssertionError("Real GPU experiment did not reach a terminal state")
        assert experiment["state"] == "succeeded", experiment
        assert experiment["requested_device"] == requested_device
        assert experiment["resolved_device"].startswith("cuda:")
        if requested_device != "auto":
            assert experiment["resolved_device"] == requested_device
        result = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
        assert result["available"], result
        assert result["metrics"]
        assert client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
