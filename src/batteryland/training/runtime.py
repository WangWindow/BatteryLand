"""Identify a configured Python environment without importing training libraries."""

import json
import os
import subprocess
import threading
from pathlib import Path

from batteryland.common.errors import DomainError

_PROBE = (
    "import json,sys; print(json.dumps({'executable':sys.executable,"
    "'prefix':sys.prefix,'python_version':sys.version.split()[0]}))"
)


class TrainingRuntime:
    def __init__(self, python: Path) -> None:
        # Resolving the symlink would bypass the virtual environment's pyvenv.cfg.
        self.python = Path(os.path.abspath(python.expanduser()))
        self._identity: dict[str, str] | None = None
        self._lock = threading.Lock()

    def identity(self) -> dict[str, str]:
        """Probe lazily so a missing training environment never blocks API startup."""
        with self._lock:
            if self._identity is None:
                environment = os.environ.copy()
                environment.pop("PYTHONHOME", None)
                environment.pop("VIRTUAL_ENV", None)
                try:
                    result = subprocess.run(
                        [str(self.python), "-I", "-c", _PROBE],
                        capture_output=True,
                        text=True,
                        timeout=10,
                        env=environment,
                    )
                    value = json.loads(result.stdout)
                    if (
                        result.returncode != 0
                        or not isinstance(value, dict)
                        or any(
                            not isinstance(value.get(key), str) or not value[key]
                            for key in ("executable", "prefix", "python_version")
                        )
                        or value["executable"] != str(self.python)
                    ):
                        raise ValueError("Invalid training runtime identity")
                except (OSError, ValueError, subprocess.SubprocessError) as exc:
                    raise DomainError(
                        "provider_unavailable",
                        "Training environment is unavailable; install it or configure "
                        "BATTERYLAND_TRAINING_PYTHON",
                    ) from exc
                self._identity = {
                    key: value[key] for key in ("executable", "prefix", "python_version")
                }
            return self._identity.copy()

    def environment(self, overrides: dict[str, str]) -> dict[str, str]:
        environment = os.environ | overrides
        environment.pop("PYTHONHOME", None)
        environment["VIRTUAL_ENV"] = self.identity()["prefix"]
        environment["PATH"] = str(self.python.parent) + os.pathsep + environment.get("PATH", "")
        return environment
