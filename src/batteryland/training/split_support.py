"""Compatibility and component support rules for training split inputs."""

import json
from pathlib import Path

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record

BUILTIN_BATTERY_FACTORY = "batterylifedatasetfactory"
CUSTOM_BATTERY_FACTORY = "batterylandbatterylifedatasetfactory"


def factories(config: Record) -> list[Record]:
    value = config.get("datafactory", [])
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list) and all(isinstance(item, dict) for item in value):
        return value
    if value == []:
        return []
    raise DomainError("invalid_input", "Data factories must be an object or a list of objects")


def battery_factory(config: Record) -> Record | None:
    matches = [
        item
        for item in factories(config)
        if str(item.get("type", "")).casefold() in {BUILTIN_BATTERY_FACTORY, CUSTOM_BATTERY_FACTORY}
    ]
    if len(matches) > 1:
        raise DomainError("invalid_input", "Configure only one BatteryLife data factory")
    return matches[0] if matches else None


def configured_dataset(config: Record, factory: Record) -> str | None:
    parameters = factory.get("params", {})
    if not isinstance(parameters, dict):
        raise DomainError("invalid_input", "Factory params must be an object")
    name = parameters.get("dataset")
    if isinstance(name, str) and name.startswith("@"):
        name = config.get("mate", {}).get(name[1:])
    return name if isinstance(name, str) else None


def is_builtin_split(runtime_root: Path, split: Record) -> bool:
    folder = runtime_root / "datasets/batteryLife/data_split"
    try:
        return any(
            json.loads(path.read_text(encoding="utf-8")) == split for path in folder.glob("*.json")
        )
    except OSError, ValueError:
        return False


def execution_support(config: Record, split: Record, runtime_root: Path) -> tuple[bool, list[str]]:
    factory = battery_factory(config)
    builtin = is_builtin_split(runtime_root, split)
    if factory is None:
        return (True, []) if builtin else (False, ["custom_split_requires_batterylife_adapter"])

    name = configured_dataset(config, factory)
    if name != split["dataset"]:
        raise DomainError("invalid_input", "Config dataset must match the split dataset")
    parameters = factory.get("params", {})
    if not isinstance(parameters, dict):
        raise DomainError("invalid_input", "Factory params must be an object")

    if str(factory.get("type", "")).casefold() == CUSTOM_BATTERY_FACTORY:
        if "split_file" in parameters:
            raise DomainError(
                "invalid_input", "split_file is assigned by the platform during execution"
            )
        if any(not split[partition] for partition in ("train", "val", "test")):
            return False, ["empty_training_partition"]
        return True, []

    if builtin:
        if any(not split[partition] for partition in ("train", "val", "test")):
            return False, ["empty_training_partition"]
        return True, []
    return False, ["custom_split_requires_batterylife_adapter"]
