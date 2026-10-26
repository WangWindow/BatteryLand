from pathlib import Path

from batteryland.common.errors import DomainError


def experiment_directory(experiments_root: Path, identity: str) -> Path:
    if not identity or identity in {".", ".."} or Path(identity).name != identity:
        raise DomainError("invalid_input", "Experiment identity is invalid")
    root = experiments_root.resolve()
    directory = root / identity
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise DomainError("invalid_input", "Experiment directory is unsafe")
    return directory


def storage_key(storage_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(storage_root.resolve()).as_posix()
    except ValueError as exc:
        raise DomainError("invalid_input", "Experiment file is outside managed storage") from exc
