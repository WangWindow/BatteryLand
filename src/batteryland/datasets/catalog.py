"""Index the fixed battery pool by original folder and provider-named manifests."""

import hashlib
from collections import Counter, defaultdict
from pathlib import PurePosixPath
from typing import Any

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_json
from batteryland.config import Settings
from batteryland.datasets.service import ResourceService
from batteryland.db.contracts import Record, UnitOfWorkFactory


class FixedCatalogIndexer:
    def __init__(
        self, settings: Settings, resources: ResourceService, units: UnitOfWorkFactory
    ) -> None:
        self.settings = settings
        self.resources = resources
        self.units = units

    def index(self) -> None:
        with self.units() as unit:
            unit.catalog.start_scan()
        try:
            all_groups: dict[tuple[str, str], list[Record]] = {}
            root_availability: dict[str, bool] = {}
            file_count = 0
            for alias in sorted(self.settings.source_roots):
                root_availability[alias] = self.resources.files.inspect(alias) == "available"
                candidates: list[Record] = []
                page = 1
                while True:
                    batch = self.resources.files.list_files(alias, None, page, 100000)
                    candidates.extend(batch["items"])
                    if len(candidates) >= batch["total"] or not batch["items"]:
                        break
                    page += 1
                file_count += len(candidates)
                for item in candidates:
                    parent = PurePosixPath(item["relative_key"]).parent.as_posix()
                    prefix = "" if parent == "." else parent
                    all_groups.setdefault((alias, prefix), []).append(item)
                if not candidates and root_availability[alias]:
                    all_groups.setdefault((alias, ""), [])

            indexed_sources: list[str] = []
            with self.units() as unit:
                existing = {
                    (item["root_alias"], item["group_prefix"]): item
                    for item in unit.resources.list_sources(1, 10000)["items"]
                    if item["root_alias"] in self.settings.source_roots
                }
                # Retain empty/missing physical folders so saved datasets keep stable IDs.
                for key in existing:
                    all_groups.setdefault(key, [])

                names = Counter(prefix or alias for alias, prefix in all_groups)
                for (alias, prefix), candidates in sorted(all_groups.items()):
                    name = prefix or alias
                    if names[name] > 1:
                        name = f"{alias}/{name}"
                    source = existing.get((alias, prefix))
                    if source is None:
                        source = unit.resources.add_source(
                            name,
                            alias,
                            "available" if root_availability[alias] else "missing",
                            prefix,
                        )
                    elif source["name"] != name:
                        # The configured root plus folder path is the stable identity.
                        unit.resources.rename_source(source["id"], name)
                    indexed_sources.append(source["id"])
                    entries = [
                        {
                            "file_name": item["file_name"],
                            "relative_key": item["relative_key"],
                            "size_bytes": item["size_bytes"],
                            "modified_at_ns": item["modified_at_ns"],
                        }
                        for item in candidates
                    ]
                    group_path = self.settings.source_roots[alias] / prefix
                    group_available = root_availability[alias] and group_path.is_dir()
                    unit.resources.sync_catalog_source(
                        source["id"], root_available=group_available, batteries=entries
                    )

            if any(
                root.name == "BatteryLife_Processed" for root in self.settings.source_roots.values()
            ):
                self._named_groups(indexed_sources)
            with self.units() as unit:
                unit.catalog.complete_scan(file_count, len(indexed_sources))
        except Exception as exc:
            with self.units() as unit:
                unit.catalog.fail_scan(f"{type(exc).__name__}: {exc}")
            raise

    def status(self) -> Record:
        with self.units() as unit:
            return unit.catalog.status()

    def _named_groups(self, source_ids: list[str]) -> None:
        candidates_by_name: dict[str, list[Record]] = defaultdict(list)
        for source_id in source_ids:
            page = 1
            while True:
                batch = self.resources.list_batteries(
                    {"source_id": source_id, "availability": "available"}, page, 200
                )
                for battery in batch["items"]:
                    candidates_by_name[battery["file_name"]].append(battery)
                if page * 200 >= batch["total"]:
                    break
                page += 1
        by_name = {
            name: min(
                candidates,
                key=lambda item: (
                    item["relative_key"].casefold(),
                    item["relative_key"],
                    item["source_id"],
                    item["id"],
                ),
            )
            for name, candidates in candidates_by_name.items()
        }

        folder = self.settings.provider_root / "datasets/batteryLife/data_split"
        for path in sorted(folder.glob("*.json")):
            content = path.read_bytes()
            document = load_json(content)
            name = document.get("dataset")
            if not isinstance(name, str) or not name:
                raise DomainError("invalid_input", "Provider split has no dataset name")
            counts: dict[str, Any] = {"matched": 0, "missing": 0, "ambiguous": 0}
            members: list[Record] = []
            for partition in ("train", "val", "test"):
                names = document.get(partition)
                if not isinstance(names, list) or not all(isinstance(item, str) for item in names):
                    raise DomainError("invalid_input", "Provider split members must be file names")
                counts[partition] = len(names)
                for ordinal, file_name in enumerate(names):
                    candidate = by_name.get(file_name)
                    status = "matched" if candidate is not None else "missing"
                    counts[status] += 1
                    members.append(
                        {
                            "partition": partition,
                            "ordinal": ordinal,
                            "file_name": file_name,
                            "battery_id": candidate["id"] if candidate is not None else None,
                            "match_status": status,
                            "candidate_count": 1 if candidate is not None else 0,
                        }
                    )
            with self.units() as unit:
                unit.named_groups.put(
                    name, hashlib.sha256(content).hexdigest(), document, counts, members
                )


class NamedGroupService:
    def __init__(self, units: UnitOfWorkFactory) -> None:
        self.units = units

    def list(self, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.named_groups.list(page, page_size)

    def get(self, name: str) -> Record:
        with self.units() as unit:
            return unit.named_groups.get(name)

    def members(self, name: str, partition: str | None, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.named_groups.members(name, partition, page, page_size)
