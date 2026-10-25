import hashlib
import json
import os
import tempfile
from copy import deepcopy
from pathlib import Path

import yaml

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_json
from batteryland.db.contracts import Record


def publish_file(path: Path, content: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != content:
            raise DomainError("conflict", "Execution input already exists with different content")
        return hashlib.sha256(content).hexdigest()
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return hashlib.sha256(content).hexdigest()


class ExecutionMaterializer:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def materialize(self, experiment_id: str, intent_id: str, snapshot: Record) -> Record:
        directory = self.root / "inputs" / experiment_id
        config = deepcopy(snapshot["native_config"])
        config["mate"]["experiment"] = experiment_id
        config["mate"]["experiment_root"] = str(self.root / "runs")
        splits: Record = {}
        for name, binding in snapshot.get("resources", {}).get("splits", {}).items():
            path = directory / f"{name}.json"
            digest = publish_file(
                path,
                json.dumps(binding["provider_split"], ensure_ascii=False, allow_nan=False).encode(),
            )
            splits[name] = {"path": str(path), "sha256": digest, "ref": binding["ref"]}
        config_path = directory / "config.yaml"
        checksum = publish_file(
            config_path, yaml.safe_dump(config, allow_unicode=True, sort_keys=False).encode()
        )
        manifest = {
            "schema_version": 1,
            "experiment_id": experiment_id,
            "intent_id": intent_id,
            "provider_commit": snapshot.get("provider_commit"),
            "requested_device": config["mate"]["device"],
            "config_path": str(config_path),
            "config_sha256": checksum,
            "splits": splits,
        }
        manifest_path = directory / "manifest.json"
        manifest_hash = publish_file(
            manifest_path, json.dumps(manifest, sort_keys=True, allow_nan=False).encode()
        )
        return manifest | {
            "manifest_path": str(manifest_path),
            "input_manifest_sha256": manifest_hash,
            "snapshot": snapshot,
        }

    def record_receipt(self, experiment_id: str, stage: str, receipt: Record) -> None:
        publish_file(
            self.root / "inputs" / experiment_id / f"{stage}-receipt.json",
            json.dumps(receipt, sort_keys=True, allow_nan=False).encode(),
        )

    def recover_receipts(self, experiment_id: str, intent_id: str) -> Record:
        directory = self.root / "inputs" / experiment_id
        try:
            content = (directory / "manifest.json").read_bytes()
            manifest = load_json(content)
            manifest_hash = hashlib.sha256(content).hexdigest()
            if manifest["experiment_id"] != experiment_id or manifest["intent_id"] != intent_id:
                raise DomainError("needs_reconciliation", "Input manifest identity differs")
            result = {}
            for stage, key in (("prepare", "prepared"), ("process", "receipt")):
                path = directory / f"{stage}-receipt.json"
                if not path.exists():
                    continue
                value = load_json(path.read_bytes())
                if (
                    value.get("experiment_id") != experiment_id
                    or value.get("intent_id") != intent_id
                ):
                    raise DomainError("needs_reconciliation", "Receipt experiment identity differs")
                if value.get("input_manifest_sha256") != manifest_hash:
                    raise DomainError(
                        "needs_reconciliation", "Receipt input manifest checksum differs"
                    )
                output = Path(value["directory"]).resolve()
                if not output.is_relative_to(self.root / "runs") or value.get(
                    "directory_ref"
                ) != str(output.relative_to(self.root)):
                    raise DomainError("needs_reconciliation", "Receipt output directory differs")
                if hashlib.sha256((output / "config.yaml").read_bytes()).hexdigest() != value.get(
                    "provider_config_sha256"
                ):
                    raise DomainError(
                        "needs_reconciliation", "Prepared configuration checksum differs"
                    )
                result[key] = value
            return result
        except (OSError, KeyError, ValueError) as exc:
            raise DomainError(
                "needs_reconciliation", "No consistent execution receipt is available"
            ) from exc
