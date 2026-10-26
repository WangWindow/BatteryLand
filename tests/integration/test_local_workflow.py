"""Single-port client flow through the local scheduler boundary."""

import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from batteryland.results.storage import LocalResultFiles
from batteryland.scheduler.service import LocalScheduler
from tests.support import register_split

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
    def __init__(self, storage_root: Path) -> None:
        self.storage_root = storage_root
        self.starts = 0
        self.alive = True
        self.terminal_code = 0
        self.identity = ""
        self.intent = ""
        self.directory = None
        self.directory_ref = ""
        self.files = LocalResultFiles(storage_root)

    def start(self, body):
        self.starts += 1
        self.identity = str(body.experiment_id)
        self.intent = str(body.intent_id)
        assert body.resolved_device == "cuda:0"
        self.directory = self.storage_root / "experiments" / self.identity / "runs" / "run"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.directory_ref = self.directory.relative_to(self.storage_root).as_posix()
        return self.receipt()

    def receipt(self):
        return {
            "experiment_id": self.identity,
            "intent_id": self.intent,
            "pid": 123,
            "directory": str(self.directory),
            "directory_ref": self.directory_ref,
        }

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

    def outputs(self, identity):
        assert identity == self.identity
        assert self.directory is not None
        epoch = 1 if self.alive else 2
        (self.directory / "metrics.jsonl").write_text(
            '{"epoch":1,"test":{"ABC":0.5}}\n', encoding="utf-8"
        )
        (self.directory / "best_result.json").write_text(
            json.dumps(
                {
                    "epoch": epoch,
                    "test": {"ABC": 0.5},
                    "test_predictions": [
                        {"file_name": "c.pkl", "prediction": 9, "target": 10}
                    ],
                }
            ),
            encoding="utf-8",
        )
        (self.directory / "report.txt").write_text("artifact", encoding="utf-8")
        (self.directory / "console.log").write_text("done\n", encoding="utf-8")
        return {
            "artifacts": self.files.scan(self.directory_ref, terminal=not self.alive),
        }

    def stop(self, identity, stage):
        assert identity == self.identity and stage == "interrupt"
        self.alive = False
        self.terminal_code = -2
        return {"experiment_id": identity}


@pytest.mark.parametrize("case", range(3))
def test_one_backend_port_validates_and_runs_once_with_local_coordinator(settings, case):
    configured = replace(settings, validation_secret="local-secret", auto_index_catalog=False)
    registered = register_split(
        configured,
        "demo",
        ("a.pkl", "b.pkl", "c.pkl"),
        {"train": ("a.pkl",), "val": ("b.pkl",), "test": ("c.pkl",)},
        root_alias="demo",
    )
    with TestClient(create_app(configured)) as client:
        container = client.app.state.container
        container.training_runs.gateway.identity = lambda: COMMIT
        container.training_runs.gateway.validate_structure = lambda config: {
            "valid": True,
            "components": [],
        }
        validation = client.post(
            "/api/v1/training/validation",
            json={
                "config_text": CONFIG,
                "split_id": registered["split"]["id"],
                "split_version": registered["split"]["version"],
            },
        )
        assert validation.status_code == 200, validation.text
        validated = validation.json()["data"]
        assert validated["execution_supported"] is True
        created = client.post(
            "/api/v1/validated-experiments",
            json={
                "name": f"local run {case}",
                "config_text": CONFIG,
                "split_text": validated["split_text"],
                "split_id": registered["split"]["id"],
                "split_version": registered["split"]["version"],
                "receipt": validated["receipt"],
            },
        )
        assert created.status_code == 201, created.text
        identity = created.json()["data"]["id"]
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 202
        sampler = GpuSampler()
        training = TrainingStub(configured.data_dir)
        scheduler = LocalScheduler(
            container.scheduler_state,
            container.validated_experiments,
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
        assert result.json()["data"]["best_epoch"] == 2
        assert result.json()["data"]["version"] == 1
        assert (
            client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]["state"]
            == "succeeded"
        )
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 409
        artifacts = client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
        assert any(item["name"] == "report.txt" for item in artifacts)
        assert sum(item["name"] == "best_result.json" for item in artifacts) == 1
        log = container.results.logs(identity, "console", None, 65536)
        assert log["text"] == "done\n"
        assert (
            configured.data_dir / "experiments" / identity / "runs" / "run" / "best_result.json"
        ).is_file()
        assert not (configured.data_dir / "archives" / identity).exists()
        assert not (configured.data_dir / "worker-output" / identity).exists()
        assert not (configured.data_dir / "worker-artifacts" / identity).exists()
        with container.database.unit_of_work() as unit:
            best_result = next(
                item
                for item in unit.artifacts.for_experiment(identity)
                if item["name"] == "best_result.json"
            )
            experiment_artifacts = unit.artifacts.for_experiment(identity)
        assert all(
            item["relative_key"].startswith(f"experiments/{identity}/")
            for item in experiment_artifacts
        )
        assert best_result["relative_key"].startswith(f"experiments/{identity}/")


def test_local_stop_never_restarts_an_experiment(settings):
    configured = replace(settings, validation_secret="local-secret", auto_index_catalog=False)
    registered = register_split(
        configured,
        "demo",
        ("a.pkl", "b.pkl", "c.pkl"),
        {"train": ("a.pkl",), "val": ("b.pkl",), "test": ("c.pkl",)},
        root_alias="demo",
    )
    with TestClient(create_app(configured)) as client:
        container = client.app.state.container
        container.training_runs.gateway.identity = lambda: COMMIT
        container.training_runs.gateway.validate_structure = lambda config: {
            "valid": True,
            "components": [],
        }
        validated = client.post(
            "/api/v1/training/validation",
            json={
                "config_text": CONFIG,
                "split_id": registered["split"]["id"],
                "split_version": registered["split"]["version"],
            },
        ).json()["data"]
        identity = client.post(
            "/api/v1/validated-experiments",
            json={
                "name": "stop",
                "config_text": CONFIG,
                "split_text": validated["split_text"],
                "split_id": registered["split"]["id"],
                "split_version": registered["split"]["version"],
                "receipt": validated["receipt"],
            },
        ).json()["data"]["id"]
        client.post(f"/api/v1/validated-experiments/{identity}/submit").raise_for_status()
        sampler = GpuSampler()
        sampler.available = True
        training = TrainingStub(configured.data_dir)
        scheduler = LocalScheduler(
            container.scheduler_state,
            container.validated_experiments,
            training,
            container.results,
            container.artifacts,
            configured.data_dir,
            sampler=sampler,
        )
        scheduler.tick()
        assert training.starts == 1
        assert client.post(f"/api/v1/validated-experiments/{identity}/stop").status_code == 202
        scheduler.tick()
        scheduler.tick()
        assert (
            client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]["state"]
            == "stopped"
        )
        assert client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 409
        scheduler.tick()
        assert training.starts == 1
