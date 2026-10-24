import json
from pathlib import PurePosixPath
from typing import Any

from batteryland.application.ports.files import SourceFiles
from batteryland.application.ports.persistence import Record, UnitOfWorkFactory
from batteryland.domain.errors import DomainError


class ResourceService:
    def __init__(self, units: UnitOfWorkFactory, files: SourceFiles) -> None:
        self.units = units
        self.files = files

    def create_source(self, name: str, root_alias: str) -> Record:
        availability = self.files.inspect(root_alias)
        with self.units() as unit:
            return unit.resources.add_source(name, root_alias, availability)

    def source_options(self) -> list[Record]:
        return self.files.options()

    def list_sources(self, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.resources.list_sources(page, page_size)

    def list_source_files(self, source_id: str, q: str | None, page: int, page_size: int) -> Record:
        with self.units() as unit:
            source = unit.resources.get_source(source_id)
        return self.files.list_files(source["root_alias"], q, page, page_size)

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
        return {"imported": imported, "existing": existing_count, "errors": []}

    def list_batteries(self, filters: dict[str, Any], page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.resources.list_batteries(filters, page, page_size)

    def get_battery(self, identity: str) -> Record:
        with self.units() as unit:
            return unit.resources.get_battery(identity)
