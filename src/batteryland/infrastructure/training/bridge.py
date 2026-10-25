"""Standalone JSON control bridge; runnable without importing the API package."""

from __future__ import annotations

import base64
import fcntl
import hashlib
import importlib
import json
import os
import sys
import traceback
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any


def runtime_identity() -> dict[str, str]:
    return {
        "executable": sys.executable,
        "prefix": sys.prefix,
        "python_version": sys.version.split()[0],
    }


def definitions(provider: Path, runtime: Path) -> list[dict[str, Any]]:
    module = importlib.import_module("tools.component_upload")
    found: dict[tuple[str, str], dict[str, Any]] = {}
    for root, origin in [(provider, "builtin"), (runtime, "uploaded")]:
        for value in module.ComponentStore(project_root=root).list_components():
            key = (value["scope"], value["type"])
            if key in found:
                raise ValueError(
                    "Component registration conflicts across provider and upload roots"
                )
            value = dict(value)
            value["origin"] = origin
            value["source_hash"] = hashlib.sha256((root / value["path"]).read_bytes()).hexdigest()
            found[key] = value
    return sorted(found.values(), key=lambda value: (value["scope"], value["type"]))


def dispatch(request: dict[str, Any]) -> Any:
    provider = Path(request["provider_root"]).resolve()
    runtime = Path(request["runtime_root"]).resolve()
    for folder in ["components", "task"]:
        (runtime / folder).mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(runtime), str(provider)]
    os.chdir(runtime)
    operation = request["operation"]
    if operation == "inspect":
        return definitions(provider, runtime)
    if operation == "upload":
        module = importlib.import_module("tools.component_upload")
        lock_fd = os.open(runtime / ".registry.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock_fd, "rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            existing = {(item["scope"], item["type"]) for item in definitions(provider, runtime)}
            content = base64.b64decode(request["content"], validate=True)
            declarations = module.inspect_component_source(content, Path(request["filename"]))
            if any((item.scope, item.type) in existing for item in declarations):
                return {"bridge_error": "conflict", "message": "Component type already exists"}
            result = module.ComponentStore(
                project_root=runtime, max_upload_bytes=request["limit"]
            ).upload(request["scope"], request["filename"], content)
        return result
    if operation == "catalog":
        module = importlib.import_module("core.register.catalog")
        if request.get("scope") is not None and request.get("type") is not None:
            return module.get_component_schema(request["scope"], request["type"])
        return module.get_catalog()
    frame_module = importlib.import_module("frame.frame")
    if operation == "validate":
        frame = frame_module.Frame()
        config = request["config"]
        frame.check(config, validate_registry=False)
        importlib.import_module("core.register.autodiscover").autodiscover_components()
        frame.check(config)
        torch = importlib.import_module("torch")
        device = config["mate"]["device"]
        if device.startswith("cuda:"):
            index = int(device.split(":")[1])
            if not torch.cuda.is_available() or index >= torch.cuda.device_count():
                return {
                    "bridge_error": "integration_precondition_failed",
                    "message": "Requested CUDA device is unavailable",
                }
        return {
            "valid": True,
            "errors": [],
            "warnings": [],
            "components": definitions(provider, runtime),
        }
    if operation == "prepare":
        frame = frame_module.Frame()
        frame.prepare(request["config_path"])
        directory = Path(frame.context.__experiment_path__).resolve()
        return {
            "experiment_id": request["experiment_id"],
            "directory": str(directory),
            "config_sha256": hashlib.sha256((directory / "config.yaml").read_bytes()).hexdigest(),
            "runtime": runtime_identity(),
        }
    raise ValueError("Unsupported control command")


def main() -> int:
    try:
        request = json.load(sys.stdin)
        with redirect_stdout(sys.stderr):
            result = dispatch(request)
        if isinstance(result, dict) and "bridge_error" in result:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": {"symbol": result["bridge_error"], "message": result["message"]},
                        "runtime": runtime_identity(),
                    }
                )
            )
            return 1
        print(
            json.dumps(
                {"ok": True, "data": result, "runtime": runtime_identity()},
                ensure_ascii=False,
                allow_nan=False,
            )
        )
        return 0
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        code = getattr(exc, "code", None)
        symbol = (
            "conflict"
            if code in {"type_exists", "file_exists", "duplicate_registration"}
            else "provider_unavailable"
            if isinstance(exc, ImportError)
            else "invalid_input"
        )
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {"symbol": symbol, "message": str(exc)},
                    "runtime": runtime_identity(),
                }
            )
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
