import hashlib
import json
import logging
import threading
import time

from batteryland.common.errors import DomainError
from batteryland.common.file_contracts import ResultFiles
from batteryland.common.serialization import load_json
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.documents.contracts import DocumentStore
from batteryland.experiments.states import TERMINAL_STATES
from batteryland.results.metrics import normalize_metrics, number

logger = logging.getLogger(__name__)


class ResultService:
    def __init__(
        self, units: UnitOfWorkFactory, documents: DocumentStore, files: ResultFiles
    ) -> None:
        self.units, self.documents, self.files = units, documents, files
        self._lock = threading.RLock()
        self._checked: dict[str, float] = {}

    def _context(self, identity: str) -> tuple[Record, Record, Record]:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            if not header["frozen_document_id"]:
                return header, {}, {}
            execution = unit.experiments.execution(identity)
            reference = unit.documents.get(header["frozen_document_id"])
        return header, execution, self.documents.read(reference)["payload"]

    def ingest_external_result(self, identity: str, raw: Record) -> Record:
        """Import a provider result delivered by the scheduler."""
        try:
            content = json.dumps(raw, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise DomainError("invalid_input", "Result must contain finite JSON values") from exc
        if len(content) > 16 * 1024 * 1024:
            raise DomainError("invalid_input", "Result exceeds 16 MiB")
        checksum = hashlib.sha256(content).hexdigest()
        duplicate = False
        with self.units() as unit:
            unit.experiments.get(identity)
            original = unit.validated_inputs.get(identity)
            current = unit.results.get(identity)
            if current["head_document_id"]:
                reference = unit.documents.get(current["head_document_id"])
                previous = unit.documents.read(reference)["payload"]
                if previous.get("source_hash") == checksum:
                    duplicate = True
                else:
                    raise DomainError(
                        "conflict", "A final result already exists for this experiment"
                    )
        if duplicate:
            return self.get(identity)
        config = original["config"]
        metrics = normalize_metrics(raw, config)
        allowed = {
            name for group in ("train", "val", "test") for name in original["split"].get(group, [])
        }
        values = raw.get("test_predictions") or []
        if not isinstance(values, list):
            raise DomainError("invalid_input", "Predictions must be a list")
        predictions: list[Record] = []
        seen: set[str] = set()
        for value in values:
            if (
                not isinstance(value, dict)
                or not isinstance(value.get("file_name"), str)
                or not value["file_name"]
                or value["file_name"] in seen
            ):
                raise DomainError("invalid_input", "Predictions require unique battery file names")
            name = value["file_name"]
            seen.add(name)
            predictions.append(
                {
                    "battery_id": f"unresolved:{identity}:{name}",
                    "file_name": name,
                    "prediction": number(value.get("prediction")),
                    "target": number(value.get("target")),
                    "granularity": raw.get("test_predictions_aggregation", "unknown"),
                }
            )
        archived = self.files.archive(identity, content)
        payload = {
            "metrics": metrics,
            "predictions": predictions,
            "warnings": (
                ["Some prediction files are not in the validated split"]
                if any(value["file_name"] not in allowed for value in predictions)
                else []
            ),
            "source_hash": archived["sha256"],
            "original": raw,
        }
        with self.units() as unit:
            document = unit.documents.publish("result", identity, 1, payload)
            artifact = unit.artifacts.upsert(archived | {"experiment_id": identity})
            unit.results.publish(identity, document.id, artifact["id"], 1, metrics)
        return self.get(identity)

    def ingest_external_log(self, identity: str, stream: str, offset: int, text: str) -> Record:
        if stream not in {"console", "train"}:
            raise DomainError("invalid_input", "Unknown log stream")
        with self.units() as unit:
            unit.experiments.get(identity)
        return self.files.append_report(identity, stream, offset, text.encode("utf-8"))

    def ingest_external_metrics(self, identity: str, offset: int, text: str) -> Record:
        with self.units() as unit:
            unit.experiments.get(identity)
            original = unit.validated_inputs.get(identity)
        cursor = self.files.append_report(identity, "metrics", offset, text.encode("utf-8"))
        artifact_value = {
            "origin": "worker_report",
            "kind": "metrics",
            "name": "metrics.jsonl",
            "relative_key": cursor["relative_key"],
            "sha256": None,
            "size": cursor["offset"],
            "availability": "available",
            "is_directory": False,
            "experiment_id": identity,
            "component_id": None,
        }
        with self.units() as unit:
            artifact = unit.artifacts.upsert(artifact_value)
        self._ingest(identity, artifact, {"native_config": original["config"]})
        return cursor

    def collect(self, identity: str) -> None:
        with self._lock:
            header, execution, snapshot = self._context(identity)
            prepared = execution.get("prepared") or {}
            directory = prepared.get("directory_ref")
            if not directory:
                return
            self._checked[identity] = time.monotonic()
            try:
                artifacts = self.files.scan(directory, header["state"] in TERMINAL_STATES)
                artifacts.extend(self.files.scan(f"inputs/{identity}", True))
                with self.units() as unit:
                    components = unit.artifacts.sync_components(
                        [
                            item | {"provider_commit": snapshot["provider_commit"]}
                            for item in snapshot.get("components", [])
                        ]
                    )
                    model = snapshot["native_config"].get("model", {})
                    model_type = (
                        str(model.get("type", "")).lower() if isinstance(model, dict) else ""
                    )
                    component_id = next(
                        (
                            item["id"]
                            for item in components
                            if item["scope"] == "model" and item["type"] == model_type
                        ),
                        None,
                    )
                    registered = [
                        unit.artifacts.upsert(
                            item
                            | {
                                "experiment_id": identity,
                                "component_id": component_id
                                if item["kind"] == "checkpoint"
                                else None,
                            }
                        )
                        for item in artifacts
                    ]
                errors = []
                for artifact in registered:
                    try:
                        if artifact["kind"] == "metrics":
                            self._ingest(identity, artifact, snapshot)
                        elif artifact["kind"] == "result":
                            self._import_result(identity, artifact, snapshot)
                    except (DomainError, OSError) as exc:
                        errors.append(f"{artifact['name']}: {exc}")
                if errors:
                    raise DomainError("invalid_input", "; ".join(errors))
                if not any(item["kind"] == "result" for item in registered):
                    with self.units() as unit:
                        if not unit.results.get(identity)["head_document_id"]:
                            unit.results.status(
                                identity, "unavailable", "Provider has not produced a final result"
                            )
            except (DomainError, OSError) as exc:
                logger.warning("Result collection failed for %s: %s", identity, exc)
                with self.units() as unit:
                    unit.results.status(identity, "error", str(exc))

    def collect_pending(self) -> None:
        # Persistent executions are the retry source, including a crash after a terminal transition.
        with self.units() as unit:
            records = unit.experiments.executions(TERMINAL_STATES)
        for record in records:
            if time.monotonic() - self._checked.get(record["id"], 0) >= 5:
                self.collect(record["id"])

    def _ingest(self, identity: str, artifact: Record, snapshot: Record) -> None:
        with self.units() as unit:
            cursor = unit.results.cursor(identity)
        batch = self.files.metrics_batch(artifact["relative_key"], cursor)
        metrics: list[Record] = []
        offset = batch["start_offset"]
        for line in batch["content"].splitlines(keepends=True):
            if line.strip():
                value = load_json(line)
                if value.get("epoch") is None:
                    raise DomainError("invalid_input", "Epoch metrics require an epoch")
                metrics.extend(
                    item
                    | {
                        "record_type": "epoch",
                        "source_artifact_id": artifact["id"],
                        "generation": batch["cursor"]["generation"],
                        "record_offset": offset,
                    }
                    for item in normalize_metrics(value, snapshot["native_config"])
                )
            offset += len(line)
        if batch["content"] or batch["reset"]:
            with self.units() as unit:
                unit.results.ingest(identity, batch["cursor"], metrics, batch["reset"])

    def _import_result(self, identity: str, artifact: Record, snapshot: Record) -> None:
        content = self.files.read_result(artifact["relative_key"])
        raw = load_json(content)
        archived = self.files.archive(identity, content)
        with self.units() as unit:
            current = unit.results.get(identity)
            old = (
                unit.documents.get(current["head_document_id"])
                if current["head_document_id"]
                else None
            )
            if old and self.documents.read(old)["payload"]["source_hash"] == archived["sha256"]:
                unit.results.status(identity, "available", None)
                return
        metrics = normalize_metrics(raw, snapshot["native_config"])
        names: dict[str, set[str]] = {}
        for split in snapshot.get("resources", {}).get("splits", {}).values():
            for partition in ("train", "val", "test"):
                for battery, name in zip(
                    split["payload"][partition], split["provider_split"][partition], strict=True
                ):
                    names.setdefault(name, set()).add(battery)
        predictions: list[Record] = []
        seen: set[str] = set()
        values = raw.get("test_predictions")
        values = [] if values is None else values
        if not isinstance(values, list):
            raise DomainError("invalid_input", "Predictions must be a list")
        aggregation = raw.get("test_predictions_aggregation", "unknown")
        if not isinstance(aggregation, str):
            raise DomainError("invalid_input", "Prediction aggregation must be a string")
        for value in values:
            if (
                not isinstance(value, dict)
                or not isinstance(value.get("file_name"), str)
                or not value["file_name"]
                or value["file_name"] in seen
            ):
                raise DomainError("invalid_input", "Predictions require unique battery file names")
            name = value["file_name"]
            seen.add(name)
            candidates = names.get(name, set())
            battery_id = (
                next(iter(candidates)) if len(candidates) == 1 else f"unresolved:{identity}:{name}"
            )
            predictions.append(
                {
                    "battery_id": battery_id,
                    "file_name": name,
                    "prediction": number(value.get("prediction")),
                    "target": number(value.get("target")),
                    "granularity": aggregation,
                }
            )
        warnings = (
            ["Some prediction identities could not be resolved; they are isolated by experiment"]
            if any(item["battery_id"].startswith("unresolved:") for item in predictions)
            else []
        )
        payload = {
            "metrics": metrics,
            "predictions": predictions,
            "warnings": warnings,
            "source_hash": archived["sha256"],
            "original": raw,
        }
        with self.documents.write_lock():
            with self.units() as unit:
                current = unit.results.get(identity)
                old = (
                    unit.documents.get(current["head_document_id"])
                    if current["head_document_id"]
                    else None
                )
            document = self.documents.publish(
                "result", identity, old.version + 1 if old else 1, payload
            )
            with self.units() as unit:
                source = unit.artifacts.upsert(archived | {"experiment_id": identity})
                unit.documents.add(document)
                unit.results.publish(identity, document.id, source["id"], document.version, metrics)

    def get(self, identity: str) -> Record:
        with self.units() as unit:
            unit.experiments.get(identity)
            result = unit.results.get(identity)
            reference = (
                unit.documents.get(result["head_document_id"])
                if result["head_document_id"]
                else None
            )
        payload = self.documents.read(reference)["payload"] if reference else {}
        return {
            "available": reference is not None,
            "version": reference.version if reference else None,
            "best_epoch": payload.get("original", {}).get("epoch"),
            "reason": result["error"],
            "metrics": payload.get("metrics", []),
            "predictions": payload.get("predictions", []),
            "warnings": payload.get("warnings", []),
            "sources": [
                {
                    "experiment_id": identity,
                    "result_version": reference.version,
                    "source_artifact_id": result["source_artifact_id"],
                    "source_hash": payload["source_hash"],
                }
            ]
            if reference
            else [],
        }

    def metrics(self, identity: str, filters: Record, page: int, page_size: int) -> Record:
        with self.units() as unit:
            unit.experiments.get(identity)
            return unit.results.metrics(identity, filters, page, page_size)

    def logs(self, identity: str, stream: str, cursor: str | None, limit: int) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            execution = unit.experiments.execution(identity) if header["frozen_document_id"] else {}
        directory = (execution.get("prepared") or {}).get("directory_ref")
        chunk = self.files.log_chunk(identity, directory, stream, cursor, limit)
        exhausted = chunk.pop("exhausted")
        return chunk | {
            "state": header["state"],
            "eof": exhausted and header["state"] in TERMINAL_STATES,
        }
