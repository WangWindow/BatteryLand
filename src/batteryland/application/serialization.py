"""Parse external configuration without executing code or losing duplicate-key errors."""

import json
from typing import Any

import yaml

from batteryland.domain.errors import DomainError


class ConfigLoader(yaml.SafeLoader):
    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
        self.flatten_mapping(node)
        result: dict[Any, Any] = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise ValueError("Configuration keys must be unique strings")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


def load_config(content: bytes) -> dict[str, Any]:
    try:
        value = yaml.load(content.decode("utf-8"), Loader=ConfigLoader)
        if not isinstance(value, dict):
            raise ValueError("Configuration must be an object")
        json.dumps(value, allow_nan=False)
        return value
    except (ValueError, TypeError, yaml.YAMLError) as exc:
        raise DomainError(
            "invalid_input", "Configuration is not a finite JSON-compatible mapping"
        ) from exc


def load_json(content: bytes) -> dict[str, Any]:
    def mapping(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    try:
        value = json.loads(content.decode("utf-8"), object_pairs_hook=mapping)
        if not isinstance(value, dict):
            raise ValueError("JSON document must be an object")
        json.dumps(value, allow_nan=False)
        return value
    except (ValueError, TypeError) as exc:
        raise DomainError("invalid_input", "Invalid JSON document") from exc
