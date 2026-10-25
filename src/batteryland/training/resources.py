"""Resolve split member names against one configured fixed battery pool."""

import os
from pathlib import Path
from typing import Any

from batteryland.common.errors import DomainError


class BatteryFileResolver:
    def __init__(self, roots: dict[str, Path]) -> None:
        self.roots = roots

    def resolve(self, names: list[str]) -> dict[str, Any]:
        wanted = set(names)
        if not wanted:
            raise DomainError("invalid_input", "A training split must select at least one battery")

        available_roots = [
            (alias, root.resolve()) for alias, root in sorted(self.roots.items()) if root.is_dir()
        ]
        for alias, root in available_roots:
            candidates: dict[str, list[Path]] = {name: [] for name in wanted}
            for path in root.rglob("*.pkl"):
                if path.name not in wanted or not path.is_file() or not os.access(path, os.R_OK):
                    continue
                resolved = path.resolve()
                if resolved.is_relative_to(root):
                    candidates[path.name].append(resolved)
            if any(not candidates[name] for name in wanted):
                continue

            batteries = []
            for name in sorted(wanted):
                canonical = min(
                    candidates[name],
                    key=lambda path: (
                        path.relative_to(root).as_posix().casefold(),
                        path.relative_to(root).as_posix(),
                    ),
                )
                batteries.append(
                    {"file_name": name, "relative_key": canonical.relative_to(root).as_posix()}
                )
            return {"source": {"root_alias": alias}, "batteries": batteries}

        raise DomainError(
            "integration_precondition_failed",
            "Selected battery files are missing, unreadable or span multiple configured pools",
        )

    def resolve_members(self, members: list[dict[str, Any]]) -> dict[str, Any]:
        if not members:
            raise DomainError("invalid_input", "A training split must select at least one battery")

        names: set[str] = set()
        resolved_members = []
        aliases: set[str] = set()
        for member in members:
            name = member.get("file_name")
            alias = member.get("root_alias")
            relative_key = member.get("relative_key")
            root = self.roots.get(alias)
            if (
                not isinstance(name, str)
                or not name
                or not isinstance(alias, str)
                or not isinstance(relative_key, str)
                or root is None
            ):
                raise DomainError(
                    "integration_precondition_failed", "A selected battery source is unavailable"
                )
            if name in names:
                raise DomainError(
                    "invalid_input",
                    "BatteryLife training cannot disambiguate identical file names across sources",
                    details={"file_name": name},
                )
            names.add(name)
            root = root.resolve()
            path = (root / relative_key).resolve(strict=False)
            if not path.is_relative_to(root) or not path.is_file() or not os.access(path, os.R_OK):
                raise DomainError(
                    "integration_precondition_failed",
                    "A selected battery file is missing or unreadable",
                    details={"file_name": name, "source_id": member.get("source_id")},
                )
            if path.name != name:
                raise DomainError(
                    "integration_precondition_failed", "Battery file identity changed on disk"
                )
            aliases.add(alias)
            resolved_members.append(
                {
                    "battery_id": member["id"],
                    "source_id": member["source_id"],
                    "root_alias": alias,
                    "file_name": name,
                    "relative_key": relative_key,
                    "source_path": str(path),
                }
            )

        return {
            "source_roots": sorted(aliases),
            "batteries": resolved_members,
        }
