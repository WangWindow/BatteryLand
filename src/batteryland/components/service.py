import threading
from pathlib import Path
from typing import BinaryIO

from batteryland.common.errors import DomainError
from batteryland.common.file_contracts import ArtifactFiles
from batteryland.db.contracts import Record, UnitOfWorkFactory
from batteryland.training.contracts import ComponentGateway


class ArtifactService:
    def __init__(
        self,
        units: UnitOfWorkFactory,
        provider: ComponentGateway,
        files: ArtifactFiles,
        checkpoint_limit: int,
    ) -> None:
        self.units = units
        self.provider = provider
        self.files = files
        self.checkpoint_limit = checkpoint_limit
        self._registry_lock = threading.RLock()

    def components(self, scope: str | None = None) -> list[Record]:
        with self._registry_lock:
            values = self.provider.components(scope)
            with self.units() as unit:
                return unit.artifacts.sync_components(values)

    def schema(self, scope: str, name: str) -> Record:
        values = self.provider.components(scope)
        value = next((item for item in values if item["type"] == name.lower()), None)
        if value is None:
            raise DomainError("not_found", "Component not found")
        descriptor = self.provider.schema(scope, name)
        with self._registry_lock, self.units() as unit:
            unit.artifacts.sync_components([value | {"schema": descriptor}])
        return descriptor

    def upload_component(self, scope: str, filename: str, content: bytes) -> Record:
        with self._registry_lock:
            uploaded = self.provider.upload(scope, filename, content)
            names = {(item["scope"], item["type"]) for item in uploaded["components"]}
            all_components = self.components(scope)
        return {
            "activation": uploaded["activation"],
            "sha256": uploaded["sha256"],
            "components": [
                item for item in all_components if (item["scope"], item["type"]) in names
            ],
        }

    @staticmethod
    def public(value: Record) -> Record:
        return {key: item for key, item in value.items() if key != "relative_key"}

    def upload_checkpoint(
        self, component_id: str, source_experiment_id: str | None, filename: str, stream: BinaryIO
    ) -> Record:
        with self.units() as unit:
            component = unit.artifacts.component(component_id)
            if component["scope"] != "model":
                raise DomainError("invalid_input", "Weights must reference a model component")
            if source_experiment_id:
                unit.experiments.get(source_experiment_id)
        value = self.files.save(stream, filename, self.checkpoint_limit)
        with self.units() as unit:
            value = unit.artifacts.add(
                value
                | {
                    "component_id": component_id,
                    "experiment_id": source_experiment_id,
                    "kind": "checkpoint",
                    "origin": "upload",
                }
            )
        return self.public(value)

    def upload_execution_artifact(
        self,
        experiment_id: str,
        filename: str,
        kind: str,
        expected_sha256: str,
        stream: BinaryIO,
    ) -> Record:
        if kind not in {"checkpoint", "config", "file", "status", "input_manifest"}:
            raise DomainError("invalid_input", "Unknown execution artifact kind")
        with self.units() as unit:
            unit.experiments.get(experiment_id)
        value = self.files.save_execution(
            experiment_id, stream, filename, expected_sha256, self.checkpoint_limit
        )
        with self.units() as unit:
            stored = unit.artifacts.upsert(
                value
                | {
                    "component_id": None,
                    "experiment_id": experiment_id,
                    "kind": kind,
                    "origin": "deeplatform_process",
                }
            )
        return self.public(stored)

    def checkpoints(self, filters: Record, page: int, page_size: int) -> Record:
        with self.units() as unit:
            result = unit.artifacts.checkpoints(filters, page, page_size)
        result["items"] = [self.public(value) for value in result["items"]]
        return result

    def for_experiment(self, identity: str) -> list[Record]:
        with self.units() as unit:
            unit.experiments.get(identity)
            return [self.public(value) for value in unit.artifacts.for_experiment(identity)]

    def download(self, identity: str) -> tuple[Path, str]:
        with self.units() as unit:
            value = unit.artifacts.get(identity)
        if value["is_directory"]:
            raise DomainError(
                "invalid_input", "Select a registered file inside the artifact directory"
            )
        return self.files.resolve(value["relative_key"]), value["name"]

    def capabilities(self) -> list[Record]:
        return self.provider.capabilities() + [
            {
                "provider_id": "scheduler-local/v1",
                "version": "1",
                "available": True,
                "supported_operations": ["fifo", "claim", "observe", "stop", "auto_gpu"],
                "limitations": ["single active execution", "GPU training only"],
            },
            {
                "provider_id": "basic-difference/v1",
                "version": "1",
                "available": True,
                "supported_operations": ["counts", "overlap", "category_distribution"],
                "limitations": ["registered metadata only"],
            },
            {
                "provider_id": "basic-charts/v1",
                "version": "1",
                "available": True,
                "supported_operations": [
                    "metric_bar",
                    "epoch_line",
                    "prediction_scatter",
                    "set_count_bar",
                    "category_bar",
                    "overlap_bar",
                ],
                "limitations": ["unknown units are isolated", "declarative data only"],
            },
        ]
