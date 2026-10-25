"""Verify one FastAPI process owns validation, scheduling and data APIs."""

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def unused_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_ready(url: str, timeout: float = 20) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            response = httpx.get(url, timeout=2)
            if response.status_code == 200:
                return response.json()["data"]
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"Service did not become ready: {url}")


def test_single_backend_process_exposes_scheduler_and_catalog(tmp_path):
    port = unused_port()
    data_dir = tmp_path / "core"
    environment = os.environ | {
        "BATTERYLAND_DATA_DIR": str(data_dir),
        "BATTERYLAND_VALIDATION_SECRET": "integration-secret",
        "BATTERYLAND_SERVICE_TOKEN": "integration-token",
        "BATTERYLAND_AUTO_INDEX_CATALOG": "0",
        "BATTERYLAND_SOURCE_ROOTS": "{}",
    }
    output = (tmp_path / "backend.log").open("wb")
    process = None
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "batteryland.main",
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            cwd=ROOT,
            env=environment,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        base = f"http://127.0.0.1:{port}"
        response = wait_ready(base + "/api/v1/health")
        assert response["service"] == "data"
        catalog = httpx.get(base + "/api/v1/components", timeout=15)
        assert catalog.status_code == 200, catalog.text
        assert any(item["scope"] == "model" for item in catalog.json()["data"])
        blocked = httpx.post(
            base + "/api/v1/experiments",
            json={"name": "unvalidated", "native_config": {"mate": {"device": "cuda:0"}}},
            timeout=5,
        )
        assert blocked.status_code == 404
        status = httpx.get(base + "/api/v1/scheduler/status", timeout=2).json()["data"]
        assert status["enabled"] is True
        nodes_url = base + "/api/v1/scheduler/resources"
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            nodes = httpx.get(nodes_url, timeout=2).json()["data"]
            if nodes:
                break
            time.sleep(0.1)
        assert nodes and nodes[0]["resources"]["memory_total"] > 0
    finally:
        if process is not None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        output.close()
