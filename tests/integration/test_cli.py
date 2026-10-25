import json
import os
import subprocess
import sys

from batteryland.config import Settings
from batteryland.container import Container


def command(settings, *arguments):
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "batteryland.main",
            *arguments,
            "--data-dir",
            str(settings.data_dir),
        ],
        env=os.environ
        | {
            "BATTERYLAND_SOURCE_ROOTS": json.dumps(
                {key: str(path) for key, path in settings.source_roots.items()}
            )
        },
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_cli_init_and_idempotent_bundled_import(settings: Settings):
    first = command(settings, "init")
    assert first.returncode == 0 and json.loads(first.stdout)["initialized"]
    assert command(settings, "init").returncode == 0
    container = Container(settings)
    source = container.resources.create_source("bundled", "demo")
    container.close()
    imported = command(settings, "import-bundled", "--source-id", source["id"])
    assert imported.returncode == 0, imported.stderr
    summary = json.loads(imported.stdout)
    assert summary["batteries"]["imported"] == 1001
    assert summary["splits"]["imported"] == 23
    again = command(settings, "import-bundled", "--source-id", source["id"])
    assert again.returncode == 0, again.stderr
    assert json.loads(again.stdout)["batteries"]["existing"] == 1001
    assert json.loads(again.stdout)["splits"]["existing"] == 23


def test_cli_reconcile_requires_a_real_execution(settings: Settings):
    result = command(
        settings, "reconcile", "--experiment-id", "00000000-0000-0000-0000-000000000000"
    )
    assert result.returncode == 1 and json.loads(result.stderr)["error"] == "not_found"
