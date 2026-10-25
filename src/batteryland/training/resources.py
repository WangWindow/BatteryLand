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
