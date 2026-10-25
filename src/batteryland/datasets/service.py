import json
from pathlib import PurePosixPath
from typing import Any

from batteryland.common.errors import DomainError
from batteryland.common.file_contracts import SourceFiles
from batteryland.db.contracts import Record, UnitOfWorkFactory


class ResourceService:
    def __init__(self, units: UnitOfWorkFactory, files: SourceFiles) -> None:
        self.units = units
        self.files = files

    def create_source(self, name: str, root_alias: str, group_prefix: str = "") -> Record:
        availability = self.files.inspect(root_alias)
        with self.units() as unit:
            return unit.resources.add_source(name, root_alias, availability, group_prefix)

    def source_options(self) -> list[Record]:
        page = self.list_sources(1, 10000)
        by_alias: dict[str, Record] = {}
        for source in page["items"]:
            item = by_alias.setdefault(
                source["root_alias"],
                {
                    "root_alias": source["root_alias"],
                    "display_name": source["name"],
                    "availability": source["availability"],
                    "file_count": 0,
                },
            )
            item["file_count"] += source["available_battery_count"]
            if source["availability"] == "available":
                item["availability"] = "available"
        return [by_alias[alias] for alias in sorted(by_alias)]

    def list_sources(self, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.resources.list_sources(page, page_size)

    def list_source_files(self, source_id: str, q: str | None, page: int, page_size: int) -> Record:
        with self.units() as unit:
            unit.resources.get_source(source_id)
            batteries = unit.resources.list_batteries(
                {"source_id": source_id, "q": q, "availability": "available"},
                page,
                page_size,
            )
        return batteries | {
            "items": [
                {
                    "file_name": row["file_name"],
                    "relative_key": row["relative_key"],
                    "size_bytes": row["file_size_bytes"] or 0,
                    "importable": True,
                    "reason": None,
                }
                for row in batteries["items"]
            ]
        }

    def sync_catalog_source(
        self,
        identity: str,
        *,
        root_available: bool,
        batteries: list[Record],
    ) -> Record:
        with self.units() as unit:
            return unit.resources.sync_catalog_source(
                identity, root_available=root_available, batteries=batteries
            )

    def find_source(self, root_alias: str, group_prefix: str) -> Record | None:
        with self.units() as unit:
            return unit.resources.find_source(root_alias, group_prefix)

    def import_batteries(self, source_id: str, batteries: list[Record]) -> Record:
        imported = existing_count = 0
        with self.units() as unit:
            source = unit.resources.get_source(source_id)
            prepared: dict[str, Record] = {}
            for index, item in enumerate(batteries):
                name = item["file_name"]
                if (
                    not name
                    or "\x00" in name
                    or "\\" in name
                    or PurePosixPath(name).name != name
                    or name in {".", ".."}
                ):
                    raise DomainError(
                        "invalid_input",
                        "Battery file name must not contain a path",
                        details={"imported": 0, "errors": [{"index": index, "field": "file_name"}]},
                    )
                value = {
                    "source_id": source_id,
                    "file_name": name,
                    "relative_key": item.get("relative_key") or name,
                    "parent_battery_id": item.get("parent_battery_id"),
                    "metadata": item.get("metadata", {}),
                }
                try:
                    json.dumps(value["metadata"], allow_nan=False)
                except (ValueError, TypeError) as exc:
                    raise DomainError(
                        "invalid_input", "Metadata must contain finite JSON values"
                    ) from exc
                value["availability"] = self.files.inspect(
                    source["root_alias"], value["relative_key"]
                )
                if value["parent_battery_id"]:
                    unit.resources.get_battery(value["parent_battery_id"])
                known = prepared.get(name) or unit.resources.find_battery(source_id, name)
                if known is not None:
                    if any(
                        known.get(key) != value[key]
                        for key in ["relative_key", "parent_battery_id", "metadata"]
                    ):
                        raise DomainError(
                            "conflict",
                            "Battery identity has conflicting metadata",
                            details={
                                "imported": 0,
                                "errors": [{"index": index, "file_name": name}],
                            },
                        )
                    existing_count += 1
                else:
                    prepared[name] = value
            for value in prepared.values():
                unit.resources.add_battery(value)
                imported += 1
            if imported:
                unit.resources.increment_source_revision(source_id)
        return {"imported": imported, "existing": existing_count, "errors": []}

    def list_batteries(self, filters: dict[str, Any], page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.resources.list_batteries(filters, page, page_size)

    def battery_facets(self, source_ids: list[str] | None) -> Record:
        with self.units() as unit:
            return unit.resources.battery_facets(source_ids)

    def get_battery(self, identity: str) -> Record:
        with self.units() as unit:
            return unit.resources.get_battery(identity)
