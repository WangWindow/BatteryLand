"""Adapt static component operations and independently configured training workers."""

import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from copy import deepcopy
from pathlib import Path
from typing import cast

import yaml

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.db.contracts import Record
from batteryland.scheduler.processes import ProcessSupervisor
from batteryland.training.materializer import publish_file
from batteryland.training.plugin_runtime import initialize_runtime
from batteryland.training.resources import BatteryFileResolver
from batteryland.training.runtime import TrainingRuntime
from batteryland.training.split_support import (
    BUILTIN_BATTERY_FACTORY,
    CUSTOM_BATTERY_FACTORY,
    battery_factory,
    configured_dataset,
    is_builtin_split,
)

PROVIDER_COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"


class DeeplatformGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = settings.data_dir.resolve() / "plugins"
        self.supervisor = ProcessSupervisor()
        self.worker = TrainingRuntime(settings.training_python)
        self._component_lock = threading.Lock()
        self._component_snapshot: tuple[str, list[Record]] | None = None
        self._runtime_lock = threading.Lock()
        self._runtime_initialized = False
        self.file_resolver = BatteryFileResolver(settings.source_roots)

    def identity(self) -> str:
        try:
            result = subprocess.run(
                ["git", "-C", str(self.settings.provider_root), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=5,
                check=True,
            )
            dirty = subprocess.run(
                ["git", "-C", str(self.settings.provider_root), "diff", "--quiet", "HEAD"],
                capture_output=True,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise DomainError(
                "provider_unavailable", "Training provider checkout cannot be verified"
            ) from exc
        if result.stdout.strip() != PROVIDER_COMMIT or dirty.returncode != 0:
            raise DomainError(
                "integration_precondition_failed",
                "Training provider revision or tracked source has changed",
            )
        return PROVIDER_COMMIT

    def environment(self) -> dict[str, str]:
        return {
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONPATH": os.pathsep.join([str(self.runtime), str(self.settings.provider_root)]),
            "XDG_CACHE_HOME": str(self.settings.data_dir / "cache"),
            "MPLCONFIGDIR": str(self.settings.data_dir / "cache/matplotlib"),
            "HF_HOME": str(self.settings.data_dir / "cache/huggingface"),
            "WANDB_DIR": str(self.settings.data_dir / "cache/wandb"),
        }

    def _ensure_runtime(self) -> None:
        if self._runtime_initialized:
            return
        with self._runtime_lock:
            if self._runtime_initialized:
                return
            self.identity()
            initialize_runtime(self.settings.provider_root, self.runtime, PROVIDER_COMMIT)
            self._runtime_initialized = True

    def _control(self, operation: str, arguments: Record) -> object:
        self._ensure_runtime()
        self.identity()
        static = operation in {"inspect", "upload"}
        expected_runtime = (
            {
                "executable": sys.executable,
                "prefix": sys.prefix,
                "python_version": sys.version.split()[0],
            }
            if static
            else self.worker.identity()
        )
        request = {
            "schema_version": 1,
            "operation": operation,
            "provider_root": str(self.settings.provider_root.resolve()),
            "runtime_root": str(self.runtime),
        } | arguments
        try:
            result = subprocess.run(
                [expected_runtime["executable"], str(Path(__file__).with_name("bridge.py"))],
                input=json.dumps(request, allow_nan=False),
                text=True,
                capture_output=True,
                timeout=30,
                env=(
                    os.environ | self.environment()
                    if static
                    else self.worker.environment(self.environment())
                ),
            )
            response = json.loads(result.stdout)
        except subprocess.TimeoutExpired as exc:
            symbol = (
                "needs_reconciliation"
                if operation in {"prepare", "upload"}
                else "provider_unavailable"
            )
            raise DomainError(symbol, "Training control operation timed out") from exc
        except (OSError, ValueError) as exc:
            raise DomainError(
                "provider_unavailable", "Training control response was unavailable"
            ) from exc
        if not isinstance(response, dict) or response.get("runtime") != expected_runtime:
            raise DomainError(
                "needs_reconciliation"
                if operation in {"prepare", "upload"}
                else "provider_unavailable",
                "Worker environment does not match the selected environment",
            )
        if not response.get("ok"):
            error = response.get("error", {})
            raise DomainError(
                error.get("symbol", "provider_unavailable"),
                error.get("message", "Training control failed"),
            )
        data = response["data"]
        if operation == "prepare" and (
            not isinstance(data, dict) or data.get("runtime") != expected_runtime
        ):
            raise DomainError(
                "needs_reconciliation",
                "Prepared environment does not match the selected environment",
            )
        return data

    def components(self, scope: str | None = None) -> list[Record]:
        with self._component_lock:
            self._ensure_runtime()
            self.identity()
            digest = hashlib.sha256()
            try:
                digest.update(os.fsencode(self.runtime) + b"\0")
                for folder in ("components", "task"):
                    for path in sorted((self.runtime / folder).rglob("*.py")):
                        digest.update(os.fsencode(path.relative_to(self.runtime)) + b"\0")
                        digest.update(hashlib.sha256(path.read_bytes()).digest())
            except OSError as exc:
                raise DomainError(
                    "provider_unavailable", "Component sources cannot be read"
                ) from exc
            fingerprint = digest.hexdigest()
            if self._component_snapshot is None or self._component_snapshot[0] != fingerprint:
                values = cast(list[Record], self._control("inspect", {}))
                self._component_snapshot = (fingerprint, values)
            result = deepcopy(self._component_snapshot[1])
        return [
            item | {"provider_commit": PROVIDER_COMMIT}
            for item in result
            if scope is None or item["scope"] == scope.lower()
        ]

    def schema(self, scope: str, name: str) -> Record:
        return cast(Record, self._control("catalog", {"scope": scope, "type": name}))

    def upload(self, scope: str, filename: str, content: bytes) -> Record:
        with self._component_lock:
            result = cast(
                Record,
                self._control(
                    "upload",
                    {
                        "scope": scope,
                        "filename": filename,
                        "content": base64.b64encode(content).decode(),
                        "limit": self.settings.component_limit,
                    },
                ),
            )
            self._component_snapshot = None
            return result

    def validate_structure(self, config: Record) -> Record:
        """Ask the provider to check a complete user configuration."""
        return cast(Record, self._control("validate", {"config": config}))

    def _preflight(
        self,
        config: Record,
        resources: Record,
        *,
        expected_split_path: Path | None = None,
        expected_experiment_id: str | None = None,
    ) -> None:
        mate = config.get("mate")
        device = mate.get("device") if isinstance(mate, dict) else None
        if not isinstance(device, str) or not re.fullmatch(r"cpu|cuda:\d+", device):
            raise DomainError("unsupported_device", "An explicit cpu or cuda:N device is required")
        if resources.get("kind", "train") != "train":
            raise DomainError(
                "unsupported_capability",
                "Dedicated evaluation and transfer tasks are not yet declared by this provider",
            )
        factory = battery_factory(config)
        selected = resources.get("splits", {}).get("split")
        if factory is None:
            if not selected:
                return
            reference = selected.get("provider_split")
            if not isinstance(reference, dict) or not is_builtin_split(self.runtime, reference):
                raise DomainError(
                    "unsupported_capability",
                    "Custom BatteryLife splits require BatteryLandBatteryLifeDatasetFactory",
                )
            return
        if not selected:
            raise DomainError(
                "integration_precondition_failed",
                "Register and bind a dataset split before execution",
            )
        reference = selected.get("provider_split")
        if not isinstance(reference, dict):
            raise DomainError("invalid_input", "Split resource has no provider split")

        builtin = is_builtin_split(self.runtime, reference)
        parameters = factory.get("params", {})
        if not isinstance(parameters, dict):
            raise DomainError("invalid_input", "Factory params must be an object")
        if configured_dataset(config, factory) != reference.get("dataset"):
            raise DomainError("invalid_input", "Config dataset must match the split dataset")
        factory_type = str(factory.get("type", "")).casefold()
        if factory_type == BUILTIN_BATTERY_FACTORY and not builtin:
            raise DomainError(
                "unsupported_capability",
                "Custom splits require BatteryLandBatteryLifeDatasetFactory",
            )
        if factory_type == CUSTOM_BATTERY_FACTORY:
            split_file = parameters.get("split_file")
            if expected_split_path is None:
                if split_file is not None:
                    raise DomainError(
                        "invalid_input", "split_file is managed by the training service"
                    )
            else:
                expected = expected_split_path
                managed_root = self.settings.data_dir.resolve() / "inputs"
                managed_experiment = (
                    managed_root / expected_experiment_id if expected_experiment_id else None
                )
                if (
                    split_file != str(expected)
                    or expected.is_symlink()
                    or managed_experiment is None
                    or expected != managed_experiment / "split.json"
                    or not expected.resolve().is_relative_to(managed_experiment)
                ):
                    raise DomainError(
                        "integration_precondition_failed",
                        "Execution config does not reference its managed split file",
                    )
                try:
                    readable = (
                        expected.is_file()
                        and not (expected.stat().st_mode & 0o222)
                        and json.loads(expected.read_text(encoding="utf-8")) == reference
                    )
                except OSError, ValueError:
                    readable = False
                if not readable:
                    raise DomainError(
                        "integration_precondition_failed",
                        "Managed split file is missing, writable or differs from the validated split",
                    )
        if any(not reference.get(group) for group in ("train", "val", "test")):
            raise DomainError(
                "invalid_input",
                "BatteryLife training requires nonempty train, val and test groups",
            )

        wanted = [member for group in ("train", "val", "test") for member in reference[group]]
        expected_resources = self.file_resolver.resolve(wanted)
        if (
            selected.get("source") != expected_resources["source"]
            or selected.get("batteries") != expected_resources["batteries"]
        ):
            raise DomainError(
                "integration_precondition_failed",
                "Registered resource references do not match the configured data source",
            )

    def validate(self, config: Record, resources: Record) -> Record:
        self._ensure_runtime()
        self._preflight(config, resources)
        result = cast(Record, self._control("validate", {"config": config}))
        return result | {"provider_commit": PROVIDER_COMMIT}

    def prepare(self, materialized: Record) -> Record:
        self._ensure_runtime()
        snapshot = materialized["snapshot"]
        if self.identity() != snapshot["provider_commit"]:
            raise DomainError(
                "integration_precondition_failed", "Provider changed after submission"
            )
        split_info = materialized.get("splits", {}).get("split")
        selected_factory = battery_factory(snapshot["native_config"])
        local_adapter = (
            selected_factory is not None
            and str(selected_factory.get("type", "")).casefold() == CUSTOM_BATTERY_FACTORY
        )
        if local_adapter and not split_info:
            raise DomainError(
                "integration_precondition_failed", "BatteryLand training split was not materialized"
            )
        self._preflight(
            snapshot["native_config"],
            snapshot["resources"],
            expected_split_path=Path(split_info["path"]) if local_adapter else None,
            expected_experiment_id=materialized["experiment_id"] if local_adapter else None,
        )
        current = {(item["scope"], item["type"]): item["source_hash"] for item in self.components()}
        for item in snapshot["components"]:
            if current.get((item["scope"], item["type"])) != item["source_hash"]:
                raise DomainError(
                    "integration_precondition_failed", "Component source changed after submission"
                )
        config = deepcopy(snapshot["native_config"])
        config["mate"]["experiment"] = materialized["experiment_id"]
        config["mate"]["experiment_root"] = str(self.settings.data_dir.resolve() / "runs")
        factories = config.get("datafactory", [])
        for factory in factories if isinstance(factories, list) else [factories]:
            if not isinstance(factory, dict) or str(factory.get("type", "")).casefold() not in {
                BUILTIN_BATTERY_FACTORY,
                CUSTOM_BATTERY_FACTORY,
            }:
                continue
            workspace = (
                self.settings.data_dir.resolve() / "data-workspaces" / materialized["experiment_id"]
            )
            for folder in ["Life labels", "seen_unseen_labels"]:
                (workspace / folder).mkdir(parents=True, exist_ok=True)
                for path in (self.runtime / "datasets/batteryLife" / folder).glob("*.json"):
                    target = workspace / folder / path.name
                    if not target.exists():
                        shutil.copyfile(path, target)
            factory.setdefault("params", {})["root_path"] = str(workspace)
        path = Path(materialized["config_path"]).with_name("provider-input.yaml")
        publish_file(path, yaml.safe_dump(config, allow_unicode=True, sort_keys=False).encode())
        prepared = cast(
            Record,
            self._control(
                "prepare",
                {"config_path": str(path), "experiment_id": materialized["experiment_id"]},
            ),
        )
        directory = Path(prepared["directory"]).resolve()
        if not directory.is_relative_to(self.settings.data_dir.resolve() / "runs"):
            raise DomainError(
                "needs_reconciliation", "Provider output directory is outside the managed root"
            )
        selected = snapshot["resources"]["splits"]["split"]
        alias = selected["source"]["root_alias"]
        root = self.settings.source_roots.get(alias)
        if root is None:
            raise DomainError(
                "integration_precondition_failed", "Configured battery data source disappeared"
            )
        return prepared | {
            "intent_id": materialized["intent_id"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
            "provider_config_sha256": prepared["config_sha256"],
            "directory_ref": str(directory.relative_to(self.settings.data_dir.resolve())),
            "requested_device": config["mate"]["device"],
            "provider_commit": PROVIDER_COMMIT,
            "data_source_root": str(root.resolve()),
        }

    def spawn(self, prepared: Record) -> Record:
        if self.identity() != prepared["provider_commit"]:
            raise DomainError(
                "integration_precondition_failed", "Provider changed after preparation"
            )
        if prepared.get("runtime") != self.worker.identity():
            raise DomainError(
                "integration_precondition_failed",
                "Training environment changed after preparation",
            )
        directory = Path(prepared["directory"])
        environment = self.worker.environment(self.environment())
        if prepared.get("data_source_root"):
            environment["BATTERYLAND_DATA_ROOT"] = prepared["data_source_root"]
        receipt = self.supervisor.start(
            [
                str(self.worker.python),
                "-u",
                str(self.settings.provider_root.resolve() / "main.py"),
                "--experiment-dir",
                str(directory),
            ],
            directory,
            prepared["experiment_id"],
            cwd=self.runtime,
            environment=environment,
        )
        return receipt | {
            "intent_id": prepared["intent_id"],
            "input_manifest_sha256": prepared["input_manifest_sha256"],
            "provider_config_sha256": prepared["provider_config_sha256"],
            "directory_ref": prepared["directory_ref"],
            "requested_device": prepared["requested_device"],
            "effective_device": None,
            "provider_commit": PROVIDER_COMMIT,
            "runtime": prepared["runtime"],
        }

    def observe(self, receipt: Record) -> Record:
        return self.supervisor.observe(receipt)

    def signal(self, receipt: Record, stage: str) -> Record:
        return self.supervisor.signal(receipt, stage)

    def capabilities(self) -> list[Record]:
        available = False
        reason = "Training dependencies are unavailable in the current environment"
        try:
            self.identity()
            self._control("catalog", {})
            available = True
            reason = ""
        except DomainError as exc:
            reason = exc.message
        return [
            {
                "provider_id": "deeplatform",
                "version": PROVIDER_COMMIT,
                "available": available,
                "reason": reason or None,
                "supported_operations": ["train", "component_preview", "component_upload"],
                "limitations": [
                    "auto is unsupported",
                    "custom split directory requires provider changes",
                    "evaluation and transfer tasks are not yet declared",
                    "effective device requires runtime evidence",
                ],
            }
        ]
