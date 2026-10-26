"""Validated input workflow owned by the data service."""

import re
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_config, load_json
from batteryland.datasets.splits import SplitService
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.experiments.receipt import verify_receipt
from batteryland.experiments.states import ACTIVE_STATES
from batteryland.training.gateway import PROVIDER_COMMIT


def parse_inputs(config_text: str, split_text: str) -> tuple[Record, Record]:
    if len(config_text.encode("utf-8")) > 1024 * 1024:
        raise DomainError("invalid_input", "Configuration exceeds 1 MiB")
    if len(split_text.encode("utf-8")) > 8 * 1024 * 1024:
        raise DomainError("invalid_input", "Split exceeds 8 MiB")
    config = load_config(config_text.encode("utf-8"))
    split = load_json(split_text.encode("utf-8"))
    mate = config.get("mate")
    device = mate.get("device") if isinstance(mate, dict) else None
    if not isinstance(device, str) or re.fullmatch(r"auto|cuda:\d+", device) is None:
        raise DomainError("unsupported_device", "Only auto or explicit cuda:N is supported")
    if set(split) != {"dataset", "train", "val", "test"}:
        raise DomainError("invalid_input", "Split must contain only dataset, train, val and test")
    if not isinstance(split.get("dataset"), str) or not split["dataset"].strip():
        raise DomainError("invalid_input", "Split requires dataset, train, val and test")
    groups: list[list[str]] = []
    for name in ("train", "val", "test"):
        value = split.get(name)
        if not isinstance(value, list) or any(
            not isinstance(item, str)
            or not item.strip()
            or item != item.strip()
            or "\x00" in item
            or "\\" in item
            or PurePosixPath(item).name != item
            or item in {".", ".."}
            for item in value
        ):
            raise DomainError("invalid_input", "Split requires dataset, train, val and test")
        groups.append(value)
    members = [item for group in groups for item in group]
    if len(members) != len(set(members)):
        raise DomainError("invalid_input", "Split members overlap or repeat")
    return config, split


class ValidatedExperimentService:
    def __init__(self, units: UnitOfWorkFactory, secret: str, splits: SplitService) -> None:
        self.units = units
        self.secret = secret
        self.splits = splits

    def create(
        self,
        name: str,
        config_text: str,
        split_text: str,
        split_id: str,
        split_version: int,
        receipt: Record,
    ) -> Record:
        claims, config, split, binding = self._validated(
            config_text, split_text, split_id, split_version, receipt
        )
        identity = str(uuid4())
        query = self._query(config, split_id)
        with self.units() as unit:
            document = unit.documents.publish(
                "experiment_draft",
                identity,
                1,
                {"native_config": config, "bindings": {}},
            )
            unit.experiments.add(
                identity,
                {"name": name, "kind": "train"},
                document.id,
                self._references(binding["split_document_id"]),
                query,
            )
            unit.validated_inputs.add(
                identity,
                1,
                self._input_value(
                    config_text,
                    split_text,
                    split_id,
                    split_version,
                    config,
                    split,
                    receipt,
                    claims,
                ),
            )
        return self.get(identity)

    @staticmethod
    def _query(config: Record, split_id: str) -> Record:
        return {
            "source_id": None,
            "split_id": split_id,
            "model_type": config.get("model", {}).get("type")
            if isinstance(config.get("model"), dict)
            else None,
            "task_type": config.get("task", {}).get("type")
            if isinstance(config.get("task"), dict)
            else None,
            "requested_device": config["mate"]["device"],
            "source_domain": None,
            "target_domain": None,
        }

    @staticmethod
    def _references(split_document_id: str) -> Record:
        return {
            "split_document_id": split_document_id,
            "source_split_document_id": None,
            "target_split_document_id": None,
            "checkpoint_id": None,
        }

    def _validated(
        self,
        config_text: str,
        split_text: str,
        split_id: str,
        split_version: int,
        receipt: Record,
    ) -> tuple[Record, Record, Record, Record]:
        binding = self.splits.execution_binding(split_id, split_version)
        claims = verify_receipt(
            receipt,
            config_text,
            split_text,
            self.secret,
            split_ref={"id": split_id, "version": split_version},
        )
        if claims["provider_commit"] != PROVIDER_COMMIT:
            raise DomainError("integration_precondition_failed", "Provider revision has changed")
        config, split = parse_inputs(config_text, split_text)
        if split != binding["provider_split"]:
            raise DomainError("invalid_input", "Experiment split differs from its saved version")
        return claims, config, split, binding

    @staticmethod
    def _input_value(
        config_text: str,
        split_text: str,
        split_id: str,
        split_version: int,
        config: Record,
        split: Record,
        receipt: Record,
        claims: Record,
    ) -> Record:
        return {
            "config_text": config_text,
            "split_text": split_text,
            "split_id": split_id,
            "split_version": split_version,
            "config_sha256": claims["config_sha256"],
            "split_sha256": claims["split_sha256"],
            "config": config,
            "split": split,
            "receipt": receipt,
            "provider_commit": claims["provider_commit"],
        }

    def update(
        self,
        identity: str,
        expected_revision: int,
        name: str,
        config_text: str,
        split_text: str,
        split_id: str,
        split_version: int,
        receipt: Record,
    ) -> Record:
        claims, config, split, binding = self._validated(
            config_text, split_text, split_id, split_version, receipt
        )
        with self.units() as unit:
            header = unit.experiments.get(identity)
            unit.validated_inputs.get(identity)
            if header["state"] != "draft" or header["revision"] != expected_revision:
                raise DomainError("conflict", "Validated draft changed or was submitted")
            document = unit.documents.publish(
                "experiment_draft",
                identity,
                expected_revision + 1,
                {"native_config": config, "bindings": {}},
            )
            unit.experiments.update(
                identity,
                expected_revision,
                {"name": name, "kind": "train"},
                document.id,
                self._references(binding["split_document_id"]),
                self._query(config, split_id),
            )
            unit.validated_inputs.add(
                identity,
                expected_revision + 1,
                self._input_value(
                    config_text,
                    split_text,
                    split_id,
                    split_version,
                    config,
                    split,
                    receipt,
                    claims,
                ),
            )
        return self.get(identity)

    def get(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            value = unit.validated_inputs.get(identity, version)
        return {
            "id": identity,
            "name": header["name"],
            "state": header["state"],
            "revision": header["revision"],
            "requested_device": header["requested_device"],
            "resolved_device": header["effective_device"],
            "actual_device": header["actual_device"],
            "actual_gpu_uuid": header["actual_gpu_uuid"],
            **value,
        }

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.experiments.delete(identity)
        return {"deleted": True}

    def list(self, filters: Record, page: int, page_size: int) -> Record:
        with self.units() as unit:
            result = unit.experiments.list_experiments(filters, page, page_size)
        return {**result, "items": [self._summary(item) for item in result["items"]]}

    @staticmethod
    def _summary(value: Record) -> Record:
        return {
            key: item
            for key, item in value.items()
            if not key.startswith("_")
            and not key.endswith("_document_id")
            and key != "checkpoint_id"
        }

    def queue(self) -> Record:
        with self.units() as unit:
            waiting = unit.experiments.executions({"queued"})
            active = unit.experiments.executions(ACTIVE_STATES)
        paused = any(item["state"] == "needs_reconciliation" for item in active)
        return {
            "waiting": [self._summary(item) for item in waiting],
            "active": [self._summary(item) for item in active],
            "dispatch_paused": paused,
            "reason": "Execution identity requires reconciliation" if paused else None,
        }

    def members(
        self, identity: str, version: int | None, partition: str | None, page: int, page_size: int
    ) -> Record:
        with self.units() as unit:
            return unit.validated_inputs.members(identity, version, partition, page, page_size)

    def submit(self, identity: str) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            value = unit.validated_inputs.get(identity)
            if header["state"] == "draft":
                if not value["receipt"]["execution_supported"]:
                    raise DomainError(
                        "unsupported_capability",
                        "The provider cannot train with this custom split yet",
                    )
                unit.experiments.enqueue(
                    identity,
                    header["revision"],
                    header["draft_document_id"],
                    value["config"]["mate"]["device"],
                    str(uuid4()),
                )
            elif header["state"] not in {
                "queued",
                "starting",
                "running",
                "stopping",
                "needs_reconciliation",
            }:
                raise DomainError("conflict", "A finished experiment cannot run again")
        return self.get(identity)

    def stop(self, identity: str) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            state = header["state"]
            requested_at = datetime.now(UTC).isoformat()
            if state == "queued":
                changed = unit.experiments.transition(
                    identity, {state}, "cancelled", {"stop_requested_at": requested_at}
                )
            elif state in {"starting", "running"}:
                changed = unit.experiments.transition(
                    identity, {state}, "stopping", {"stop_requested_at": requested_at}
                )
            elif state == "stopping":
                changed = True
            elif state == "needs_reconciliation":
                raise DomainError(
                    "needs_reconciliation", "Verify the original process before stopping"
                )
            else:
                raise DomainError("conflict", "Only queued or active experiments can be stopped")
            if not changed:
                raise DomainError("conflict", "Experiment state changed while stopping")
        return self.get(identity)
