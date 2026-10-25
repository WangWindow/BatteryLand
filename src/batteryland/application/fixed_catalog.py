"""Index the fixed battery pool by original folder and provider-named manifests."""

import hashlib
from collections import Counter, defaultdict
from pathlib import PurePosixPath
from typing import Any

from batteryland.application.ports.persistence import Record, UnitOfWorkFactory
from batteryland.application.resources import ResourceService
from batteryland.application.serialization import load_json
from batteryland.config import Settings
from batteryland.domain.errors import DomainError


class FixedCatalogIndexer:
    def __init__(
        self, settings: Settings, resources: ResourceService, units: UnitOfWorkFactory
    ) -> None:
        self.settings = settings
        self.resources = resources
        self.units = units

    def index(self) -> None:
        known = {
            (item["root_alias"], item["group_prefix"]): item
            for item in self.resources.list_sources(1, 10000)["items"]
        }
        all_groups: dict[tuple[str, str], list[Record]] = {}
        for alias, root in sorted(self.settings.source_roots.items()):
            candidates = self.resources.files.list_files(alias, None, 1, 100000)["items"]
            for item in candidates:
                parent = PurePosixPath(item["relative_key"]).parent.as_posix()
                prefix = "" if parent == "." else parent
                all_groups.setdefault((alias, prefix), []).append(item)
            if not candidates and root.is_dir():
                all_groups.setdefault((alias, ""), [])

        names = Counter(prefix or alias for alias, prefix in all_groups)
        indexed_sources: list[str] = []
        for (alias, prefix), candidates in sorted(all_groups.items()):
            name = prefix or alias
            if names[name] > 1:
                name = f"{alias}/{name}"
            source = known.get((alias, prefix)) or self.resources.create_source(name, alias, prefix)
            indexed_sources.append(source["id"])
            entries = [
                {
                    "file_name": item["file_name"],
                    "relative_key": item["relative_key"],
                    "metadata": {},
                }
                for item in candidates
            ]
            if entries:
                self.resources.import_batteries(source["id"], entries)

        if any(
            root.name == "BatteryLife_Processed" for root in self.settings.source_roots.values()
        ):
            self._named_groups(indexed_sources)

    def _named_groups(self, source_ids: list[str]) -> None:
        by_name: dict[str, list[str]] = defaultdict(list)
        for source_id in source_ids:
            page = 1
            while True:
                batch = self.resources.list_batteries({"source_id": source_id}, page, 200)
                for battery in batch["items"]:
                    by_name[battery["file_name"]].append(battery["id"])
                if page * 200 >= batch["total"]:
                    break
                page += 1

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
                    candidates = by_name.get(file_name, [])
                    status = (
                        "matched"
                        if len(candidates) == 1
                        else "missing"
                        if not candidates
                        else "ambiguous"
                    )
                    counts[status] += 1
                    members.append(
                        {
                            "partition": partition,
                            "ordinal": ordinal,
                            "file_name": file_name,
                            "battery_id": candidates[0] if len(candidates) == 1 else None,
                            "match_status": status,
                            "candidate_count": len(candidates),
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
