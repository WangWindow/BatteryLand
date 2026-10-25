"""DeepPlatform validation and once-only process control in an isolated interpreter."""

import base64
import fcntl
import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from batteryland.common.errors import DomainError
from batteryland.common.storage import contained_path
from batteryland.config import Settings
from batteryland.experiments.receipt import issue_receipt, verify_receipt
from batteryland.experiments.validated import parse_inputs
from batteryland.results.storage import LocalResultFiles
from batteryland.training.gateway import DeeplatformGateway
from batteryland.training.materializer import ExecutionMaterializer, publish_file
from batteryland.training.resources import BatteryFileResolver
from batteryland.training.split_support import (
    CUSTOM_BATTERY_FACTORY,
    battery_factory,
    execution_support,
)


@dataclass(frozen=True)
class StartCommand:
    experiment_id: str
    intent_id: str
    resolved_device: str
    config_text: str
    split_text: str
    receipt: dict[str, Any]


class TrainingRunService:
    def __init__(self, settings: Settings, gateway: DeeplatformGateway) -> None:
        self.settings = settings
        self.gateway = gateway
        self.materializer = ExecutionMaterializer(settings.data_dir)
        self.files = LocalResultFiles(settings.data_dir)
        self.file_resolver = BatteryFileResolver(settings.source_roots)

    def validate(self, config_text: str, split_text: str) -> dict[str, Any]:
        config, split = parse_inputs(config_text, split_text)
        commit = self.gateway.identity()
        provider = self.gateway.validate_structure(config)
        if not provider.get("valid"):
            raise DomainError("invalid_input", "Provider rejected the configuration")
        components = provider.get("components", [])
        versions = [
            f"{item['scope']}:{item['type']}:{item['source_hash']}"
            for item in components
            if isinstance(item, dict) and item.get("source_hash")
        ]
        supported, limitations = execution_support(config, split, self.gateway.runtime)
        try:
            self._resources(split)
        except DomainError:
            supported = False
            limitations = [*limitations, "source_files_missing_or_ambiguous"]
        if not self.settings.validation_secret:
            raise DomainError("provider_unavailable", "Validation signing is not configured")
        receipt = issue_receipt(
            config_text,
            split_text,
            commit,
            versions,
            self.settings.validation_secret,
            execution_supported=supported,
        )
        return {
            "valid": True,
            "config": config,
            "split": split,
            "receipt": receipt,
            "execution_supported": supported,
            "limitations": limitations,
        }

    def _resources(self, split: dict[str, Any]) -> dict[str, Any]:
        resolved = self.file_resolver.resolve(
            [name for group in ("train", "val", "test") for name in split[group]]
        )
        return {
            "kind": "train",
            "splits": {
                "split": {
                    "ref": {"id": "provider", "version": 1},
                    "provider_split": split,
                    **resolved,
                }
            },
        }

    def start(self, body: StartCommand) -> dict[str, Any]:
        claims = verify_receipt(
            body.receipt,
            body.config_text,
            body.split_text,
            self.settings.validation_secret,
            max_age_seconds=None,
        )
        if not claims["execution_supported"]:
            raise DomainError("unsupported_capability", "Provider cannot execute this split")
        config, split = parse_inputs(body.config_text, body.split_text)
        current_components = self.gateway.components()
        supported, _ = execution_support(config, split, self.gateway.runtime)
        if not supported:
            raise DomainError(
                "unsupported_capability", "Training components cannot execute this split"
            )
        requested = config["mate"]["device"]
        device = body.resolved_device
        if not device.startswith("cuda:") or not device[5:].isdigit():
            raise DomainError("unsupported_device", "Resolved device must be cuda:N")
        if requested != "auto" and requested != device:
            raise DomainError("unsupported_device", "Explicit CUDA device cannot be remapped")
        identity = str(body.experiment_id)
        intent = str(body.intent_id)
        directory = self.settings.data_dir / "inputs" / identity
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / ".start.lock").open("ab") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            marker_path = directory / "start-intent.json"
            receipt_path = directory / "process-receipt.json"
            marker = {
                "experiment_id": identity,
                "intent_id": intent,
                "config_sha256": claims["config_sha256"],
                "split_sha256": claims["split_sha256"],
                "resolved_device": device,
            }
            if marker_path.exists():
                if json.loads(marker_path.read_text()) != marker:
                    raise DomainError("conflict", "Experiment ID already belongs to another run")
                if receipt_path.exists():
                    return json.loads(receipt_path.read_text())
                raise DomainError(
                    "needs_reconciliation", "A start was issued but no process receipt is available"
                )
            if claims["provider_commit"] != self.gateway.identity():
                raise DomainError(
                    "integration_precondition_failed", "Provider revision has changed"
                )
            versions = sorted(
                f"{item['scope']}:{item['type']}:{item['source_hash']}"
                for item in current_components
                if item.get("source_hash")
            )
            if versions != claims["component_versions"]:
                raise DomainError(
                    "integration_precondition_failed", "Provider components have changed"
                )
            derived = deepcopy(config)
            derived["mate"]["device"] = device
            factory = battery_factory(derived)
            if (
                factory is not None
                and str(factory.get("type", "")).casefold() == CUSTOM_BATTERY_FACTORY
            ):
                factory.setdefault("params", {})["split_file"] = str(
                    (directory / "split.json").resolve()
                )
            execution_check = self.gateway.validate_structure(derived)
            if not execution_check.get("valid"):
                raise DomainError(
                    "integration_precondition_failed",
                    "Resolved execution input is no longer valid",
                )
            resources = self._resources(split)
            publish_file(marker_path, json.dumps(marker, sort_keys=True).encode())
            snapshot = {
                "native_config": derived,
                "resources": resources,
                "provider_commit": claims["provider_commit"],
                "components": current_components,
                "requested_device": requested,
            }
            materialized = self.materializer.materialize(identity, intent, snapshot)
            prepared = self.gateway.prepare(materialized)
            self.materializer.record_receipt(identity, "prepare", prepared)
            process = self.gateway.spawn(prepared)
            self.materializer.record_receipt(identity, "process", process)
            return process

    def _receipt(self, experiment_id: str) -> dict[str, Any]:
        path = self.settings.data_dir / "inputs" / experiment_id / "process-receipt.json"
        if not path.is_file():
            raise DomainError("needs_reconciliation", "No process receipt is available")
        value = json.loads(path.read_text())
        if value.get("experiment_id") != experiment_id:
            raise DomainError("needs_reconciliation", "Process receipt identity differs")
        return value

    def status(self, experiment_id: str) -> dict[str, Any]:
        receipt = self._receipt(experiment_id)
        return {
            "experiment_id": experiment_id,
            "receipt": receipt,
            "observation": self.gateway.observe(receipt),
        }

    def stop(self, experiment_id: str, stage: str) -> dict[str, Any]:
        if stage not in {"interrupt", "terminate", "kill"}:
            raise DomainError("invalid_input", "Unknown stop stage")
        receipt = self._receipt(experiment_id)
        return {"experiment_id": experiment_id, "observation": self.gateway.signal(receipt, stage)}

    def outputs(
        self, experiment_id: str, console_cursor: str | None, metrics_offset: int
    ) -> dict[str, Any]:
        receipt = self._receipt(experiment_id)
        directory = receipt["directory_ref"]
        log = self.files.log_chunk(experiment_id, directory, "console", console_cursor, 65536)
        base = self.settings.data_dir / directory
        result_path = base / "best_result.json"
        result = (
            json.loads(self.files.read_result(str(result_path.relative_to(self.settings.data_dir))))
            if result_path.is_file()
            else None
        )
        metrics_path = base / "metrics.jsonl"
        metric_text = ""
        next_offset = metrics_offset
        if metrics_path.is_file():
            with metrics_path.open("rb") as source:
                source.seek(metrics_offset)
                chunk = source.read(256 * 1024)
            complete = chunk.rfind(b"\n") + 1
            metric_text = chunk[:complete].decode("utf-8")
            next_offset += complete
        return {
            "experiment_id": experiment_id,
            "console": log,
            "console_start_offset": (
                json.loads(base64.urlsafe_b64decode(console_cursor))["offset"]
                if console_cursor
                else 0
            ),
            "metrics_text": metric_text,
            "metrics_next_offset": next_offset,
            "result": result,
            "artifacts": self.files.scan(directory, not self.gateway.observe(receipt)["alive"]),
        }

    def artifact(self, experiment_id: str, relative_key: str) -> Path:
        receipt = self._receipt(experiment_id)
        directory = receipt["directory_ref"]
        allowed = {item["relative_key"] for item in self.files.scan(directory, terminal=True)}
        if relative_key not in allowed:
            raise DomainError("not_found", "Execution artifact not found")
        path = contained_path(self.settings.data_dir, relative_key)
        if not path.is_file() or path.is_symlink():
            raise DomainError("not_found", "Execution artifact is unavailable")
        return path
