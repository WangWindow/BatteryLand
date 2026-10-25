import json
import os
import subprocess
import sys

from batteryland.config import Settings


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


def test_cli_init_is_idempotent_and_help_only_shows_current_commands(settings: Settings):
    first = command(settings, "init")
    assert first.returncode == 0 and json.loads(first.stdout)["initialized"]
    assert command(settings, "init").returncode == 0
    help_result = subprocess.run(
        [sys.executable, "-m", "batteryland.main", "--help"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert help_result.returncode == 0
    assert "init" in help_result.stdout
    assert "serve" in help_result.stdout
    assert "import-bundled" not in help_result.stdout
    assert "reconcile" not in help_result.stdout
