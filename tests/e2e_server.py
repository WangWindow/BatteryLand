"""Browser acceptance backend with a controlled child-process training provider."""

import hashlib
import os
import shutil
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

import fastapi.routing
import uvicorn

import batteryland.api.app as app_module
import batteryland.results.routes as results_routes
import batteryland.scheduler.service as scheduler_module
from batteryland.common.storage import ManagedArtifacts
from batteryland.components.service import ArtifactService
from batteryland.config import Settings
from batteryland.container import Container
from batteryland.scheduler.processes import ProcessSupervisor
from batteryland.training.gateway import PROVIDER_COMMIT
from batteryland.training.runs import TrainingRunService

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("E2E_DATA_DIR", "/tmp/batteryland-e2e"))
SOURCE_DIR = DATA_DIR / "source"
FILES = [f"cell-{letter}.pkl" for letter in "abcdef"]


class ControlledGateway:
    """Use the real validation/materialization/scheduler flow with a tiny local trainer."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = settings.data_dir / "plugins"
        self.supervisor = ProcessSupervisor()

    def identity(self) -> str:
        return PROVIDER_COMMIT

    def components(self, scope: str | None = None) -> list[dict[str, Any]]:
        return []

    def validate_structure(self, config: dict[str, Any]) -> dict[str, Any]:
        return {"valid": True, "errors": [], "warnings": [], "components": []}

    def prepare(self, materialized: dict[str, Any]) -> dict[str, Any]:
        experiment_id = materialized["experiment_id"]
        directory = self.settings.data_dir / "runs" / experiment_id
        directory.mkdir(parents=True, exist_ok=False)
        config_path = Path(materialized["config_path"])
        shutil.copyfile(config_path, directory / "config.yaml")
        config_digest = hashlib.sha256((directory / "config.yaml").read_bytes()).hexdigest()
        native_config = materialized["snapshot"]["native_config"]
        mate = native_config.get("mate", {})
        return {
            "experiment_id": experiment_id,
            "intent_id": materialized["intent_id"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
            "provider_config_sha256": config_digest,
            "directory": str(directory),
            "directory_ref": str(directory.relative_to(self.settings.data_dir)),
            "duration": mate.get("duration", 0.35),
            "seed": mate.get("seed", 0),
        }

    def spawn(self, prepared: dict[str, Any]) -> dict[str, Any]:
        runner = r"""
import json
import pathlib
import sys
import time

directory = pathlib.Path(sys.argv[1])
duration = float(sys.argv[2])
seed = int(sys.argv[3])
print("BatteryLand controlled training started", flush=True)
time.sleep(duration)
mape = round(0.1 + (seed % 100) / 10000, 5)
result = {
    "epoch": 3,
    "test": {"mape": mape, "mae": 1.25, "ABC": seed},
    "units": {"mape": "ratio", "mae": "cycles"},
    "test_predictions": [
        {"file_name": "cell-a.pkl", "prediction": 84.0 + seed % 3, "target": 85.0},
        {"file_name": "cell-b.pkl", "prediction": 79.0, "target": 80.0},
    ],
    "history": [
        {"train": {"loss": 0.8}, "validation": {"mape": 0.24}},
        {"train": {"loss": 0.5}, "validation": {"mape": 0.18}},
        {"train": {"loss": 0.3}, "validation": {"mape": 0.14}},
    ],
}
(directory / "best_result.json").write_text(json.dumps(result), encoding="utf-8")
lines = [
    json.dumps({"epoch": epoch, **metrics})
    for epoch, metrics in enumerate(result["history"], start=1)
]
(directory / "metrics.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("BatteryLand controlled training finished", flush=True)
"""
        receipt = self.supervisor.start(
            [
                sys.executable,
                "-u",
                "-c",
                runner,
                prepared["directory"],
                str(prepared["duration"]),
                str(prepared["seed"]),
            ],
            Path(prepared["directory"]),
            prepared["experiment_id"],
        )
        return receipt | {
            "intent_id": prepared["intent_id"],
            "input_manifest_sha256": prepared["input_manifest_sha256"],
            "provider_config_sha256": prepared["provider_config_sha256"],
            "directory_ref": prepared["directory_ref"],
            "requested_device": "auto",
            "effective_device": "cuda:0",
            "provider_commit": PROVIDER_COMMIT,
        }

    def observe(self, receipt: dict[str, Any]) -> dict[str, Any]:
        return self.supervisor.observe(receipt)

    def signal(self, receipt: dict[str, Any], stage: str) -> dict[str, Any]:
        return self.supervisor.signal(receipt, stage)


class E2EContainer(Container):
    def _compose(self, settings: Settings) -> None:
        super()._compose(settings)
        training_settings = replace(settings, data_dir=settings.data_dir / "training")
        provider = ControlledGateway(training_settings)
        self.provider = provider  # type: ignore[assignment]
        self.training_runs = TrainingRunService(training_settings, provider)  # type: ignore[assignment]
        self.artifacts = ArtifactService(
            self.database.unit_of_work,
            provider,
            ManagedArtifacts(settings.data_dir),
            settings.checkpoint_limit,
        )


class E2EResourceSampler:
    def sample(self) -> dict[str, Any]:
        return {
            "cpu_percent": 11.0,
            "memory_total": 16 * 1024**3,
            "memory_available": 12 * 1024**3,
            "gpus": [
                {
                    "cuda_index": 0,
                    "uuid": "GPU-e2e",
                    "total_bytes": 8 * 1024**3,
                    "free_bytes": 7 * 1024**3,
                    "memory_used_bytes": 1024**3,
                    "utilization_percent": 0.0,
                    "process_pids": [],
                    "reason": None,
                }
            ],
            "reason": None,
        }


async def run_inline(*args: Any, **kwargs: Any) -> Any:
    """Keep this test server usable in restricted runners without thread wakeups."""
    function, *positional = args
    return function(*positional, **kwargs)


if SOURCE_DIR.exists():
    shutil.rmtree(SOURCE_DIR)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)
for name in FILES:
    (SOURCE_DIR / name).write_bytes(b"controlled-e2e-fixture")

settings = Settings(
    data_dir=DATA_DIR,
    source_roots={"demo": SOURCE_DIR},
    validation_secret="batteryland-playwright-validation-secret",
    auto_index_catalog=True,
)

app_module.Container = E2EContainer
app_module.run_in_threadpool = run_inline
results_routes.run_in_threadpool = run_inline
fastapi.routing.run_in_threadpool = run_inline
scheduler_module.ResourceSampler = E2EResourceSampler  # type: ignore[assignment,misc]
app = app_module.create_app(settings, start_monitor=True)

if __name__ == "__main__":
    port = int(os.environ.get("E2E_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", workers=1)
