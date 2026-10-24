"""Training adapter using the current environment and owned worker processes."""

import base64
import json
import os
import re
import shutil
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import cast

import yaml

from batteryland.application.ports.persistence import Record
from batteryland.config import Settings
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.files import contained_path
from batteryland.infrastructure.scheduling import ProcessSupervisor
from batteryland.infrastructure.training.materializer import publish_file

PROVIDER_COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"


class DeeplatformGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = settings.data_dir.resolve() / "plugins"
        self.supervisor = ProcessSupervisor()

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

    def _control(self, operation: str, arguments: Record) -> object:
        self.identity()
        self.runtime.mkdir(parents=True, exist_ok=True)
        request = {
            "schema_version": 1,
            "operation": operation,
            "provider_root": str(self.settings.provider_root.resolve()),
            "runtime_root": str(self.runtime),
        } | arguments
        try:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("bridge.py"))],
                input=json.dumps(request, allow_nan=False),
                text=True,
                capture_output=True,
                timeout=30,
                env=os.environ | self.environment(),
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
        if not response.get("ok"):
            error = response.get("error", {})
            raise DomainError(
                error.get("symbol", "provider_unavailable"),
                error.get("message", "Training control failed"),
            )
        return response["data"]

    def components(self, scope: str | None = None) -> list[Record]:
        result = cast(list[Record], self._control("inspect", {}))
        return [
            item | {"provider_commit": PROVIDER_COMMIT}
            for item in result
            if scope is None or item["scope"] == scope.lower()
        ]

    def schema(self, scope: str, name: str) -> Record:
        return cast(Record, self._control("catalog", {"scope": scope, "type": name}))

    def upload(self, scope: str, filename: str, content: bytes) -> Record:
        return cast(
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

    def _preflight(self, config: Record, resources: Record) -> None:
        mate = config.get("mate")
        device = mate.get("device") if isinstance(mate, dict) else None
        if not isinstance(device, str) or not re.fullmatch(r"cpu|cuda:\d+", device):
            raise DomainError("unsupported_device", "An explicit cpu or cuda:N device is required")
        if resources.get("kind", "train") != "train":
            raise DomainError(
                "unsupported_capability",
                "Dedicated evaluation and transfer tasks are not yet declared by this provider",
            )
        factories = config.get("datafactory", [])
        if isinstance(factories, dict):
            factories = [factories]
        if not isinstance(factories, list):
            raise DomainError("invalid_input", "Data factories must be an object or list")
        for factory in factories:
            if (
                not isinstance(factory, dict)
                or str(factory.get("type", "")).lower() != "batterylifedatasetfactory"
            ):
                continue
            selected = resources.get("splits", {}).get("split")
            if not selected:
                raise DomainError(
                    "integration_precondition_failed",
                    "Register and bind a dataset split before execution",
                )
            parameters = factory.get("params", {})
            if not isinstance(parameters, dict):
                raise DomainError("invalid_input", "Factory params must be an object")
            name = parameters.get("dataset")
            if isinstance(name, str) and name.startswith("@"):
                name = config.get("mate", {}).get(name[1:])
            reference = selected["provider_split"]
            existing = None
            for path in (self.settings.provider_root / "datasets/batteryLife/data_split").glob(
                "*.json"
            ):
                value = json.loads(path.read_text())
                if value["dataset"] == name:
                    existing = value
            if existing != reference:
                raise DomainError(
                    "integration_precondition_failed",
                    "Provider does not yet support this custom split directory or content",
                )
            if any(not reference[group] for group in ("train", "val", "test")):
                raise DomainError(
                    "invalid_input",
                    "BatteryLifeRun requires nonempty training, validation and test groups",
                )
            source = Path("/data/BatteryLife_Processed")
            if not source.is_dir():
                raise DomainError(
                    "integration_precondition_failed",
                    "Provider's fixed raw-data source is not available",
                )
            wanted = {member for group in ("train", "val", "test") for member in reference[group]}
            candidates: dict[str, list[Path]] = {}
            for folder in source.iterdir():
                if folder.is_dir() and folder.name not in {
                    "Life labels",
                    "__pycache__",
                    "life_bank_cache",
                    "seen_unseen_labels",
                    "READMEs",
                }:
                    for item in folder.iterdir():
                        if item.name in wanted and item.is_file():
                            candidates.setdefault(item.name, []).append(item)
            if any(
                len(candidates.get(name, [])) != 1 or not os.access(candidates[name][0], os.R_OK)
                for name in wanted
            ):
                raise DomainError(
                    "integration_precondition_failed",
                    "Requested raw files are missing, unreadable or ambiguous",
                )
            alias = selected.get("source", {}).get("root_alias")
            root = self.settings.source_roots.get(alias)
            batteries = {row["file_name"]: row for row in selected.get("batteries", [])}
            if root is None or any(
                name not in batteries
                or contained_path(root, batteries[name]["relative_key"])
                != candidates[name][0].resolve()
                for name in wanted
            ):
                raise DomainError(
                    "integration_precondition_failed",
                    "Registered resource references do not match the provider's fixed raw-data source",
                )

    def validate(self, config: Record, resources: Record) -> Record:
        self._preflight(config, resources)
        result = cast(Record, self._control("validate", {"config": config}))
        return result | {"provider_commit": PROVIDER_COMMIT}

    def prepare(self, materialized: Record) -> Record:
        snapshot = materialized["snapshot"]
        if self.identity() != snapshot["provider_commit"]:
            raise DomainError(
                "integration_precondition_failed", "Provider changed after submission"
            )
        self._preflight(snapshot["native_config"], snapshot["resources"])
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
            if (
                not isinstance(factory, dict)
                or str(factory.get("type", "")).lower() != "batterylifedatasetfactory"
            ):
                continue
            workspace = (
                self.settings.data_dir.resolve() / "data-workspaces" / materialized["experiment_id"]
            )
            for folder in ["Life labels", "seen_unseen_labels"]:
                (workspace / folder).mkdir(parents=True, exist_ok=True)
                for path in (self.settings.provider_root / "datasets/batteryLife" / folder).glob(
                    "*.json"
                ):
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
        return prepared | {
            "intent_id": materialized["intent_id"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
            "provider_config_sha256": prepared["config_sha256"],
            "directory_ref": str(directory.relative_to(self.settings.data_dir.resolve())),
            "requested_device": config["mate"]["device"],
            "provider_commit": PROVIDER_COMMIT,
        }

    def spawn(self, prepared: Record) -> Record:
        if self.identity() != prepared["provider_commit"]:
            raise DomainError(
                "integration_precondition_failed", "Provider changed after preparation"
            )
        directory = Path(prepared["directory"])
        receipt = self.supervisor.start(
            [
                sys.executable,
                "-u",
                str(self.settings.provider_root.resolve() / "main.py"),
                "--experiment-dir",
                str(directory),
            ],
            directory,
            prepared["experiment_id"],
            cwd=self.runtime,
            environment=self.environment(),
        )
        return receipt | {
            "intent_id": prepared["intent_id"],
            "input_manifest_sha256": prepared["input_manifest_sha256"],
            "provider_config_sha256": prepared["provider_config_sha256"],
            "directory_ref": prepared["directory_ref"],
            "requested_device": prepared["requested_device"],
            "effective_device": None,
            "provider_commit": PROVIDER_COMMIT,
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
