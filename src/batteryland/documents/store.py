"""SQLite-backed adapter for the application document-store port."""

import hashlib
import json
import threading
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from batteryland.common.errors import DomainError
from batteryland.db.contracts import UnitOfWorkFactory
from batteryland.documents.types import DocumentRef


class SQLiteDocumentStore:
    def __init__(self, units: UnitOfWorkFactory, legacy_root: Path) -> None:
        self.units = units
        self.legacy_root = legacy_root
        self._mutex = threading.RLock()
        self._local = threading.local()

    @contextmanager
    def write_lock(self) -> Generator[None]:
        """Serialize document publication and associated business-reference writes."""
        with self._mutex:
            if getattr(self._local, "locked", False):
                yield
                return
            self._local.locked = True
            try:
                yield
            finally:
                self._local.locked = False

    def publish(
        self,
        kind: str,
        owner_id: str,
        version: int,
        payload: dict[str, Any],
        *,
        document_id: str | None = None,
    ) -> DocumentRef:
        try:
            identity = str(UUID(document_id)) if document_id is not None else None
        except (TypeError, ValueError) as exc:
            raise DomainError("invalid_input", "Document ID must be a UUID") from exc
        with self.write_lock():
            try:
                with self.units() as unit:
                    return unit.documents.publish(
                        kind, owner_id, version, payload, document_id=identity
                    )
            except DomainError as exc:
                if exc.symbol != "conflict" or identity is None:
                    raise
                with self.units() as unit:
                    try:
                        reference = unit.documents.get(identity)
                    except DomainError as retry_error:
                        if retry_error.symbol != "not_found":
                            raise
                        raise exc from None
                    if (
                        reference.kind != kind
                        or reference.owner_id != owner_id
                        or reference.version != version
                        or unit.documents.read(reference)["payload"] != payload
                    ):
                        raise exc from None
                    return reference

    def read(self, reference: DocumentRef) -> dict[str, Any]:
        with self.units() as unit:
            return unit.documents.read(reference)

    def migrate_legacy(self) -> None:
        """Import old JSON files once; keep them intact until every DB row is complete."""
        with self.write_lock():
            if self.legacy_root.exists() or self.legacy_root.is_symlink():
                if self.legacy_root.is_symlink() or not self.legacy_root.is_dir():
                    raise DomainError("storage_corrupt", "Legacy document path must be a directory")
                for source in sorted(self.legacy_root.iterdir()):
                    if source.name == ".write.lock" and not source.is_symlink():
                        continue
                    if source.is_symlink() or source.suffix != ".json":
                        raise DomainError(
                            "storage_corrupt", "Legacy document directory has an invalid entry"
                        )
                    try:
                        identity = str(UUID(source.stem))
                    except ValueError as exc:
                        raise DomainError(
                            "storage_corrupt", "Legacy document filename is invalid"
                        ) from exc
                    if source.stem != identity:
                        raise DomainError(
                            "storage_corrupt", "Legacy document filename is not canonical"
                        )
                    self._import_file(source, identity)

                with self.units() as unit:
                    unit.documents.ensure_complete()
                self._archive_legacy()
            else:
                with self.units() as unit:
                    unit.documents.ensure_complete()

    def _import_file(self, source: Path, identity: str) -> None:
        try:
            content = source.read_bytes()
            envelope = json.loads(content)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DomainError("storage_corrupt", "Legacy document is unreadable") from exc
        if not isinstance(envelope, dict):
            raise DomainError("storage_corrupt", "Legacy document envelope must be an object")
        kind = envelope.get("kind")
        owner_id = envelope.get("owner_id")
        version = envelope.get("version")
        created_at = envelope.get("created_at")
        if (
            not isinstance(kind, str)
            or not kind
            or not isinstance(owner_id, str)
            or not owner_id
            or type(version) is not int
            or version < 1
            or not isinstance(created_at, str)
        ):
            raise DomainError("storage_corrupt", "Legacy document identity fields are invalid")
        reference = DocumentRef(
            identity,
            kind,
            owner_id,
            version,
            source.name,
            hashlib.sha256(content).hexdigest(),
            created_at,
        )
        with self.units() as unit:
            unit.documents.import_legacy(reference, envelope)

    def _archive_legacy(self) -> None:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        backup = self.legacy_root.with_name(f"{self.legacy_root.name}.legacy")
        if backup.exists() or backup.is_symlink():
            backup = self.legacy_root.with_name(
                f"{self.legacy_root.name}.legacy-{timestamp}-{uuid4().hex[:8]}"
            )
        self.legacy_root.rename(backup)
