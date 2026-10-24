"""Filesystem implementation of the document store boundary."""

import fcntl
import hashlib
import json
import os
import tempfile
import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import UUID, uuid4

from batteryland.domain.documents import DocumentRef
from batteryland.domain.errors import DomainError


class JsonDocumentStore:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self._mutex = threading.RLock()
        self._local = threading.local()

    @contextmanager
    def write_lock(self) -> Generator[None]:
        """Share publication, reference commits, and cleanup under one writer boundary."""
        with self._mutex:
            if getattr(self._local, "locked", False):
                yield
                return
            self.root.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(
                self.root / ".write.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
            )
            with os.fdopen(descriptor, "rb") as stream:
                fcntl.flock(stream, fcntl.LOCK_EX)
                self._local.locked = True
                try:
                    yield
                finally:
                    self._local.locked = False
                    fcntl.flock(stream, fcntl.LOCK_UN)

    def publish(
        self,
        kind: str,
        owner_id: str,
        version: int,
        payload: dict[str, Any],
        *,
        document_id: str | None = None,
    ) -> DocumentRef:
        identity = str(UUID(document_id)) if document_id else str(uuid4())
        created = datetime.now(UTC).isoformat()
        envelope = {
            "schema_version": 1,
            "kind": kind,
            "owner_id": owner_id,
            "version": version,
            "created_at": created,
            "payload": payload,
        }
        content = json.dumps(
            envelope, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        key = f"{identity}.json"
        with self.write_lock():
            target = self.root / key
            if target.exists():
                existing = json.loads(target.read_bytes())
                if all(
                    existing.get(field) == envelope[field]
                    for field in envelope
                    if field != "created_at"
                ):
                    return DocumentRef(
                        identity,
                        kind,
                        owner_id,
                        version,
                        key,
                        hashlib.sha256(target.read_bytes()).hexdigest(),
                        existing["created_at"],
                    )
                raise DomainError("conflict", "Document identity already exists with other content")
            temporary: Path | None = None
            try:
                with tempfile.NamedTemporaryFile(
                    dir=self.root, prefix=".publish-", delete=False
                ) as stream:
                    temporary = Path(stream.name)
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.link(temporary, target)
                descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return DocumentRef(
            identity, kind, owner_id, version, key, hashlib.sha256(content).hexdigest(), created
        )

    def read(self, reference: DocumentRef) -> dict[str, Any]:
        target = (self.root / reference.storage_key).resolve()
        if target.parent != self.root or target.name != f"{reference.id}.json":
            raise DomainError("storage_corrupt", "Invalid document reference")
        try:
            content = target.read_bytes()
            if hashlib.sha256(content).hexdigest() != reference.sha256:
                raise ValueError("Checksum mismatch")
            envelope = json.loads(content)
            if (
                not isinstance(envelope, dict)
                or envelope.get("schema_version") != 1
                or envelope.get("kind") != reference.kind
                or envelope.get("owner_id") != reference.owner_id
                or envelope.get("version") != reference.version
                or not isinstance(envelope.get("payload"), dict)
            ):
                raise ValueError("Document envelope mismatch")
        except (OSError, ValueError) as exc:
            raise DomainError("storage_corrupt", "Document is missing or corrupt") from exc
        return cast(dict[str, Any], envelope)

    def cleanup(self, referenced_keys: Callable[[], set[str]], older_than: datetime) -> int:
        """Remove only old complete objects absent from a committed reference snapshot."""
        removed = 0
        with self.write_lock():
            retained = referenced_keys()
            for target in self.root.glob("*.json"):
                try:
                    if target.is_symlink() or str(UUID(target.stem)) != target.stem:
                        continue
                except ValueError:
                    continue
                if target.name not in retained and target.stat().st_mtime < older_than.timestamp():
                    target.unlink()
                    removed += 1
        return removed
