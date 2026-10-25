"""SQLAlchemy repository for immutable JSON document versions."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.db.models import DocumentRow
from batteryland.documents.types import DocumentRef


def _storage_key(identity: str) -> str:
    return f"sqlite:{identity}"


def _encode(envelope: dict[str, Any], *, symbol: str = "invalid_input") -> bytes:
    try:
        return json.dumps(
            envelope,
            ensure_ascii=False,
            sort_keys=True,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise DomainError(symbol, "Document must contain finite JSON values") from exc


def document_reference(row: DocumentRow) -> DocumentRef:
    return DocumentRef(
        row.id, row.kind, row.owner_id, row.version, row.storage_key, row.sha256, row.created_at
    )


class SqlDocumentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def publish(
        self,
        kind: str,
        owner_id: str,
        version: int,
        payload: dict[str, Any],
        *,
        document_id: str | None = None,
    ) -> DocumentRef:
        if (
            not isinstance(kind, str)
            or not kind
            or not isinstance(owner_id, str)
            or not owner_id
            or type(version) is not int
            or version < 1
        ):
            raise DomainError("invalid_input", "Document identity and version are required")
        if not isinstance(payload, dict):
            raise DomainError("invalid_input", "Document payload must be an object")

        try:
            if document_id is None:
                identity = str(uuid4())
            elif isinstance(document_id, str):
                identity = str(UUID(document_id))
            else:
                raise ValueError("Document ID must be text")
        except (TypeError, ValueError) as exc:
            raise DomainError("invalid_input", "Document ID must be a UUID") from exc
        existing = self.session.get(DocumentRow, identity)
        if existing is not None:
            self._read_row(existing)
            if (
                existing.kind == kind
                and existing.owner_id == owner_id
                and existing.version == version
                and existing.payload == payload
            ):
                return document_reference(existing)
            raise DomainError("conflict", "Document identity already exists with other content")

        version_row = self.session.scalar(
            select(DocumentRow).where(
                DocumentRow.kind == kind,
                DocumentRow.owner_id == owner_id,
                DocumentRow.version == version,
            )
        )
        if version_row is not None:
            raise DomainError("conflict", "Document version already exists with another identity")

        created_at = datetime.now(UTC).isoformat()
        envelope = {
            "schema_version": 1,
            "kind": kind,
            "owner_id": owner_id,
            "version": version,
            "created_at": created_at,
            "payload": payload,
        }
        checksum = hashlib.sha256(_encode(envelope)).hexdigest()
        row = DocumentRow(
            id=identity,
            kind=kind,
            owner_id=owner_id,
            version=version,
            schema_version=1,
            sha256=checksum,
            storage_key=_storage_key(identity),
            created_at=created_at,
            payload=payload,
        )
        self.session.add(row)
        self.session.flush()
        return document_reference(row)

    def add(self, reference: DocumentRef) -> None:
        """Verify a previously published document before a business row references it."""
        row = self.session.get(DocumentRow, reference.id)
        if row is None:
            raise DomainError("not_found", "Document version not found")
        actual = document_reference(row)
        if actual != reference:
            raise DomainError(
                "storage_corrupt", "Document reference does not match stored metadata"
            )
        self._read_row(row)

    def read(self, reference: DocumentRef) -> dict[str, Any]:
        row = self.session.get(DocumentRow, reference.id)
        if row is None:
            raise DomainError("storage_corrupt", "Document is missing")
        actual = document_reference(row)
        if actual != reference:
            raise DomainError(
                "storage_corrupt", "Document reference does not match stored metadata"
            )
        return self._read_row(row)

    def _read_row(self, row: DocumentRow) -> dict[str, Any]:
        if (
            row.schema_version != 1
            or row.storage_key != _storage_key(row.id)
            or not isinstance(row.payload, dict)
        ):
            raise DomainError("storage_corrupt", "Document is missing or has an invalid envelope")
        envelope = {
            "schema_version": row.schema_version,
            "kind": row.kind,
            "owner_id": row.owner_id,
            "version": row.version,
            "created_at": row.created_at,
            "payload": row.payload,
        }
        checksum = hashlib.sha256(_encode(envelope, symbol="storage_corrupt")).hexdigest()
        if checksum != row.sha256:
            raise DomainError("storage_corrupt", "Document checksum does not match its content")
        return envelope

    def get(self, identity: str) -> DocumentRef:
        row = self.session.get(DocumentRow, identity)
        if row is None:
            raise DomainError("not_found", "Document version not found")
        return document_reference(row)

    def find(self, kind: str, owner_id: str, version: int) -> DocumentRef:
        row = self.session.scalar(
            select(DocumentRow).where(
                DocumentRow.kind == kind,
                DocumentRow.owner_id == owner_id,
                DocumentRow.version == version,
            )
        )
        if row is None:
            raise DomainError("not_found", "Document version not found")
        return document_reference(row)

    def storage_keys(self) -> set[str]:
        return set(self.session.scalars(select(DocumentRow.storage_key)))
