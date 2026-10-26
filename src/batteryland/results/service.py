import hashlib
import json

from batteryland.common.errors import DomainError
from batteryland.common.file_contracts import ResultFiles
from batteryland.common.serialization import load_json
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.documents.contracts import DocumentStore
from batteryland.experiments.states import ACTIVE_STATES, TERMINAL_STATES
from batteryland.results.metrics import normalize_metrics, number


class ResultService:
    def __init__(
        self, units: UnitOfWorkFactory, documents: DocumentStore, files: ResultFiles
    ) -> None:
        self.units, self.documents, self.files = units, documents, files

    def ingest_external_result(self, identity: str, source: Record) -> Record:
        """Publish the final result file already stored in this experiment's run directory."""
        if source.get("kind") != "result" or source.get("name") != "best_result.json":
            raise DomainError("invalid_input", "The final result file is missing")
        relative_key = source.get("relative_key")
        if not isinstance(relative_key, str):
            raise DomainError("invalid_input", "The final result path is invalid")
        raw_content = self.files.read_result(relative_key)
        raw = load_json(raw_content)
        try:
            content = json.dumps(raw, ensure_ascii=False, allow_nan=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise DomainError("invalid_input", "Result must contain finite JSON values") from exc
        if len(content) > 16 * 1024 * 1024:
            raise DomainError("invalid_input", "Result exceeds 16 MiB")
        checksum = hashlib.sha256(content).hexdigest()
        file_checksum = hashlib.sha256(raw_content).hexdigest()
        if source.get("sha256") not in (None, file_checksum):
            raise DomainError("conflict", "The final result file changed while being collected")
        artifact_value = self._execution_artifact_value(identity, source)
        artifact_value["sha256"] = file_checksum
        artifact_value["size"] = len(raw_content)
        metrics = []
        predictions: list[Record] = []
        duplicate = False
        version = 1
        with self.units() as unit:
            experiment = unit.experiments.get(identity)
            original = unit.validated_inputs.get(identity)
            split = original["split"]
            metrics = normalize_metrics(raw, original["config"])
            allowed = {
                name for group in ("train", "val", "test") for name in split.get(group, [])
            }
            values = raw.get("test_predictions") or []
            if not isinstance(values, list):
                raise DomainError("invalid_input", "Predictions must be a list")
            seen: set[str] = set()
            for value in values:
                if (
                    not isinstance(value, dict)
                    or not isinstance(value.get("file_name"), str)
                    or not value["file_name"]
                    or value["file_name"] in seen
                ):
                    raise DomainError(
                        "invalid_input", "Predictions require unique battery file names"
                    )
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
            current = unit.results.get(identity)
            if current["head_document_id"]:
                reference = unit.documents.get(current["head_document_id"])
                previous = unit.documents.read(reference)["payload"]
                if previous.get("source_hash") == checksum:
                    duplicate = True
                    version = reference.version
                elif experiment["state"] not in ACTIVE_STATES:
                    raise DomainError(
                        "conflict", "A final result already exists for this experiment"
                    )
                else:
                    version = reference.version + 1

        payload = {
            "metrics": metrics,
            "predictions": predictions,
            "warnings": (
                ["Some prediction files are not in the validated split"]
                if any(value["file_name"] not in allowed for value in predictions)
                else []
            ),
            "source_hash": checksum,
            "original": raw,
        }
        with self.units() as unit:
            artifact = unit.artifacts.upsert(artifact_value)
            if duplicate:
                unit.results.set_source_artifact(identity, artifact["id"])
            else:
                document = unit.documents.publish("result", identity, version, payload)
                unit.results.publish(identity, document.id, artifact["id"], version, metrics)
        return self.get(identity)

    def ingest_external_metrics(self, identity: str, source: Record) -> None:
        if source.get("kind") != "metrics" or source.get("name") != "metrics.jsonl":
            raise DomainError("invalid_input", "The epoch metrics file is invalid")
        relative_key = source.get("relative_key")
        if not isinstance(relative_key, str):
            raise DomainError("invalid_input", "The epoch metrics path is invalid")
        artifact_value = self._execution_artifact_value(identity, source)
        with self.units() as unit:
            unit.experiments.get(identity)
            original = unit.validated_inputs.get(identity)
            artifact = unit.artifacts.upsert(artifact_value)
        self._ingest(identity, artifact, {"native_config": original["config"]})

    @staticmethod
    def _execution_artifact_value(identity: str, source: Record) -> Record:
        """Build a database record that points at a file in the run directory."""
        return {
            "experiment_id": identity,
            "component_id": None,
            "origin": "deeplatform_process",
            "kind": source["kind"],
            "name": source["name"],
            "relative_key": source["relative_key"],
            "sha256": source.get("sha256"),
            "size": source.get("size"),
            "availability": source.get("availability", "available"),
            "is_directory": False,
        }

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
