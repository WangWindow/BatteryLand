"""Browser acceptance backend with a controlled training process.

This module is test-only. It starts the real FastAPI application, serves a
temporary SQLite/JSON data root, and uses a deterministic subprocess gateway so
Playwright can exercise real HTTP execution without a GPU or deeplatform data.
"""

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import uvicorn

from batteryland.api.app import create_app
from batteryland.config import Settings
from batteryland.scheduler.processes import ProcessSupervisor

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("E2E_DATA_DIR", ROOT / "var" / "e2e-workbench")).resolve()
SOURCE_DIR = DATA_DIR / "source"


class ControlledTraining:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.started: list[str] = []

    def validate(self, config: dict[str, Any], resources: dict[str, Any]) -> dict[str, Any]:
        return {
            "valid": True,
            "errors": [],
            "warnings": [],
            "provider_commit": "browser-e2e",
            "components": [],
        }

    def prepare(self, materialized: dict[str, Any]) -> dict[str, Any]:
        experiment = materialized["experiment_id"]
        directory = self.settings.data_dir / "runs" / experiment
        directory.mkdir(parents=True, exist_ok=False)
        shutil.copyfile(materialized["config_path"], directory / "config.yaml")
        return {
            "experiment_id": experiment,
            "intent_id": materialized["intent_id"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
            "provider_config_sha256": materialized["config_sha256"],
            "directory": str(directory),
            "directory_ref": str(directory.relative_to(self.settings.data_dir)),
            "duration": materialized["snapshot"]["native_config"]["mate"].get("duration", 0.4),
        }

    def spawn(self, prepared: dict[str, Any]) -> dict[str, Any]:
        runner = getattr(self, "runner", None) or ProcessSupervisor()
        self.runner = runner
        self.started.append(prepared["experiment_id"])
        receipt = runner.start(
            [
                sys.executable,
                "-c",
                "import time; print('browser e2e started', flush=True); "
                "time.sleep(float(__import__('sys').argv[1])); "
                "print('browser e2e finished', flush=True)",
                str(prepared["duration"]),
            ],
            Path(prepared["directory"]),
            prepared["experiment_id"],
        )
        return receipt | {
            "intent_id": prepared["intent_id"],
            "input_manifest_sha256": prepared["input_manifest_sha256"],
            "provider_config_sha256": prepared["provider_config_sha256"],
            "directory_ref": prepared["directory_ref"],
            "requested_device": "cpu",
            "effective_device": "cpu",
        }

    def observe(self, receipt: dict[str, Any]) -> dict[str, Any]:
        return self.runner.observe(receipt)

    def signal(self, receipt: dict[str, Any], stage: str) -> dict[str, Any]:
        return self.runner.signal(receipt, stage)


if DATA_DIR.exists():
    shutil.rmtree(DATA_DIR)
SOURCE_DIR.mkdir(parents=True, exist_ok=True)

settings = Settings(
    data_dir=DATA_DIR,
    source_roots={"demo": SOURCE_DIR},
    poll_interval=0.1,
    interrupt_timeout=0.5,
    terminate_timeout=0.5,
)
training = ControlledTraining(settings)
app = create_app(settings, training=training)


@app.post("/__test__/results/{experiment_id}")
def write_result(experiment_id: str, payload: dict[str, Any]) -> dict[str, bool]:
    directory = DATA_DIR / "runs" / experiment_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "best_result.json").write_text(json.dumps(payload), encoding="utf-8")
    history = payload.get("history")
    if isinstance(history, list) and history:
        lines = [
            json.dumps({"epoch": epoch + 1, **values}, ensure_ascii=False)
            for epoch, values in enumerate(history)
        ]
        (directory / "metrics.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    app.state.container.results.collect(experiment_id)
    return {"collected": True}


if __name__ == "__main__":
    port = int(os.environ.get("E2E_BACKEND_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", workers=1)
