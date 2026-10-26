"""Opt-in acceptance against the unchanged provider and real standardized data."""

import json
import os
import re
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import httpx
import pytest
import yaml
from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from batteryland.config import Settings
from batteryland.scheduler.processes import ProcessSupervisor
from batteryland.scheduler.service import LocalScheduler
from tests.support import register_split

pytestmark = pytest.mark.training


@pytest.fixture
def training_settings(tmp_path, monkeypatch):
    for name in (
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "OPENBLAS_NUM_THREADS",
        "NUMEXPR_MAX_THREADS",
    ):
        monkeypatch.setenv(name, "2")
    monkeypatch.setenv("MPLBACKEND", "Agg")
    return Settings(
        data_dir=tmp_path / "runtime",
        source_roots={"battery-life": Path("/data/BatteryLife_Processed")},
        training_python=Settings.from_env().training_python,
        validation_secret="real-local-secret",
        auto_index_catalog=False,
    )


@contextmanager
def platform(settings):
    app = create_app(settings, start_monitor=False)
    with TestClient(app) as client:
        container = app.state.container
        scheduler = LocalScheduler(
            container.scheduler_state,
            container.validated_experiments,
            container.training_runs,
            container.results,
            container.artifacts,
            settings.data_dir,
        )
        yield client, container, scheduler


def validate_and_submit(client, name, config_text, split_id, split_version):
    validation = client.post(
        "/api/v1/training/validation",
        json={
            "config_text": config_text,
            "split_id": split_id,
            "split_version": split_version,
        },
    )
    assert validation.status_code == 200, validation.text
    validated = validation.json()["data"]
    assert validated["valid"]
    assert validated["execution_supported"]

    created = client.post(
        "/api/v1/validated-experiments",
        json={
            "name": name,
            "config_text": config_text,
            "split_text": validated["split_text"],
            "split_id": split_id,
            "split_version": split_version,
            "receipt": validated["receipt"],
        },
    )
    assert created.status_code == 201, created.text
    identity = created.json()["data"]["id"]
    submitted = client.post(f"/api/v1/validated-experiments/{identity}/submit")
    assert submitted.status_code == 202, submitted.text
    return identity


def run_directory(container, identity):
    return container.settings.data_dir / "experiments" / identity / "inputs"


def process_receipt(container, identity):
    path = run_directory(container, identity) / "process-receipt.json"
    return json.loads(path.read_text()) if path.is_file() else None


def diagnostics(container, identity):
    receipt = process_receipt(container, identity)
    if not receipt:
        return "Training process receipt has not been written"
    directory = Path(receipt["directory"])
    console = directory / "console.log"
    return console.read_text(errors="replace")[-8000:] if console.exists() else str(receipt)


def wait_terminal(client, container, scheduler, identity, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        scheduler.tick()
        response = client.get(f"/api/v1/validated-experiments/{identity}")
        assert response.status_code == 200, response.text
        value = response.json()["data"]
        if value["state"] in {
            "succeeded",
            "failed",
            "stopped",
            "cancelled",
            "needs_reconciliation",
        }:
            return value
        time.sleep(0.2)
    raise AssertionError(diagnostics(container, identity))


def calce_input(settings, device, epochs=1, early_stopping=True):
    split_text = (settings.provider_root / "datasets/batteryLife/data_split/CALCE.json").read_text()
    split = json.loads(split_text)
    assert split["dataset"] == "CALCE"
    assert {name: len(split[name]) for name in ("train", "val", "test")} == {
        "train": 9,
        "val": 2,
        "test": 2,
    }
    config = yaml.safe_load((settings.provider_root / "configs/calce_seed2021.yaml").read_text())
    config["mate"].update(
        device=device,
        epochs=epochs,
        experiment=f"real-calce-{device.replace(':', '-')}",
    )
    config["datafactory"]["params"]["num_workers"] = 0
    if not early_stopping:
        for component in config.get("others", []):
            if component.get("type") == "earlystop":
                component["params"]["enable"] = False
    config_text = yaml.safe_dump(config, allow_unicode=True, sort_keys=False)
    return config_text, split


@pytest.mark.gpu
def test_real_catalog_and_mytask_use_the_training_environment(training_settings):
    split = json.loads(
        (training_settings.provider_root / "datasets/batteryLife/data_split/CALCE.json").read_text()
    )
    registered = register_split(
        training_settings,
        split["dataset"],
        tuple(name for partition in ("train", "val", "test") for name in split[partition]),
        {partition: tuple(split[partition]) for partition in ("train", "val", "test")},
        root_alias="battery-life",
    )
    config_text = yaml.safe_dump(
        {
            "mate": {"seed": 42, "device": "auto", "experiment": "real-mytask"},
            "task": {"type": "MyTask"},
            "hook": [{"type": "PrintStart"}, {"type": "PrintEnd"}],
            "datafactory": {
                "type": "BatteryLandBatteryLifeDatasetFactory",
                "params": {"dataset": split["dataset"], "num_workers": 0},
            },
        },
        allow_unicode=True,
        sort_keys=False,
    )

    with platform(training_settings) as (client, container, scheduler):
        schema = client.get("/api/v1/components/model/cpmlp/schema")
        assert schema.status_code == 200, schema.text
        assert "d_model" in schema.json()["data"]["required"]

        identity = validate_and_submit(
            client,
            "real-mytask",
            config_text,
            registered["split"]["id"],
            registered["split"]["version"],
        )
        result = wait_terminal(client, container, scheduler, identity)
        assert result["state"] == "succeeded", diagnostics(container, identity)

        process = process_receipt(container, identity)
        assert process is not None
        assert process["runtime"]["prefix"] != sys.prefix
        assert process["runtime"]["executable"] == str(training_settings.training_python)
        directory = Path(process["directory"])
        assert json.loads((directory / "status.json").read_text())["status"] == "completed"
        console = (directory / "console.log").read_text()
        assert "开始" in console
        assert "结束" in console
        assert (
            client.get(f"/api/v1/experiments/{identity}/results").json()["data"]["available"]
            is False
        )
        assert "torch" not in sys.modules


@pytest.mark.gpu
def test_real_calce_single_epoch_results_and_artifacts(training_settings):
    config_text, split = calce_input(training_settings, "cuda:0")
    registered = register_split(
        training_settings,
        split["dataset"],
        tuple(name for partition in ("train", "val", "test") for name in split[partition]),
        {partition: tuple(split[partition]) for partition in ("train", "val", "test")},
        root_alias="battery-life",
    )
    with platform(training_settings) as (client, container, scheduler):
        identity = validate_and_submit(
            client,
            "real-calce-cuda-0",
            config_text,
            registered["split"]["id"],
            registered["split"]["version"],
        )
        try:
            result = wait_terminal(client, container, scheduler, identity)
            assert result["state"] == "succeeded", diagnostics(container, identity)
            process = process_receipt(container, identity)
            assert process is not None
            directory = Path(process["directory"])

            saved_config = yaml.safe_load((directory / "config.yaml").read_text())
            assert saved_config["mate"]["device"] == "cuda:0"
            console = (directory / "console.log").read_text()
            reported = re.search(r"Training started on (cuda(?::\d+)?): ", console)
            assert reported is not None and reported.group(1) in {"cuda", "cuda:0"}

            raw = json.loads((directory / "best_result.json").read_text())
            imported = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
            assert imported["available"] and imported["best_epoch"] == 1
            assert imported["version"] == 1 and len(imported["predictions"]) == 2
            for metric in imported["metrics"]:
                assert metric["value"] == pytest.approx(raw[metric["stage"]][metric["name"]])

            mape = next(
                item
                for item in imported["metrics"]
                if item["stage"] == "test" and item["name"] == "mape"
            )
            assert mape["unit"] == "ratio" and mape["granularity"] == "window"
            acc15 = next(
                item
                for item in imported["metrics"]
                if item["stage"] == "test" and item["name"] == "acc15"
            )
            assert acc15["unit"] == "percent"

            source = imported["sources"][0]
            source_artifact = client.get(
                f"/api/v1/artifacts/{source['source_artifact_id']}/download"
            )
            assert source_artifact.status_code == 200
            assert source_artifact.json() == raw

            artifacts = client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
            assert any(
                item["kind"] == "checkpoint"
                and item["name"] == "model.safetensors"
                and item["experiment_id"] == identity
                and item["size"] > 0
                for item in artifacts
            )
            metrics = client.get(f"/api/v1/experiments/{identity}/metrics").json()["data"]
            assert metrics["total"] > 0

            for kind in ("metric_bar", "epoch_line", "prediction_scatter"):
                chart = client.post(
                    "/api/v1/charts",
                    json={
                        "chart_type": kind,
                        "experiment_ids": [identity],
                        "stage": "test",
                        "metric": "mape",
                    },
                )
                assert chart.status_code == 200 and chart.json()["data"]["charts"]
        finally:
            current = client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]
            if current["state"] in {"running", "starting", "stopping"}:
                client.post(f"/api/v1/experiments/{identity}/stop")
                wait_terminal(client, container, scheduler, identity, timeout=30)


@pytest.mark.gpu
def test_real_training_survives_api_restart_and_stops_owned_group(training_settings):
    config_text, split = calce_input(
        training_settings, "cuda:0", epochs=100_000, early_stopping=False
    )
    registered = register_split(
        training_settings,
        split["dataset"],
        tuple(name for partition in ("train", "val", "test") for name in split[partition]),
        {partition: tuple(split[partition]) for partition in ("train", "val", "test")},
        root_alias="battery-life",
    )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    environment = os.environ | {
        "BATTERYLAND_SOURCE_ROOTS": json.dumps(
            {key: str(path) for key, path in training_settings.source_roots.items()}
        ),
        "BATTERYLAND_PROVIDER_ROOT": str(training_settings.provider_root),
        "BATTERYLAND_TRAINING_PYTHON": str(training_settings.training_python),
        "BATTERYLAND_VALIDATION_SECRET": training_settings.validation_secret,
        "BATTERYLAND_AUTO_INDEX_CATALOG": "0",
    }
    log = training_settings.data_dir.parent / "api-console.log"
    receipt_path: Path | None = None
    supervisor = ProcessSupervisor()
    servers = []
    identity = None

    def stored_receipt():
        if receipt_path is None or not receipt_path.is_file():
            return None
        return json.loads(receipt_path.read_text())

    def start_server():
        with log.open("ab") as output:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "batteryland.main",
                    "serve",
                    "--data-dir",
                    str(training_settings.data_dir),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                env=environment,
                stdout=output,
                stderr=output,
                start_new_session=True,
            )
        servers.append(process)
        with httpx.Client(base_url=base_url, timeout=1, trust_env=False) as client:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                assert process.poll() is None, log.read_text()[-5000:]
                try:
                    if client.get("/api/v1/experiments").status_code == 200:
                        return process
                except httpx.TransportError:
                    pass
                time.sleep(0.1)
        raise AssertionError(log.read_text()[-5000:])

    try:
        first_server = start_server()
        with httpx.Client(base_url=base_url, timeout=60, trust_env=False) as client:
            identity = validate_and_submit(
                client,
                "restart-stop-calce",
                config_text,
                registered["split"]["id"],
                registered["split"]["version"],
            )
            receipt_path = (
                training_settings.data_dir
                / "experiments"
                / identity
                / "inputs"
                / "process-receipt.json"
            )
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                receipt = stored_receipt()
                if receipt:
                    directory = Path(receipt["directory"])
                    console = directory / "console.log"
                    if console.exists() and re.search(
                        r"Training started on cuda(?::\d+)?: ", console.read_text()
                    ):
                        break
                state = client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]
                assert state["state"] in {"queued", "starting", "running"}, log.read_text()[-5000:]
                time.sleep(0.2)
            else:
                raise AssertionError(log.read_text()[-5000:])
            original = stored_receipt()
            assert original is not None

        first_server.terminate()
        first_server.wait(timeout=20)
        assert supervisor.observe(original)["alive"]

        start_server()
        with httpx.Client(base_url=base_url, timeout=10, trust_env=False) as client:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                after = stored_receipt()
                current = client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]
                if current["state"] == "running":
                    break
                assert current["state"] in {"starting", "stopping"}, current
                time.sleep(0.2)
            assert current["state"] == "running", current
            assert after is not None
            assert after["intent_id"] == original["intent_id"]
            assert after["pid"] == original["pid"]

            stopped = client.post(f"/api/v1/experiments/{identity}/stop")
            assert stopped.status_code == 202, stopped.text
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                result = client.get(f"/api/v1/validated-experiments/{identity}").json()["data"]
                if result["state"] != "stopping":
                    break
                time.sleep(0.2)
            assert result["state"] == "stopped", result
            assert supervisor.observe(after)["alive"] is False
    finally:
        for server in servers:
            if server.poll() is None:
                server.terminate()
                server.wait(timeout=20)
        receipt = stored_receipt()
        if receipt and supervisor.observe(receipt)["alive"]:
            supervisor.signal(receipt, "kill")
