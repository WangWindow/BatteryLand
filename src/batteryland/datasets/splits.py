from collections.abc import Sequence
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_json
from batteryland.datasets.split_rules import PARTITIONS, make_split
from batteryland.datasets.statistics import summarize_dataset
from batteryland.db.contracts import Record, UnitOfWork, UnitOfWorkFactory
from batteryland.documents.contracts import DocumentStore


class SplitService:
    def __init__(self, units: UnitOfWorkFactory, documents: DocumentStore) -> None:
        self.units = units
        self.documents = documents

    @staticmethod
    def _statistics(unit: UnitOfWork, payload: Record) -> Record:
        member_ids = [member for name in PARTITIONS for member in payload[name]]
        records = unit.resources.get_batteries(member_ids)
        metadata = {record["id"]: record["metadata"] for record in records}
        return summarize_dataset(
            {name: payload[name] for name in PARTITIONS},
            metadata,
        )

    def _payload(self, unit: UnitOfWork, body: Record) -> Record:
        catalog_state = unit.catalog.status()["state"]
        if catalog_state == "running":
            raise DomainError("conflict", "The asset catalog is syncing; retry after it finishes")
        enforce_availability = catalog_state == "ready"
        if body.get("logical_dataset_id"):
            logical_dataset = unit.logical_datasets.get(body["logical_dataset_id"])
            if logical_dataset["stale"]:
                raise DomainError(
                    "conflict", "A source changed since this logical dataset was saved"
                )
            ids = list(unit.logical_datasets.battery_ids(body["logical_dataset_id"]))
            selected_records = unit.resources.get_batteries(ids)
            if len(selected_records) != len(ids) or any(
                item["availability"] != "available" for item in selected_records
            ):
                raise DomainError(
                    "conflict", "A logical dataset member is no longer available"
                )
            records = {item["id"]: item for item in selected_records}
            source_snapshots = [
                {
                    "source_id": source["source_id"],
                    "source_revision": source["source_revision"],
                    "include_all": False,
                }
                for source in logical_dataset["source_snapshot"]
            ]
            includes_whole_source = False
        else:
            ids = []
            records = {}
            source_snapshots = []
            includes_whole_source = False

        if not body.get("logical_dataset_id"):
            source_selections = body["source_selections"]
            source_ids = [selection["source_id"] for selection in source_selections]
            if len(source_ids) != len(set(source_ids)):
                raise DomainError("invalid_input", "A source can only be selected once")

            for selection in source_selections:
                source_id = selection["source_id"]
                source = unit.resources.get_source(source_id)
                if selection["expected_revision"] != source["revision"]:
                    raise DomainError(
                        "conflict", "A data source revision changed; preview the split again"
                    )

                include_all = selection.get("include_all", False)
                selected_ids = selection.get("battery_ids", [])
                excluded_ids = selection.get("excluded_battery_ids", [])
                if include_all:
                    if selected_ids:
                        raise DomainError(
                            "invalid_input", "Whole-source selection cannot include explicit files"
                        )
                    includes_whole_source = True
                    source_batteries = (
                        unit.resources.list_available_source_batteries(source_id)
                        if enforce_availability
                        else unit.resources.list_source_batteries(source_id)
                    )
                    source_records = {record["id"]: record for record in source_batteries}
                    if not set(excluded_ids).issubset(source_records):
                        raise DomainError(
                            "invalid_input", "Excluded files must belong to their selected source"
                        )
                    selected_ids = [
                        identity for identity in source_records if identity not in excluded_ids
                    ]
                    records.update(
                        {
                            identity: record
                            for identity, record in source_records.items()
                            if identity not in excluded_ids
                        }
                    )
                elif not selected_ids:
                    if excluded_ids:
                        raise DomainError(
                            "invalid_input", "Excluded files require a whole-source selection"
                        )
                    raise DomainError(
                        "invalid_input", "Each selected source needs selected files"
                    )
                else:
                    if excluded_ids:
                        raise DomainError(
                            "invalid_input", "Excluded files require a whole-source selection"
                        )
                    source_batteries = unit.resources.get_batteries(selected_ids)
                    if len(source_batteries) != len(selected_ids):
                        raise DomainError("invalid_input", "Split references an unknown battery")
                    if any(record["source_id"] != source_id for record in source_batteries):
                        raise DomainError(
                            "invalid_input", "Split members must belong to their selected source"
                        )
                    if enforce_availability and any(
                        record["availability"] != "available" for record in source_batteries
                    ):
                        raise DomainError("conflict", "A selected battery is no longer available")
                    records.update({record["id"]: record for record in source_batteries})

                ids.extend(selected_ids)
                source_snapshots.append(
                    {
                        "source_id": source_id,
                        "source_revision": source["revision"],
                        "include_all": include_all,
                    }
                )

        if not ids:
            raise DomainError("invalid_input", "Select at least one battery for the split")
        if len(ids) != len(set(ids)):
            raise DomainError("invalid_input", "A battery can only be selected once")
        if includes_whole_source and body["method"] != "random":
            raise DomainError("invalid_input", "Whole-source selections must use random partitioning")
        parents = (
            {record["parent_battery_id"] for record in records.values()} - {None} - records.keys()
        )
        while parents:
            found = unit.resources.get_batteries(list(parents))
            if len(found) != len(parents):
                raise DomainError("invalid_input", "Battery parent reference is missing")
            records.update({record["id"]: record for record in found})
            parents = {record["parent_battery_id"] for record in found} - {None} - records.keys()
        families: dict[str, str] = {}
        for identity in ids:
            current = identity
            visited: set[str] = set()
            while records[current]["parent_battery_id"]:
                if current in visited:
                    raise DomainError(
                        "invalid_input", "Battery parent relationship contains a cycle"
                    )
                visited.add(current)
                current = records[current]["parent_battery_id"]
            families[identity] = current
        partitions = make_split(
            ids,
            families,
            body["method"],
            body.get("partitions"),
            body.get("ratios"),
            body.get("seed"),
        )
        return {
            "dataset_name": body["name"],
            "logical_dataset_id": body.get("logical_dataset_id"),
            "sources": source_snapshots,
            **partitions,
            "method": body["method"],
            "seed": body.get("seed"),
            "algorithm_version": "shuffle-v1",
            "parameters": {"ratios": body.get("ratios")},
        }

    @staticmethod
    def _view(
        header: Record, version: int, payload: Record, statistics: Record | None = None
    ) -> Record:
        return {key: value for key, value in header.items() if key != "head_document_id"} | {
            "name": payload["dataset_name"],
            "logical_dataset_id": payload.get("logical_dataset_id"),
            "head_version": header["revision"],
            "version": version,
            "counts": {name: len(payload[name]) for name in PARTITIONS},
            "payload": payload,
            "statistics": statistics,
        }

    def create(self, body: Record) -> Record:
        identity = str(uuid4())
        with self.units() as unit:
            payload = self._payload(unit, body)
            statistics = self._statistics(unit, payload)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.add(identity, body["name"], document.id, payload["sources"])
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, 1, payload, statistics)

    def preview(self, body: Record) -> Record:
        with self.units() as unit:
            payload = self._payload(unit, body)
        counts = {name: len(payload[name]) for name in PARTITIONS}
        return {
            "source_revisions": {
                source["source_id"]: source["source_revision"] for source in payload["sources"]
            },
            "counts": {"all": sum(counts.values()), **counts},
        }

    def update(self, identity: str, body: Record, revision: int) -> Record:
        with self.units() as unit:
            old = unit.splits.get(identity)
            if old["revision"] != revision:
                raise DomainError("conflict", "Split revision has changed")
            payload = self._payload(unit, body)
            statistics = self._statistics(unit, payload)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, revision + 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.update(
                    identity, revision, body["name"], document.id, payload["sources"]
                )
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, revision + 1, payload, statistics)

    def get(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            payload = self.documents.read(document)["payload"]
            header = header | {"sources": unit.splits.sources(document.id)}
            statistics = unit.splits.statistics(document.id)
            if statistics is None:
                statistics = self._statistics(unit, payload)
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, document.version, payload, statistics)

    def list(
        self, source_ids: Sequence[str] | None, q: str | None, page: int, page_size: int
    ) -> Record:
        with self.units() as unit:
            result = unit.splits.list_splits(list(source_ids) if source_ids is not None else None, q, page, page_size)
        for item in result["items"]:
            item.pop("head_document_id")
        return result

    def members(
        self, identity: str, version: int | None, partition: str | None, page: int, page_size: int
    ) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            return unit.splits.members(document.id, partition, page, page_size)

    def export(self, identity: str, version: int | None = None) -> Record:
        split = self.get(identity, version)
        payload = split["payload"]
        with self.units() as unit:
            records = unit.resources.get_batteries(
                [member for name in PARTITIONS for member in payload[name]]
            )
        names = {record["id"]: record["file_name"] for record in records}
        return {
            "dataset": payload["dataset_name"],
            **{name: [names[member] for member in payload[name]] for name in PARTITIONS},
        }

    def execution_binding(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            payload = self.documents.read(document)["payload"]
            member_ids = [member for name in PARTITIONS for member in payload[name]]
            batteries = unit.resources.get_batteries(member_ids)
            if len(batteries) != len(member_ids):
                raise DomainError("storage_corrupt", "Split references missing battery records")

            sources = {item["id"]: item for item in unit.splits.sources(document.id)}
            members = []
            for battery in batteries:
                source = sources.get(battery["source_id"])
                if source is None:
                    raise DomainError("storage_corrupt", "Split member source is not versioned")
                members.append(battery | {"root_alias": source["root_alias"]})

            names = {battery["id"]: battery["file_name"] for battery in batteries}
            provider_split = {
                "dataset": payload["dataset_name"],
                **{
                    name: [names[member] for member in payload[name]]
                    for name in PARTITIONS
                },
            }
            return {
                "split_id": identity,
                "split_version": document.version,
                "split_document_id": document.id,
                "name": payload["dataset_name"],
                "sources": list(sources.values()),
                "members": members,
                "provider_split": provider_split,
            }

    def import_document(self, source_ids: Sequence[str], content: bytes) -> Record:
        value = load_json(content)
        if (
            set(value) != {"dataset", *PARTITIONS}
            or not isinstance(value["dataset"], str)
            or not value["dataset"].strip()
        ):
            raise DomainError("invalid_input", "Split import requires dataset, train, val and test")
        if not source_ids or len(source_ids) != len(set(source_ids)):
            raise DomainError("invalid_input", "Choose one or more unique data sources")

        partitions: dict[str, list[str]] = {}
        matched_sources: dict[str, Record] = {}
        matched_batteries: dict[str, Record] = {}
        with self.units() as unit:
            sources = {identity: unit.resources.get_source(identity) for identity in source_ids}
            for name in PARTITIONS:
                if not isinstance(value[name], list) or any(
                    not isinstance(item, str) or not item for item in value[name]
                ):
                    raise DomainError("invalid_input", "Split members must be file name lists")
                partitions[name] = []
                for filename in value[name]:
                    candidates = [
                        battery
                        for source_id in source_ids
                        if (battery := unit.resources.find_battery(source_id, filename)) is not None
                    ]
                    if len(candidates) != 1:
                        raise DomainError(
                            "invalid_input",
                            "Imported member is missing or ambiguous across selected sources",
                            details={"file_name": filename, "matches": len(candidates)},
                        )
                    battery = candidates[0]
                    matched_sources[battery["source_id"]] = sources[battery["source_id"]]
                    matched_batteries[battery["id"]] = battery
                    partitions[name].append(battery["id"])

        if not matched_sources:
            raise DomainError("invalid_input", "Imported split contains no registered files")
        return self.create(
            {
                "name": value["dataset"],
                "source_selections": [
                    {
                        "source_id": source_id,
                        "expected_revision": source["revision"],
                        "battery_ids": [
                            battery_id
                            for partition in partitions.values()
                            for battery_id in partition
                            if matched_batteries[battery_id]["source_id"] == source_id
                        ],
                    }
                    for source_id, source in sorted(matched_sources.items())
                ],
                "method": "manual",
                "partitions": partitions,
            }
        )

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.splits.delete(identity)
        return {"deleted": True}
