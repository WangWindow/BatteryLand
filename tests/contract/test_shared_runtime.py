import json
import subprocess
import sys
from pathlib import Path

import pytest

from batteryland.domain.errors import DomainError
from batteryland.infrastructure.training.gateway import PROVIDER_COMMIT, DeeplatformGateway


def test_control_uses_the_current_environment_without_extra_configuration(settings, monkeypatch):
    gateway = DeeplatformGateway(settings)
    monkeypatch.setattr(gateway, "identity", lambda: PROVIDER_COMMIT)
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(
            command,
            0,
            json.dumps(
                {
                    "ok": True,
                    "data": {"scope": "model"},
                    "runtime": {
                        "executable": sys.executable,
                        "prefix": sys.prefix,
                        "python_version": sys.version,
                    },
                }
            ),
            "",
        )

    monkeypatch.setattr(subprocess, "run", run)
    assert gateway.schema("model", "cpmlp") == {"scope": "model"}
    assert commands[0][0] == sys.executable
    assert Path(commands[0][0]).parent == Path(sys.executable).parent


def test_spawn_uses_current_interpreter_without_resolving_venv_symlink(settings, monkeypatch):
    gateway = DeeplatformGateway(settings)
    monkeypatch.setattr(gateway, "identity", lambda: PROVIDER_COMMIT)
    commands = []

    def start(command, directory, experiment_id, **kwargs):
        commands.append(command)
        return {"experiment_id": experiment_id}

    monkeypatch.setattr(gateway.supervisor, "start", start)
    prepared = {
        "provider_commit": PROVIDER_COMMIT,
        "directory": str(settings.data_dir / "runs" / "test"),
        "directory_ref": "runs/test",
        "experiment_id": "test",
        "intent_id": "intent",
        "input_manifest_sha256": "manifest",
        "provider_config_sha256": "config",
        "requested_device": "cpu",
    }
    assert gateway.spawn(prepared)["requested_device"] == "cpu"
    assert commands[0][0] == sys.executable


def test_control_rejects_a_different_environment(settings, monkeypatch):
    gateway = DeeplatformGateway(settings)
    monkeypatch.setattr(gateway, "identity", lambda: PROVIDER_COMMIT)

    def run(command, **kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            json.dumps(
                {
                    "ok": True,
                    "data": [],
                    "runtime": {
                        "executable": sys.executable,
                        "prefix": "/different-environment",
                        "python_version": sys.version,
                    },
                }
            ),
            "",
        )

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(DomainError, match="environment"):
        gateway.components()


def test_real_static_bridge_reports_its_virtual_environment(settings):
    bridge = Path("src/batteryland/infrastructure/training/bridge.py").resolve()
    request = {
        "operation": "inspect",
        "provider_root": str(settings.provider_root),
        "runtime_root": str(settings.data_dir / "plugins"),
    }
    result = subprocess.run(
        [sys.executable, str(bridge)],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    runtime = json.loads(result.stdout)["runtime"]
    assert runtime["prefix"] == sys.prefix and runtime["executable"] == sys.executable
