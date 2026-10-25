"""DeepPlatform validation and once-only process control in an isolated interpreter."""

import base64
import fcntl
import json
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from batteryland.application.validated_experiments import parse_inputs
from batteryland.config import Settings
from batteryland.domain.errors import DomainError
from batteryland.domain.validation_receipt import issue_receipt, verify_receipt
from batteryland.infrastructure.files import contained_path
from batteryland.infrastructure.results import LocalResultFiles
from batteryland.infrastructure.training.gateway import DeeplatformGateway
from batteryland.infrastructure.training.materializer import ExecutionMaterializer, publish_file


@dataclass(frozen=True)
class StartCommand:
    experiment_id: str
    intent_id: str
    resolved_device: str
    config_text: str
    split_text: str
    receipt: dict[str, Any]


def _builtin_split(provider_root: Path, split: dict[str, Any]) -> bool:
    folder = provider_root / "datasets/batteryLife/data_split"
    try:
        return any(json.loads(path.read_text()) == split for path in folder.glob("*.json"))
    except (OSError, ValueError) as exc:
        raise DomainError("provider_unavailable", "Provider split catalog cannot be read") from exc


class TrainingRunService:
    def __init__(self, settings: Settings, gateway: DeeplatformGateway) -> None:
        self.settings = settings
        self.gateway = gateway
        self.materializer = ExecutionMaterializer(settings.data_dir)
        self.files = LocalResultFiles(settings.data_dir)

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
        builtin = _builtin_split(self.settings.provider_root, split)
        limitations: list[str] = []
        supported = builtin
        if builtin:
            try:
                self._resources(split)
            except DomainError:
                supported = False
                limitations.append("source_files_missing_or_ambiguous")
        else:
            limitations.append("custom_split_unavailable")
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
        root = Path("/data/BatteryLife_Processed")
        wanted = {name for group in ("train", "val", "test") for name in split[group]}
        paths = {name: [] for name in wanted}
        for path in root.rglob("*.pkl"):
            if path.name in paths:
                paths[path.name].append(path)
        if any(len(candidates) != 1 for candidates in paths.values()):
            raise DomainError(
                "integration_precondition_failed", "Selected battery files are missing or ambiguous"
            )
        alias = next(
            (key for key, value in self.settings.source_roots.items() if value.resolve() == root),
            None,
        )
        if alias is None:
            raise DomainError(
                "integration_precondition_failed", "Provider data root is not configured"
            )
        batteries = [
            {"file_name": name, "relative_key": str(candidates[0].relative_to(root))}
            for name, candidates in paths.items()
        ]
        return {
            "kind": "train",
            "splits": {
                "split": {
                    "ref": {"id": "provider", "version": 1},
                    "provider_split": split,
                    "source": {"root_alias": alias},
                    "batteries": batteries,
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
            if not _builtin_split(self.settings.provider_root, split):
                raise DomainError("unsupported_capability", "Provider split has changed")
            current_components = self.gateway.components()
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
