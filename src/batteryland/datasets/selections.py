"""Resolve a browser selection against the current indexed catalog."""

from collections.abc import Sequence

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record, UnitOfWork


def resolve_source_selections(
    unit: UnitOfWork, selections: Sequence[Record]
) -> tuple[list[str], list[Record], list[Record]]:
    if unit.catalog.status()["state"] == "running":
        raise DomainError("conflict", "The asset catalog is syncing; retry after it finishes")
    if not selections:
        raise DomainError("invalid_input", "Select at least one physical dataset")

    source_ids = [item["source_id"] for item in selections]
    if len(source_ids) != len(set(source_ids)):
        raise DomainError("invalid_input", "A physical dataset can only be selected once")

    selected_ids: list[str] = []
    batteries: dict[str, Record] = {}
    snapshots: list[Record] = []
    for selection in selections:
        source_id = selection["source_id"]
        source = unit.resources.get_source(source_id)
        if selection["expected_revision"] != source["revision"]:
            raise DomainError(
                "conflict", "The asset catalog changed; refresh the selection and try again"
            )

        if selection.get("include_all", False):
            if selection.get("battery_ids"):
                raise DomainError("invalid_input", "Whole-dataset selection cannot list files")
            available = unit.resources.list_available_source_batteries(source_id)
            available_ids = {item["id"] for item in available}
            excluded = set(selection.get("excluded_battery_ids", []))
            if not excluded.issubset(available_ids):
                raise DomainError("conflict", "A selected file is no longer available")
            identities = [item["id"] for item in available if item["id"] not in excluded]
        else:
            if selection.get("excluded_battery_ids"):
                raise DomainError(
                    "invalid_input", "Excluded files require a whole-dataset selection"
                )
            identities = list(selection.get("battery_ids", []))
            if not identities:
                raise DomainError("invalid_input", "Each selected dataset needs selected files")

        records = unit.resources.get_batteries(identities)
        if len(records) != len(identities):
            raise DomainError("conflict", "A selected file is no longer present in the catalog")
        if any(record["source_id"] != source_id for record in records):
            raise DomainError("invalid_input", "Selected files must belong to their dataset")
        if any(record["availability"] != "available" for record in records):
            raise DomainError("conflict", "A selected file is no longer available")
        selected_ids.extend(identities)
        batteries.update({record["id"]: record for record in records})
        snapshots.append(
            {
                "source_id": source_id,
                "source_name": source["name"],
                "source_revision": source["revision"],
                "root_alias": source["root_alias"],
                "group_prefix": source["group_prefix"],
            }
        )

    if not selected_ids:
        raise DomainError(
            "invalid_input", "The selected physical datasets contain no available files"
        )
    if len(selected_ids) != len(set(selected_ids)):
        raise DomainError("invalid_input", "A file can only be selected once")
    return selected_ids, snapshots, list(batteries.values())
