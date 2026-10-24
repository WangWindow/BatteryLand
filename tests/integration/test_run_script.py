import json
import os
import signal
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/run.sh"
SERVICE = """#!/usr/bin/env python3
import json, os, subprocess, sys, time
from pathlib import Path
role = Path(sys.argv[0]).name
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
Path(os.environ['LAUNCHER_RECORDS'], role + '.json').write_text(json.dumps({
    'pid': os.getpid(), 'child': child.pid, 'cwd': os.getcwd(), 'args': sys.argv[1:],
    'training': os.environ.get('BATTERYLAND_TRAINING_PYTHON'),
    'data': os.environ.get('BATTERYLAND_DATA_DIR'),
    'proxy': os.environ.get('VITE_PROXY_TARGET'),
    'sources': os.environ.get('BATTERYLAND_SOURCE_ROOTS'),
}))
if os.environ.get('FAIL_ROLE') == role:
    time.sleep(0.2)
    sys.exit(7)
time.sleep(60)
"""


@pytest.fixture
def project(tmp_path):
    root = tmp_path / "project with spaces"
    for directory in (
        "scripts",
        ".venv/bin",
        "src/batteryland_ui/node_modules/.bin",
        "tools",
        "records",
    ):
        (root / directory).mkdir(parents=True)
    (root / "scripts/run.sh").write_bytes(SCRIPT.read_bytes())
    for path in (root / ".venv/bin/python", root / "tools/bun"):
        path.write_text(SERVICE)
        path.chmod(0o755)
    (root / "src/batteryland_ui/node_modules/.bin/vite").touch()
    return root


def running(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except FileNotFoundError:
        return False


def records(root):
    return [json.loads(path.read_text()) for path in (root / "records").glob("*.json")]


@contextmanager
def launch(root, cwd, overrides=None):
    environment = os.environ | {
        "PATH": str(root / "tools") + os.pathsep + os.environ["PATH"],
        "LAUNCHER_RECORDS": str(root / "records"),
        "BATTERYLAND_BACKEND_PORT": "8123",
        "BATTERYLAND_UI_PORT": "5123",
        "BATTERYLAND_SOURCE_ROOTS": '{"demo":"/example/source"}',
    }
    environment.pop("BATTERYLAND_DATA_DIR", None)
    environment.pop("BATTERYLAND_TRAINING_PYTHON", None)
    environment.update(overrides or {})
    process = subprocess.Popen(
        ["bash", str(root / "scripts/run.sh")],
        cwd=cwd,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    try:
        yield process
    finally:
        for pgid in [process.pid, *(value["pid"] for value in records(root))]:
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=5)
        process.stdout.close()


@pytest.mark.parametrize(
    "overrides",
    [
        {},
        {
            "BATTERYLAND_DATA_DIR": "custom data",
            "BATTERYLAND_TRAINING_PYTHON": "other environment/bin/python",
        },
    ],
)
def test_launcher_uses_project_paths_and_cleans_service_groups_on_interrupt(
    project, tmp_path, overrides
):
    with launch(project, tmp_path, overrides) as process:
        deadline = time.monotonic() + 3
        while len(records(project)) < 2 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert len(records(project)) == 2, "Both backend and frontend must start"
        backend = json.loads((project / "records/python.json").read_text())
        frontend = json.loads((project / "records/bun.json").read_text())
        assert backend["cwd"] == str(project)
        assert frontend["cwd"] == str(project / "src/batteryland_ui")
        assert backend["data"] == str(project / overrides.get("BATTERYLAND_DATA_DIR", "var"))
        assert backend["training"] == overrides.get(
            "BATTERYLAND_TRAINING_PYTHON", str(project / ".venv-training/bin/python")
        )
        assert backend["sources"] == '{"demo":"/example/source"}'
        assert backend["args"][-2:] == ["--port", "8123"]
        assert frontend["proxy"] == "http://127.0.0.1:8123"
        assert "5123" in frontend["args"] and "--strictPort" in frontend["args"]
        process.send_signal(signal.SIGINT)
        process.wait(timeout=5)
        assert process.returncode == 130
        assert all(
            not running(value[key]) for value in records(project) for key in ("pid", "child")
        )


@pytest.mark.parametrize("role", ["python", "bun"])
def test_a_service_failure_is_propagated_and_stops_the_other(project, tmp_path, role):
    with launch(project, tmp_path, {"FAIL_ROLE": role}) as process:
        output, _ = process.communicate(timeout=4)
        assert process.returncode == 7, output
        assert len(records(project)) == 2
        assert all(
            not running(value[key]) for value in records(project) for key in ("pid", "child")
        )
