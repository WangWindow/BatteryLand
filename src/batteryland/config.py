"""Deployment settings shared by the API and local maintenance commands."""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PROVIDER_ROOT = Path(__file__).resolve().parents[1] / "deeplatform"
DEFAULT_TRAINING_PYTHON = Path(__file__).resolve().parents[2] / ".venv-training/bin/python"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    source_roots: dict[str, Path] = field(default_factory=dict)
    provider_root: Path = DEFAULT_PROVIDER_ROOT
    training_python: Path = DEFAULT_TRAINING_PYTHON
    poll_interval: float = 0.2
    interrupt_timeout: float = 10.0
    terminate_timeout: float = 5.0
    component_limit: int = 1024 * 1024
    checkpoint_limit: int = 1024 * 1024 * 1024

    @classmethod
    def from_env(cls, data_dir: Path | None = None) -> Settings:
        roots = json.loads(os.environ.get("BATTERYLAND_SOURCE_ROOTS", "{}"))
        if not isinstance(roots, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for key, value in roots.items()
        ):
            raise ValueError("BATTERYLAND_SOURCE_ROOTS must map aliases to directory paths")
        provider = os.environ.get("BATTERYLAND_PROVIDER_ROOT")
        training_python = os.environ.get("BATTERYLAND_TRAINING_PYTHON")
        return cls(
            data_dir=(data_dir or Path(os.environ.get("BATTERYLAND_DATA_DIR", "var"))).resolve(),
            source_roots={key: Path(value).resolve() for key, value in roots.items()},
            provider_root=Path(provider).resolve() if provider else DEFAULT_PROVIDER_ROOT,
            training_python=(
                Path(os.path.abspath(os.path.expanduser(training_python)))
                if training_python
                else DEFAULT_TRAINING_PYTHON
            ),
        )
