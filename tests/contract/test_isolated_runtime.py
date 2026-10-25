import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.training.gateway import PROVIDER_COMMIT, DeeplatformGateway


@pytest.fixture
def isolated_gateway(settings, monkeypatch, tmp_path):
    python = tmp_path / "training environment" / "bin" / "python"
    monkeypatch.setenv("BATTERYLAND_TRAINING_PYTHON", str(python))
    gateway = DeeplatformGateway(Settings.from_env(settings.data_dir))
    monkeypatch.setattr(gateway, "identity", lambda: PROVIDER_COMMIT)
    return gateway, python


def identity(python):
    return {
        "executable": str(python),
        "prefix": str(python.parent.parent),
        "python_version": sys.version.split()[0],
    }


def bridge_response(command, runtime, data=None):
    response = (
        runtime
        if "-c" in command
        else {
            "ok": True,
            "data": data if data is not None else {"scope": "model"},
            "runtime": runtime,
        }
    )
    return subprocess.CompletedProcess(command, 0, json.dumps(response), "")


def test_dynamic_control_uses_selected_training_environment(isolated_gateway, monkeypatch):
    gateway, python = isolated_gateway
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return bridge_response(command, identity(python))

    monkeypatch.setattr(subprocess, "run", run)
    assert gateway.schema("model", "cpmlp") == {"scope": "model"}
    assert commands and all(command[0] == str(python) for command in commands)


def test_training_environment_does_not_inherit_api_activation(isolated_gateway, monkeypatch):
    gateway, python = isolated_gateway
    monkeypatch.setenv("VIRTUAL_ENV", "/api-environment")
    monkeypatch.setenv("PYTHONHOME", "/api-python-home")
    environments = []

    def run(command, **kwargs):
        if "-c" not in command:
            environments.append(kwargs["env"])
        return bridge_response(command, identity(python))

    monkeypatch.setattr(subprocess, "run", run)
    gateway.schema("model", "cpmlp")
    assert environments[0]["VIRTUAL_ENV"] == str(python.parent.parent)
    assert environments[0]["PATH"].split(os.pathsep)[0] == str(python.parent)
    assert "PYTHONHOME" not in environments[0]


def prepared(python, root):
    return {
        "provider_commit": PROVIDER_COMMIT,
        "directory": str(root / "runs" / "test"),
        "directory_ref": "runs/test",
        "experiment_id": "test",
        "intent_id": "intent",
        "input_manifest_sha256": "manifest",
        "provider_config_sha256": "config",
        "requested_device": "cpu",
        "runtime": identity(python),
    }


def test_spawn_uses_the_same_training_identity(isolated_gateway, monkeypatch, tmp_path):
    gateway, python = isolated_gateway
    commands = []
    monkeypatch.setattr(
        subprocess, "run", lambda command, **kw: bridge_response(command, identity(python))
    )

    def start(command, directory, experiment_id, **kwargs):
        commands.append(command)
        return {"experiment_id": experiment_id}

    monkeypatch.setattr(gateway.supervisor, "start", start)
    receipt = gateway.spawn(prepared(python, tmp_path))
    assert commands[0][0] == str(python)
    assert receipt["runtime"] == identity(python)


def test_spawn_rejects_a_preparation_from_another_environment(
    isolated_gateway, monkeypatch, tmp_path
):
    gateway, python = isolated_gateway
    monkeypatch.setattr(
        subprocess, "run", lambda command, **kw: bridge_response(command, identity(python))
    )
    starts = []
    monkeypatch.setattr(gateway.supervisor, "start", lambda *a, **kw: starts.append(a) or {})
    old = prepared(tmp_path / "old" / "bin" / "python", tmp_path)
    with pytest.raises(DomainError, match="environment"):
        gateway.spawn(old)
    assert starts == []


def test_missing_training_interpreter_is_reported_without_fallback(isolated_gateway, monkeypatch):
    gateway, python = isolated_gateway
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        if command[0] == str(python):
            raise FileNotFoundError("missing training environment")
        return bridge_response(command, identity(Path(sys.executable)))

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(DomainError) as error:
        gateway.schema("model", "cpmlp")
    assert error.value.symbol == "provider_unavailable"
    assert commands and all(command[0] == str(python) for command in commands)


def test_control_rejects_worker_identity_that_differs_from_selected_runtime(
    isolated_gateway, monkeypatch
):
    gateway, python = isolated_gateway

    def run(command, **kwargs):
        runtime = identity(python)
        if "-c" not in command:
            runtime["prefix"] = "/unexpected-environment"
        return bridge_response(command, runtime)

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(DomainError, match="environment"):
        gateway.schema("model", "cpmlp")


def test_static_operations_work_without_a_training_environment(settings, monkeypatch, tmp_path):
    monkeypatch.setenv("BATTERYLAND_TRAINING_PYTHON", str(tmp_path / "missing" / "bin" / "python"))
    gateway = DeeplatformGateway(Settings.from_env(settings.data_dir))
    assert any(item["type"] == "cpmlp" for item in gateway.components())
    uploaded = gateway.upload(
        "model",
        "independent.py",
        b"from core.register.registryhub import R\n@R.model.register('Independent')\nclass Model: pass\n",
    )
    assert uploaded["activation"] == "next_experiment"
    assert any(item["type"] == "independent" for item in gateway.components())
    assert "torch" not in sys.modules


def test_relative_interpreter_preserves_its_virtualenv_symlink(settings, monkeypatch, tmp_path):
    python = tmp_path / "training" / "bin" / "python"
    python.parent.mkdir(parents=True)
    python.symlink_to(sys.executable)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("BATTERYLAND_TRAINING_PYTHON", "training/bin/python")
    actual = Settings.from_env(settings.data_dir).training_python
    assert actual == python
    assert actual != python.resolve()


def test_real_static_bridge_reports_its_api_environment(settings):
    bridge = Path("src/batteryland/training/bridge.py").resolve()
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


def test_preparation_rejects_an_inconsistent_inner_runtime(isolated_gateway, monkeypatch, tmp_path):
    gateway, python = isolated_gateway
    config_path = tmp_path / "config.yaml"
    config_path.write_text("mate: {}")
    snapshot = {
        "provider_commit": PROVIDER_COMMIT,
        "native_config": {"mate": {"device": "cpu"}},
        "resources": {},
        "components": [],
    }
    materialized = {
        "snapshot": snapshot,
        "experiment_id": "test",
        "intent_id": "intent",
        "config_path": str(config_path),
        "input_manifest_sha256": "manifest",
    }

    def run(command, **kwargs):
        runtime = identity(python)
        data = []
        if "-c" not in command:
            operation = json.loads(kwargs["input"])["operation"]
            if operation == "prepare":
                data = {
                    "directory": str(gateway.settings.data_dir / "runs/test"),
                    "config_sha256": "config",
                    "experiment_id": "test",
                    "runtime": runtime | {"prefix": "/wrong-environment"},
                }
            elif operation == "inspect":
                runtime = {
                    "executable": sys.executable,
                    "prefix": sys.prefix,
                    "python_version": sys.version.split()[0],
                }
        return bridge_response(command, runtime, data)

    monkeypatch.setattr(subprocess, "run", run)
    with pytest.raises(DomainError, match="environment"):
        gateway.prepare(materialized)
