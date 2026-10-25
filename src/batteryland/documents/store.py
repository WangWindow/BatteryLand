"""SQLite-backed adapter for the application document-store port."""

import threading
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any
from uuid import UUID

from batteryland.common.errors import DomainError
from batteryland.db.contracts import UnitOfWorkFactory
from batteryland.documents.types import DocumentRef


class SQLiteDocumentStore:
    def __init__(self, units: UnitOfWorkFactory) -> None:
        self.units = units
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
