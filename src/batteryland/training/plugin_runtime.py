"""Initialize the project-owned component runtime from the pinned provider once."""

import fcntl
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

from batteryland.common.errors import DomainError

_MANIFEST = ".batteryland-runtime.json"
_LOCK = ".batteryland-runtime.lock"
_SOURCE_ROOTS = ("components", "task", "utils", "tools")
_DATA_FOLDERS = ("Life labels", "seen_unseen_labels", "data_split")


def _publish(source: Path, destination: Path) -> dict[str, str]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if destination.exists() or destination.is_symlink():
        return {"path": str(destination), "sha256": source_hash, "status": "preserved"}

    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
            with source.open("rb") as content:
                shutil.copyfileobj(content, stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o644)
        try:
            os.link(temporary, destination)
            status = "copied"
        except FileExistsError:
            status = "preserved"
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {"path": str(destination), "sha256": source_hash, "status": status}


def _publish_bytes(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        return
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o644)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            pass
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _seed_files(provider: Path, runtime: Path) -> list[dict[str, str]]:
    manifest: list[dict[str, str]] = []
    for folder in _SOURCE_ROOTS:
        source_root = provider / folder
        for source in sorted(source_root.rglob("*")):
            if not source.is_file() or source.suffix not in {".py", ".json"}:
                continue
            if folder == "utils" and source.relative_to(source_root) == Path(
                "sync_flat_symlinks.py"
            ):
                continue
            if any(
                part.startswith((".", "__pycache__"))
                for part in source.relative_to(source_root).parts
            ):
                continue
            manifest.append(_publish(source, runtime / source.relative_to(provider)))

    data_root = provider / "datasets/batteryLife"
    for folder in _DATA_FOLDERS:
        source_root = data_root / folder
        for source in sorted(source_root.glob("*.json")):
            manifest.append(
                _publish(source, runtime / "datasets/batteryLife" / folder / source.name)
            )

    local_seed = Path(__file__).with_name("runtime_seed")
    for relative in (
        Path("components/datafactory/batterylife_custom.py"),
        Path("utils/sync_flat_symlinks.py"),
    ):
        manifest.append(_publish(local_seed / relative, runtime / relative))

    for package in ("components", "task", "utils", "tools"):
        _publish_bytes(
            runtime / package / "__init__.py",
            b'"""Project-local DeepPlatform runtime package."""\n',
        )
    return manifest


def initialize_runtime(provider: Path, runtime: Path, provider_commit: str) -> None:
    runtime = runtime.resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    lock_path = runtime / _LOCK
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = runtime / _MANIFEST
        if marker.exists():
            try:
                recorded = json.loads(marker.read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise DomainError(
                    "needs_reconciliation", "Runtime seed manifest is invalid"
                ) from exc
            if recorded.get("provider_commit") != provider_commit:
                raise DomainError(
                    "integration_precondition_failed",
                    "Project-local runtime was seeded from a different provider revision",
                )
            return

        if not provider.is_dir():
            raise DomainError("provider_unavailable", "Training provider checkout is unavailable")
        copied = _seed_files(provider.resolve(), runtime)
        payload = json.dumps(
            {
                "schema_version": 1,
                "provider_commit": provider_commit,
                "files": copied,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
        temporary: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=runtime, delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o600)
            os.link(temporary, marker)
        except FileExistsError:
            pass
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
