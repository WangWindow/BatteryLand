"""Test helpers for creating immutable registered datasets and splits."""

from pathlib import Path
from typing import Any

from batteryland.common.storage import LocalSourceFiles
from batteryland.config import Settings
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore


def register_split(
    settings: Settings,
    name: str,
    file_names: tuple[str, ...],
    partitions: dict[str, tuple[str, ...]],
    *,
    root_alias: str | None = None,
) -> dict[str, Any]:
    """Register file metadata and persist a split the same way the API consumes it."""
    if not file_names or any(not partition for partition in ("train", "val", "test")):
        raise ValueError("Test splits need files in train, val and test")
    alias, root = _find_root(settings.source_roots, file_names, root_alias)
    root.mkdir(parents=True, exist_ok=True)
    for name_on_disk in file_names:
        matches = sorted(root.rglob(name_on_disk))
        if not matches:
            (root / name_on_disk).write_bytes(name_on_disk.encode())

    database = Database(settings.data_dir / "platform.sqlite")
    database.initialize()
    try:
        resources = ResourceService(database.unit_of_work, LocalSourceFiles(settings.source_roots))
        source = resources.create_source(name, alias)
        records = []
        for file_name in file_names:
            paths = sorted(
                path
                for path in root.rglob(file_name)
                if path.is_file() and path.name == file_name
            )
            selected_path = paths[0] if paths else root / file_name
            records.append(
                {
                    "file_name": file_name,
                    "relative_key": selected_path.relative_to(root).as_posix(),
                }
            )
        resources.import_batteries(source["id"], records)
        batteries = resources.list_batteries({"source_id": source["id"]}, 1, len(file_names))[
            "items"
        ]
        battery_ids = {item["file_name"]: item["id"] for item in batteries}
        revision = resources.list_sources(1, 200)["items"][0]["revision"]
        split_service = SplitService(
            database.unit_of_work, SQLiteDocumentStore(database.unit_of_work)
        )
        split = split_service.create(
            {
                "name": name,
                "source_selections": [
                    {
                        "source_id": source["id"],
                        "expected_revision": revision,
                        "battery_ids": list(battery_ids.values()),
                    }
                ],
                "method": "manual",
                "partitions": {
                    partition: [battery_ids[file_name] for file_name in partitions[partition]]
                    for partition in ("train", "val", "test")
                },
            }
        )
        return {"source": source, "batteries": battery_ids, "split": split}
    finally:
        database.engine.dispose()


def _find_root(
    roots: dict[str, Path], file_names: tuple[str, ...], requested_alias: str | None
) -> tuple[str, Path]:
    candidates = (
        [(requested_alias, roots.get(requested_alias))]
        if requested_alias is not None
        else sorted(roots.items())
    )
    for alias, root in candidates:
        if alias is None or root is None:
            continue
        if all(any(path.is_file() and path.name == name for path in root.rglob(name)) for name in file_names):
            return alias, root
    if requested_alias is not None:
        root = roots.get(requested_alias)
        if root is None:
            raise ValueError(f"Unknown source root alias {requested_alias!r}")
        root.mkdir(parents=True, exist_ok=True)
        return requested_alias, root
    if len(roots) != 1:
        raise ValueError("Unable to identify a single source root for test files")
    alias, root = next(iter(roots.items()))
    root.mkdir(parents=True, exist_ok=True)
    return alias, root
