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

from batteryland.config import Settings
from batteryland.infrastructure.persistence.database import Database
from batteryland.infrastructure.scheduling import ProcessSupervisor
from batteryland.interfaces.api.app import create_app

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
    )


@contextmanager
def platform(settings):
    app = create_app(settings, start_monitor=False)
    with TestClient(app) as client:
        yield client, app.state.container


def submit(client, config, bindings=None):
    response = client.post(
        "/api/v1/experiments",
        json={
            "name": config["mate"]["experiment"],
            "native_config": config,
            "bindings": bindings or {},
        },
    )
    response.raise_for_status()
    identity = response.json()["data"]["id"]
    queued = client.post("/api/v1/queue/submissions", json={"experiment_ids": [identity]})
    assert queued.status_code == 202, queued.text
    return identity


def execution(container, identity):
    with container.database.unit_of_work() as unit:
        return unit.experiments.execution(identity)


def diagnostics(container, identity):
    value = execution(container, identity)
    directory = (value.get("prepared") or {}).get("directory")
    if not directory:
        return str(value)
    path = Path(directory) / "console.log"
    return (path.read_text(errors="replace")[-8000:] if path.exists() else "No console log") + str(
        value["error"]
    )


def gpu_processes():
    result = subprocess.run(
        ["nvidia-smi", "--query-compute-apps=pid,gpu_uuid", "--format=csv,noheader"],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 0, result.stderr
    return {
        int(pid.strip()): uuid.strip()
        for line in result.stdout.splitlines()
        if "," in line
        for pid, uuid in [line.split(",", 1)]
    }


def wait_terminal(client, container, identity, *, gpu_evidence=None, timeout=240):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        container.execution.tick()
        if gpu_evidence is not None:
            receipt = execution(container, identity)["receipt"]
            if receipt and (uuid := gpu_processes().get(receipt["pid"])):
                gpu_evidence.add((receipt["pid"], uuid))
        value = client.get(f"/api/v1/experiments/{identity}").json()["data"]
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


def calce_input(container, settings, device, epochs=1):
    source = container.resources.create_source("CALCE acceptance", "battery-life")
    content = (settings.provider_root / "datasets/batteryLife/data_split/CALCE.json").read_bytes()
    native_split = json.loads(content)
    names = [name for group in ("train", "val", "test") for name in native_split[group]]
    # Register precisely this built-in dataset, without importing unrelated sources.
    imported = container.resources.import_batteries(
        source["id"], [{"file_name": name, "relative_key": f"CALCE/{name}"} for name in names]
    )
    assert imported["imported"] == 13
    split = container.splits.import_document(source["id"], content)
    assert split["counts"] == {"train": 9, "val": 2, "test": 2}
    config = yaml.safe_load((settings.provider_root / "configs/calce_seed2021.yaml").read_text())
    config["mate"].update(
        device=device, epochs=epochs, experiment=f"real-calce-{device.replace(':', '-')}"
    )
    config["datafactory"]["params"]["num_workers"] = 0
    return config, {"split": {"id": split["id"], "version": 1}}


def test_real_catalog_and_mytask_share_the_api_environment(training_settings):
    with platform(training_settings) as (client, container):
        schema = client.get("/api/v1/components/model/cpmlp/schema")
        assert schema.status_code == 200, schema.text
        assert "d_model" in schema.json()["data"]["required"]
        config = {
            "mate": {"seed": 42, "device": "cpu", "experiment": "real-mytask"},
            "task": {"type": "MyTask"},
            "hook": [{"type": "PrintStart"}, {"type": "PrintEnd"}],
        }
        identity = submit(client, config)
        result = wait_terminal(client, container, identity)
        assert result["state"] == "succeeded", diagnostics(container, identity)
        prepared = execution(container, identity)["prepared"]
        assert prepared["runtime"]["prefix"] == sys.prefix
        assert prepared["runtime"]["executable"] == sys.executable
        directory = Path(prepared["directory"])
        assert json.loads((directory / "status.json").read_text())["status"] == "completed"
        assert "开始" in (directory / "console.log").read_text()
        assert "结束" in (directory / "console.log").read_text()
        assert (
            client.get(f"/api/v1/experiments/{identity}/results").json()["data"]["available"]
            is False
        )
        assert "torch" not in sys.modules
        print(f"\nReal MyTask passed: {identity}")


@pytest.mark.parametrize("device", ["cpu", pytest.param("cuda:0", marks=pytest.mark.gpu)])
def test_real_calce_single_epoch_results_and_artifacts(training_settings, device):
    evidence = set() if device.startswith("cuda") else None
    with platform(training_settings) as (client, container):
        config, bindings = calce_input(container, training_settings, device)
        identity = submit(client, config, bindings)
        try:
            result = wait_terminal(client, container, identity, gpu_evidence=evidence)
            assert result["state"] == "succeeded", diagnostics(container, identity)
            receipt = execution(container, identity)
            directory = Path(receipt["prepared"]["directory"])
            saved_config = yaml.safe_load((directory / "config.yaml").read_text())
            assert saved_config["mate"]["device"] == device
            console = (directory / "console.log").read_text()
            reported = re.search(r"Training started on (cpu|cuda(?::\d+)?): ", console)
            assert reported is not None
            assert reported.group(1) in ({"cuda", "cuda:0"} if device == "cuda:0" else {"cpu"})
            if evidence is not None:
                expected = subprocess.run(
                    ["nvidia-smi", "--id=0", "--query-gpu=uuid", "--format=csv,noheader"],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()
                assert (receipt["receipt"]["pid"], expected) in evidence
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
            assert (
                next(
                    item
                    for item in imported["metrics"]
                    if item["stage"] == "test" and item["name"] == "acc15"
                )["unit"]
                == "percent"
            )
            source = imported["sources"][0]
            assert (
                client.get(f"/api/v1/artifacts/{source['source_artifact_id']}/download").json()
                == raw
            )
            artifacts = client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
            assert any(
                item["kind"] == "checkpoint" and item["component_id"] and item["size"]
                for item in artifacts
            )
            assert client.get(f"/api/v1/experiments/{identity}/metrics").json()["data"]["total"] > 0
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
            container.results.collect(identity)
            assert (
                client.get(f"/api/v1/experiments/{identity}/results").json()["data"]["version"] == 1
            )
            assert result["effective_device"] is None
            print(
                f"\nReal CALCE {device} passed: experiment={identity}, metrics={len(imported['metrics'])}, predictions=2, gpu_evidence={evidence}"
            )
        finally:
            with container.database.unit_of_work() as unit:
                current = unit.experiments.get(identity)
            if current["state"] in {"running", "starting", "stopping"}:
                client.post(f"/api/v1/experiments/{identity}/stop")
                wait_terminal(client, container, identity, timeout=30)


def test_real_training_survives_api_restart_and_stops_owned_group(training_settings):
    with platform(training_settings) as (_, container):
        config, bindings = calce_input(container, training_settings, "cpu", epochs=1000)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base_url = f"http://127.0.0.1:{port}"
    environment = os.environ | {
        "BATTERYLAND_SOURCE_ROOTS": json.dumps(
            {key: str(path) for key, path in training_settings.source_roots.items()}
        ),
        "BATTERYLAND_PROVIDER_ROOT": str(training_settings.provider_root),
    }
    log = training_settings.data_dir.parent / "api-console.log"
    database = Database(training_settings.data_dir / "platform.sqlite")
    supervisor = ProcessSupervisor()
    servers = []
    identity = None

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

    def stored_execution():
        with database.unit_of_work() as unit:
            return unit.experiments.execution(identity)

    try:
        first_server = start_server()
        with httpx.Client(base_url=base_url, timeout=60, trust_env=False) as client:
            identity = submit(client, config, bindings)
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                value = stored_execution()
                directory = (value["prepared"] or {}).get("directory")
                console = Path(directory) / "console.log" if directory else None
                if (
                    console
                    and console.exists()
                    and "Training started on cpu:" in console.read_text()
                ):
                    break
                state = client.get(f"/api/v1/experiments/{identity}").json()["data"]["state"]
                assert state in {"queued", "starting", "running"}, log.read_text()[-5000:]
                time.sleep(0.2)
            else:
                raise AssertionError(log.read_text()[-5000:])
            original = stored_execution()
        first_server.terminate()
        first_server.wait(timeout=20)
        assert supervisor.observe(original["receipt"])["alive"]
        start_server()
        with httpx.Client(base_url=base_url, timeout=10, trust_env=False) as client:
            after = stored_execution()
            assert after["intent_id"] == original["intent_id"]
            assert after["receipt"]["pid"] == original["receipt"]["pid"]
            assert (
                client.get(f"/api/v1/experiments/{identity}").json()["data"]["state"] == "running"
            )
            assert (
                client.post(f"/api/v1/experiments/{identity}/stop").json()["data"]["state"]
                == "stopping"
            )
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                result = client.get(f"/api/v1/experiments/{identity}").json()["data"]
                if result["state"] != "stopping":
                    break
                time.sleep(0.2)
            assert result["state"] == "stopped", result
            assert supervisor.observe(after["receipt"])["alive"] is False
            print(
                f"\nReal HTTP restart/stop passed: experiment={identity}, same_pid={after['receipt']['pid']}"
            )
    finally:
        for server in servers:
            if server.poll() is None:
                server.terminate()
                server.wait(timeout=20)
        if identity:
            receipt = stored_execution()["receipt"]
            if receipt:
                supervisor.signal(receipt, "kill")
        database.engine.dispose()
