from uuid import uuid4

from batteryland.application.ports.documents import DocumentStore
from batteryland.application.ports.persistence import Record, UnitOfWork, UnitOfWorkFactory
from batteryland.application.serialization import load_json
from batteryland.domain.errors import DomainError
from batteryland.domain.splits import PARTITIONS, make_split


class SplitService:
    def __init__(self, units: UnitOfWorkFactory, documents: DocumentStore) -> None:
        self.units = units
        self.documents = documents

    def _payload(self, unit: UnitOfWork, body: Record) -> Record:
        unit.resources.get_source(body["source_id"])
        ids = body["battery_ids"]
        records = {record["id"]: record for record in unit.resources.get_batteries(ids)}
        if set(records) != set(ids):
            raise DomainError("invalid_input", "Split references an unknown battery")
        if any(record["source_id"] != body["source_id"] for record in records.values()):
            raise DomainError("invalid_input", "Split members must belong to the selected source")
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
            "source_id": body["source_id"],
            **partitions,
            "method": body["method"],
            "seed": body.get("seed"),
            "algorithm_version": "shuffle-v1",
            "parameters": {"ratios": body.get("ratios")},
        }

    @staticmethod
    def _view(header: Record, version: int, payload: Record) -> Record:
        return {key: value for key, value in header.items() if key != "head_document_id"} | {
            "name": payload["dataset_name"],
            "head_version": header["revision"],
            "version": version,
            "counts": {name: len(payload[name]) for name in PARTITIONS},
            "payload": payload,
        }

    def create(self, body: Record) -> Record:
        identity = str(uuid4())
        with self.units() as unit:
            payload = self._payload(unit, body)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.add(identity, body["name"], body["source_id"], document.id)
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
        return self._view(header, 1, payload)

    def update(self, identity: str, body: Record, revision: int) -> Record:
        with self.units() as unit:
            old = unit.splits.get(identity)
            if old["revision"] != revision:
                raise DomainError("conflict", "Split revision has changed")
            if old["source_id"] != body["source_id"]:
                raise DomainError("invalid_input", "A split cannot change its source")
            payload = self._payload(unit, body)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, revision + 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.update(identity, revision, body["name"], document.id)
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
        return self._view(header, revision + 1, payload)

    def get(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
        return self._view(header, document.version, self.documents.read(document)["payload"])

    def list(self, source_id: str | None, q: str | None, page: int, page_size: int) -> Record:
        with self.units() as unit:
            result = unit.splits.list_splits(source_id, q, page, page_size)
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

    def import_document(self, source_id: str, content: bytes) -> Record:
        value = load_json(content)
        if (
            set(value) != {"dataset", *PARTITIONS}
            or not isinstance(value["dataset"], str)
            or not value["dataset"].strip()
        ):
            raise DomainError("invalid_input", "Split import requires dataset, train, val and test")
        partitions: dict[str, list[str]] = {}
        with self.units() as unit:
            unit.resources.get_source(source_id)
            for name in PARTITIONS:
                if not isinstance(value[name], list) or any(
                    not isinstance(item, str) or not item for item in value[name]
                ):
                    raise DomainError("invalid_input", "Split members must be file name lists")
                partitions[name] = []
                for filename in value[name]:
                    battery = unit.resources.find_battery(source_id, filename)
                    if battery is None:
                        raise DomainError(
                            "invalid_input",
                            "Imported split refers to an unregistered battery",
                            details={"file_name": filename},
                        )
                    partitions[name].append(battery["id"])
        return self.create(
            {
                "name": value["dataset"],
                "source_id": source_id,
                "battery_ids": list(
                    dict.fromkeys(member for group in partitions.values() for member in group)
                ),
                "method": "manual",
                "partitions": partitions,
            }
        )

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.splits.delete(identity)
        return {"deleted": True}
