"""Single-port client flow through the local scheduler boundary."""

import hashlib
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from batteryland.experiments.receipt import issue_receipt
from batteryland.scheduler.service import LocalScheduler

COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"
CONFIG = """mate:
  seed: 7
  device: auto
  experiment: demo
datafactory:
  type: BatteryLandBatteryLifeDatasetFactory
  params:
    dataset: demo
"""
SPLIT = '{"dataset":"demo","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'


class GpuSampler:
    def __init__(self) -> None:
        self.available = False

    def sample(self):
        return {
            "cpu_percent": 5,
            "memory_total": 100,
            "memory_available": 80,
            "gpus": (
                [
                    {
                        "cuda_index": 0,
                        "uuid": "GPU-test",
                        "total_bytes": 1000,
                        "free_bytes": 800,
                        "process_pids": [123],
                    }
                ]
                if self.available
                else []
            ),
            "reason": None if self.available else "GPU unavailable",
        }


class TrainingStub:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.write_bytes(b"artifact")
        self.starts = 0
        self.alive = True
        self.terminal_code = 0
        self.identity = ""
        self.intent = ""

    def start(self, body):
        self.starts += 1
        self.identity = str(body.experiment_id)
        self.intent = str(body.intent_id)
        assert body.resolved_device == "cuda:0"
        return self.receipt()

    def receipt(self):
        return {"experiment_id": self.identity, "intent_id": self.intent, "pid": 123}

    def status(self, identity):
        assert identity == self.identity
        return {
            "receipt": self.receipt(),
            "observation": {
                "identity_matches": True,
                "alive": self.alive,
                "exit_code": None if self.alive else self.terminal_code,
                "provider_status": "running"
                if self.alive
                else ("completed" if self.terminal_code == 0 else "interrupted"),
            },
        }

    def outputs(self, identity, console_cursor, metrics_offset):
        assert identity == self.identity
        metric = '{"epoch":1,"test":{"ABC":0.5}}\n'
        return {
            "console": {
                "text": "done\n" if console_cursor is None else "",
                "next_cursor": "cursor-1",
            },
            "console_start_offset": 0,
            "metrics_text": metric if metrics_offset == 0 else "",
            "metrics_next_offset": len(metric),
            "result": {
                "epoch": 1,
                "test": {"ABC": 0.5},
                "test_predictions": [{"file_name": "c.pkl", "prediction": 9, "target": 10}],
            },
            "artifacts": [
                {
                    "kind": "file",
                    "name": "report.txt",
                    "relative_key": "report.txt",
                    "sha256": hashlib.sha256(self.path.read_bytes()).hexdigest(),
                }
            ],
        }

    def artifact(self, identity, relative_key):
        assert identity == self.identity and relative_key == "report.txt"
        return self.path

    def stop(self, identity, stage):
        assert identity == self.identity and stage == "interrupt"
        self.alive = False
        self.terminal_code = -2
        return {"experiment_id": identity}


@pytest.mark.parametrize("case", range(3))
def test_one_backend_port_validates_and_runs_once_with_local_coordinator(settings, tmp_path, case):
    configured = replace(settings, validation_secret="local-secret", auto_index_catalog=False)
    for name in ("a.pkl", "b.pkl", "c.pkl"):
        (configured.source_roots["demo"] / name).write_bytes(name.encode())
    with TestClient(create_app(configured)) as client:
        container = client.app.state.container
        container.training_runs.gateway.identity = lambda: COMMIT
        container.training_runs.gateway.validate_structure = lambda config: {
            "valid": True,
            "components": [],
        }
        validation = client.post(
            "/api/v1/training/validation",
            json={"config_text": CONFIG, "split_text": SPLIT},
        )
        assert validation.status_code == 200, validation.text
        assert validation.json()["data"]["execution_supported"] is False
        receipt = issue_receipt(CONFIG, SPLIT, COMMIT, [], "local-secret")
        created = client.post(
            "/api/v1/validated-experiments",
            json={
                "name": f"local run {case}",
                "config_text": CONFIG,
                "split_text": SPLIT,
                "receipt": receipt,
            },
        )
        assert created.status_code == 201, created.text
        identity = created.json()["data"]["id"]
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 202
        sampler = GpuSampler()
        training = TrainingStub(tmp_path / "report.txt")
        scheduler = LocalScheduler(
            container.workers,
            container.execution,
            training,
            container.results,
            container.artifacts,
            configured.data_dir,
            sampler=sampler,
        )
        scheduler.tick()
        assert scheduler.last_action == "waiting-for-gpu"
        assert (
            client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]["state"]
            == "queued"
        )
        sampler.available = True
        scheduler.tick()
        assert training.starts == 1
        scheduler.tick()
        training.alive = False
        scheduler.tick()
        assert training.starts == 1
        result = client.get(f"/api/v1/experiments/{identity}/results")
        assert result.status_code == 200, result.text
        assert result.json()["data"]["metrics"][0]["name"] == "ABC"
        assert (
            client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]["state"]
            == "succeeded"
        )
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 409
        artifacts = client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
        assert any(item["name"] == "report.txt" for item in artifacts)


def test_local_stop_never_restarts_an_experiment(settings, tmp_path):
    configured = replace(settings, validation_secret="local-secret", auto_index_catalog=False)
    with TestClient(create_app(configured)) as client:
        receipt = issue_receipt(CONFIG, SPLIT, COMMIT, [], "local-secret")
        identity = client.post(
            "/api/v1/validated-experiments",
            json={"name": "stop", "config_text": CONFIG, "split_text": SPLIT, "receipt": receipt},
        ).json()["data"]["id"]
        client.post(f"/api/v1/validated-experiments/{identity}/submit").raise_for_status()
        container = client.app.state.container
        sampler = GpuSampler()
        sampler.available = True
        training = TrainingStub(tmp_path / "stopped-report.txt")
        scheduler = LocalScheduler(
            container.workers,
            container.execution,
            training,
            container.results,
            container.artifacts,
            configured.data_dir,
            sampler=sampler,
        )
        scheduler.tick()
        assert training.starts == 1
        assert client.post(f"/api/v1/experiments/{identity}/stop").status_code == 202
        scheduler.tick()
        scheduler.tick()
        assert (
            client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]["state"]
            == "stopped"
        )
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 409
        scheduler.tick()
        assert training.starts == 1
