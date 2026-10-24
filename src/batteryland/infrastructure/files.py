import hashlib
import os
import tempfile
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

    def inspect(self, alias: str, relative_key: str | None = None) -> str:
        if alias not in self.roots:
            raise DomainError("invalid_input", "Unknown source root alias")
        root = self.roots[alias]
        target = contained_path(root, relative_key) if relative_key else root
        available = target.is_file() if relative_key else target.is_dir()
        return "available" if available and os.access(target, os.R_OK) else "missing"


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
