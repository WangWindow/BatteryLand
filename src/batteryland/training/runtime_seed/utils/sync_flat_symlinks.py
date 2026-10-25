"""Create the stable flat data view expected by the default BatteryLife loader."""

import os
from pathlib import Path


def sync_flat_symlinks(src_root: str, dst_dir: str, exclude_in_src: list[str]) -> None:
    configured_root = os.environ.get("BATTERYLAND_DATA_ROOT", src_root)
    source = Path(configured_root).resolve()
    destination = Path(dst_dir).resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Battery data source does not exist: {source}")
    destination.mkdir(parents=True, exist_ok=True)

    expected: dict[str, Path] = {}
    for path in sorted(
        source.rglob("*"),
        key=lambda item: (
            item.relative_to(source).as_posix().casefold(),
            item.relative_to(source).as_posix(),
        ),
    ):
        if not path.is_file() or any(
            part in exclude_in_src for part in path.relative_to(source).parts[:-1]
        ):
            continue
        resolved = path.resolve()
        if resolved.is_relative_to(source):
            expected.setdefault(path.name, resolved)

    for existing in destination.iterdir():
        if existing.is_symlink() and (existing.name not in expected or not existing.exists()):
            existing.unlink()

    for name, target in expected.items():
        link = destination / name
        if link.is_symlink():
            if link.resolve() == target:
                continue
            link.unlink()
        if not link.exists():
            link.symlink_to(target)
