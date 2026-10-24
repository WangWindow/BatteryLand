import re
from uuid import uuid4

from batteryland.application.configurations import check_config
from batteryland.application.ports.documents import DocumentStore
from batteryland.application.ports.persistence import Record, UnitOfWork, UnitOfWorkFactory
from batteryland.application.ports.training import TrainingGateway
from batteryland.domain.errors import DomainError

REFERENCE_FIELDS = {
    "split": "split_document_id",
    "source_split": "source_split_document_id",
    "target_split": "target_split_document_id",
    "template": "template_document_id",
}


class ExperimentService:
    def __init__(
        self, units: UnitOfWorkFactory, documents: DocumentStore, training: TrainingGateway
    ) -> None:
        self.units = units
        self.documents = documents
        self.training = training

    def _resolve(self, unit: UnitOfWork, config: Record, bindings: Record) -> tuple[Record, Record]:
        refs: Record = {name: None for name in (*REFERENCE_FIELDS.values(), "checkpoint_id")}
        query: Record = {
            name: None
            for name in (
                "source_id",
                "split_id",
                "model_type",
                "task_type",
                "requested_device",
                "source_domain",
                "target_domain",
            )
        }
        for name, column in REFERENCE_FIELDS.items():
            binding = bindings.get(name)
            if binding is None:
                continue
            if name == "template":
                unit.templates.get(binding["id"])
            else:
                header = unit.splits.get(binding["id"])
                if name == "split":
                    query.update(source_id=header["source_id"], split_id=binding["id"])
                else:
                    query["source_domain" if name == "source_split" else "target_domain"] = binding[
                        "id"
                    ]
            refs[column] = unit.documents.find(
                "template" if name == "template" else "split", binding["id"], binding["version"]
            ).id
        checkpoint = bindings.get("checkpoint_id")
        if checkpoint:
            artifact = unit.artifacts.get(checkpoint)
            if artifact["kind"] != "checkpoint":
                raise DomainError("invalid_input", "Referenced artifact is not a checkpoint")
            refs["checkpoint_id"] = checkpoint
        for section, field in [("model", "model_type"), ("task", "task_type")]:
            value = config.get(section)
            if isinstance(value, dict) and isinstance(value.get("type"), str):
                query[field] = value["type"]
        mate = config.get("mate")
        if isinstance(mate, dict) and isinstance(mate.get("device"), str):
            query["requested_device"] = mate["device"]
        return refs, query

    def create(self, value: Record) -> Record:
        identity = str(uuid4())
        bindings = value.get("bindings") or {}
        config = value.get("native_config")
        with self.units() as unit:
            if config is None and bindings.get("template"):
                ref = bindings["template"]
                unit.templates.get(ref["id"])
                document = unit.documents.find("template", ref["id"], ref["version"])
                config = self.documents.read(document)["payload"]["native_config"]
            config = config if config is not None else {}
            check_config(config)
            refs, query = self._resolve(unit, config, bindings)
        with self.documents.write_lock():
            document = self.documents.publish(
                "experiment_draft", identity, 1, {"native_config": config, "bindings": bindings}
            )
            with self.units() as unit:
                unit.documents.add(document)
                unit.experiments.add(identity, value, document.id, refs, query)
        return self.get(identity)

    def _public(self, header: Record) -> Record:
        return {
            key: value
            for key, value in header.items()
            if not key.endswith("_document_id") and key != "checkpoint_id"
        }

    def get(self, identity: str) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            document = unit.documents.get(
                header["frozen_document_id"] or header["draft_document_id"]
            )
        payload = self.documents.read(document)["payload"]
        return self._public(header) | {
            "version": document.version,
            "native_config": payload["native_config"],
            "bindings": payload["bindings"],
        }

    def update(self, identity: str, patch: Record, revision: int) -> Record:
        current = self.get(identity)
        if current["state"] != "draft" or current["revision"] != revision:
            raise DomainError("conflict", "Experiment revision or state has changed")
        if not patch:
            raise DomainError("invalid_input", "At least one draft field must be changed")
        value = current | patch
        config = value.get("native_config")
        bindings = value.get("bindings") or {}
        if (
            not isinstance(config, dict)
            or value.get("kind") not in {"train", "evaluate", "transfer"}
            or not isinstance(value.get("name"), str)
            or not value["name"].strip()
        ):
            raise DomainError("invalid_input", "A draft needs a name and a configuration object")
        check_config(config)
        with self.units() as unit:
            refs, query = self._resolve(unit, config, bindings)
        with self.documents.write_lock():
            document = self.documents.publish(
                "experiment_draft",
                identity,
                revision + 1,
                {"native_config": config, "bindings": bindings},
            )
            with self.units() as unit:
                unit.documents.add(document)
                unit.experiments.update(identity, revision, value, document.id, refs, query)
        return self.get(identity)

    def list(self, filters: Record, page: int, page_size: int) -> Record:
        with self.units() as unit:
            result = unit.experiments.list_experiments(filters, page, page_size)
        result["items"] = [self._public(item) for item in result["items"]]
        return result

    def copy(self, identity: str, name: str | None = None) -> Record:
        old = self.get(identity)
        return self.create(
            {
                "name": name or f"{old['name']} copy",
                "kind": old["kind"],
                "native_config": old["native_config"],
                "bindings": old["bindings"],
            }
        )

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.experiments.delete(identity)
        return {"deleted": True}

    def validation_input(self, identity: str) -> Record:
        experiment = self.get(identity)
        resources: Record = {"kind": experiment["kind"], "splits": {}}
        with self.units() as unit:
            for key in ("split", "source_split", "target_split"):
                ref = experiment["bindings"].get(key)
                if ref:
                    document = unit.documents.find("split", ref["id"], ref["version"])
                    payload = self.documents.read(document)["payload"]
                    ids = [
                        member for group in ("train", "val", "test") for member in payload[group]
                    ]
                    batteries = unit.resources.get_batteries(ids)
                    names = {row["id"]: row["file_name"] for row in batteries}
                    resources["splits"][key] = {
                        "ref": ref,
                        "payload": payload,
                        "source": unit.resources.get_source(
                            unit.splits.get(ref["id"])["source_id"]
                        ),
                        "batteries": batteries,
                        "provider_split": {
                            "dataset": payload["dataset_name"],
                            **{
                                group: [names[member] for member in payload[group]]
                                for group in ("train", "val", "test")
                            },
                        },
                    }
        return {"experiment": experiment, "resources": resources}

    def validate_details(self, identity: str) -> Record:
        value = self.validation_input(identity)
        config = value["experiment"]["native_config"]
        mate = config.get("mate")
        device = mate.get("device") if isinstance(mate, dict) else None
        if not isinstance(device, str) or re.fullmatch(r"cpu|cuda:\d+", device) is None:
            return {
                "valid": False,
                "errors": [
                    {
                        "error": "unsupported_device",
                        "path": "mate.device",
                        "message": "An explicit cpu or cuda:N device is required; auto is not supported",
                    }
                ],
                "warnings": [],
            }

        try:
            return self.training.validate(config, value["resources"])
        except DomainError as exc:
            if exc.symbol == "provider_unavailable":
                raise
            return {
                "valid": False,
                "errors": [{"error": exc.symbol, "message": exc.message, "details": exc.details}],
                "warnings": [],
            }

    def validate(self, identity: str) -> Record:
        result = self.validate_details(identity)
        return {key: result[key] for key in ("valid", "errors", "warnings")}
