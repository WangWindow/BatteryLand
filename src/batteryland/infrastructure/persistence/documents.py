from sqlalchemy import select
from sqlalchemy.orm import Session

from batteryland.domain.documents import DocumentRef
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.persistence.models import DocumentRow


def document_reference(row: DocumentRow) -> DocumentRef:
    return DocumentRef(
        row.id, row.kind, row.owner_id, row.version, row.storage_key, row.sha256, row.created_at
    )


class SqlDocumentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, reference: DocumentRef) -> None:
        self.session.add(
            DocumentRow(
                id=reference.id,
                kind=reference.kind,
                owner_id=reference.owner_id,
                version=reference.version,
                storage_key=reference.storage_key,
                sha256=reference.sha256,
                created_at=reference.created_at,
            )
        )
        self.session.flush()

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
