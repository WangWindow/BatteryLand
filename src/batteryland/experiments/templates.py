import json
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.documents.contracts import DocumentStore


def check_config(value: Record) -> None:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise DomainError("invalid_input", "Configuration must contain finite JSON values") from exc


class ConfigurationService:
    def __init__(self, units: UnitOfWorkFactory, documents: DocumentStore) -> None:
        self.units = units
        self.documents = documents

    def create(self, name: str, config: Record) -> Record:
        check_config(config)
        identity = str(uuid4())
        with self.documents.write_lock():
            document = self.documents.publish("template", identity, 1, {"native_config": config})
            with self.units() as unit:
                unit.documents.add(document)
                unit.templates.add(identity, name, document.id)
        return self.get(identity)

    def get(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.templates.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("template", identity, version)
            )
        return {key: value for key, value in header.items() if key != "head_document_id"} | {
            "head_version": header["revision"],
            "version": document.version,
            "native_config": self.documents.read(document)["payload"]["native_config"],
        }

    def update(self, identity: str, name: str, config: Record, revision: int) -> Record:
        check_config(config)
        with self.units() as unit:
            old = unit.templates.get(identity)
            if old["revision"] != revision:
                raise DomainError("conflict", "Template revision has changed")
        with self.documents.write_lock():
            document = self.documents.publish(
                "template", identity, revision + 1, {"native_config": config}
            )
            with self.units() as unit:
                unit.documents.add(document)
                unit.templates.update(identity, revision, name, document.id)
        return self.get(identity)

    def list(self, q: str | None, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.templates.list(q, page, page_size)

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.templates.delete(identity)
        return {"deleted": True}
