import hashlib
import os
import tempfile
from collections import Counter
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from batteryland.application.ports.persistence import Record
from batteryland.domain.errors import DomainError


def contained_path(root: Path, key: str) -> Path:
    """Resolve symlinks before enforcing a managed filesystem boundary."""
    if not key or "\x00" in key or Path(key).is_absolute():
        raise DomainError("invalid_input", "A relative resource key is required")
    resolved_root = root.resolve()
    target = (resolved_root / key).resolve()
    if not target.is_relative_to(resolved_root) or target == resolved_root:
        raise DomainError("invalid_input", "Resource reference escapes its allowed root")
    return target


class LocalSourceFiles:
    def __init__(self, roots: dict[str, Path]) -> None:
        self.roots = roots

    def options(self) -> list[Record]:
        return [
            {
                "root_alias": alias,
                "display_name": root.name or alias,
                "availability": self.inspect(alias),
                "file_count": sum(item["importable"] for item in self._scan(alias)),
            }
            for alias, root in sorted(self.roots.items())
        ]

    def inspect(self, alias: str, relative_key: str | None = None) -> str:
        if alias not in self.roots:
            raise DomainError("invalid_input", "Unknown source root alias")
        root = self.roots[alias]
        target = contained_path(root, relative_key) if relative_key else root
        available = target.is_file() if relative_key else target.is_dir()
        return "available" if available and os.access(target, os.R_OK) else "missing"

    def list_files(self, alias: str, q: str | None, page: int, page_size: int) -> Record:
        if type(page) is not int or page < 1 or type(page_size) is not int or page_size < 1:
            raise DomainError("invalid_input", "File discovery pagination is invalid")
        candidates = self._scan(alias)
        query = q.strip().casefold() if q else ""
        matches = [
            item
            for item in candidates
            if not query
            or query in item["file_name"].casefold()
            or query in item["relative_key"].casefold()
        ]
        start = (page - 1) * page_size
        return {
            "items": matches[start : start + page_size],
            "total": len(matches),
            "page": page,
            "page_size": page_size,
        }

    def _scan(self, alias: str) -> list[Record]:
        if alias not in self.roots:
            raise DomainError("invalid_input", "Unknown source root alias")
        root = self.roots[alias].resolve()
        if not root.is_dir() or not os.access(root, os.R_OK):
            return []

        paths: list[Path] = []
        try:
            entries = sorted(root.iterdir(), key=lambda path: path.name.casefold())
            for entry in entries:
                if entry.name.startswith(".") or entry.is_symlink():
                    continue
                if entry.is_file() and entry.suffix.casefold() == ".pkl":
                    paths.append(entry)
                elif entry.is_dir():
                    try:
                        children = sorted(entry.iterdir(), key=lambda path: path.name.casefold())
                    except OSError:
                        continue
                    paths.extend(
                        child
                        for child in children
                        if not child.name.startswith(".")
                        and not child.is_symlink()
                        and child.is_file()
                        and child.suffix.casefold() == ".pkl"
                    )
        except OSError as exc:
            raise DomainError(
                "storage_corrupt", "Configured data directory cannot be scanned"
            ) from exc

        candidates: list[Record] = []
        for path in paths:
            try:
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root) or not os.access(resolved, os.R_OK):
                    continue
                relative_key = path.relative_to(root).as_posix()
                candidates.append(
                    {
                        "file_name": path.name,
                        "relative_key": relative_key,
                        "size_bytes": resolved.stat().st_size,
                        "importable": True,
                        "reason": None,
                    }
                )
            except OSError, ValueError:
                continue

        counts = Counter(item["file_name"] for item in candidates)
        for item in candidates:
            if counts[item["file_name"]] > 1:
                item["importable"] = False
                item["reason"] = "duplicate_file_name"
        return sorted(candidates, key=lambda item: item["relative_key"].casefold())


class ManagedArtifacts:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def save(self, stream: BinaryIO, filename: str, limit: int) -> Record:
        if (
            not filename
            or "\x00" in filename
            or "/" in filename
            or "\\" in filename
            or filename in {".", ".."}
        ):
            raise DomainError("invalid_input", "Upload needs a plain file name")
        identity = str(uuid4())
        key = f"uploads/{identity}/{filename}"
        target = contained_path(self.root, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary: Path | None = None
        digest = hashlib.sha256()
        size = 0
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
                temporary = Path(output.name)
                while chunk := stream.read(65536):
                    size += len(chunk)
                    if size > limit:
                        raise DomainError(
                            "invalid_input", "Upload exceeds the configured size limit"
                        )
                    digest.update(chunk)
                    output.write(chunk)
                if not size:
                    raise DomainError("invalid_input", "Upload must not be empty")
                output.flush()
                os.fsync(output.fileno())
            os.link(temporary, target)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        return {
            "id": identity,
            "name": filename,
            "relative_key": key,
            "sha256": digest.hexdigest(),
            "size": size,
            "is_directory": False,
            "availability": "available",
        }

    def resolve(self, relative_key: str) -> Path:
        path = contained_path(self.root, relative_key)
        if not path.is_file():
            raise DomainError("not_found", "Artifact file is unavailable")
        return path
