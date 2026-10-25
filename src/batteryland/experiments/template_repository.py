from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.datasets.repository import page_of
from batteryland.db.contracts import Record
from batteryland.db.models import DocumentRow, ExperimentRow, TemplateRow


def template_header(row: TemplateRow) -> Record:
    return {
        "id": row.id,
        "name": row.name,
        "head_document_id": row.head_document_id,
        "revision": row.revision,
        "created_at": row.created_at,
    }


class SqlTemplateRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, identity: str, name: str, document_id: str) -> Record:
        row = TemplateRow(id=identity, name=name, head_document_id=document_id)
        self.session.add(row)
        self.session.flush()
        return template_header(row)

    def get(self, identity: str) -> Record:
        row = self.session.get(TemplateRow, identity)
        if row is None:
            raise DomainError("not_found", "Template not found")
        return template_header(row)

    def update(self, identity: str, revision: int, name: str, document_id: str) -> Record:
        changed = self.session.scalar(
            update(TemplateRow)
            .where(TemplateRow.id == identity, TemplateRow.revision == revision)
            .values(name=name, revision=revision + 1, head_document_id=document_id)
            .returning(TemplateRow.id)
        )
        if changed is None:
            raise DomainError("conflict", "Template revision has changed")
        return self.get(identity)

    def list(self, q: str | None, page: int, page_size: int) -> Record:
        statement = select(TemplateRow)
        if q:
            statement = statement.where(TemplateRow.name.contains(q, autoescape=True))
        result = page_of(
            self.session,
            statement.order_by(TemplateRow.created_at.desc(), TemplateRow.id.desc()),
            template_header,
            page,
            page_size,
        )
        for item in result["items"]:
            item.pop("head_document_id")
            item["head_version"] = item["revision"]
            item["version"] = item["revision"]
        return result

    def delete(self, identity: str) -> None:
        self.get(identity)
        versions = select(DocumentRow.id).where(
            DocumentRow.kind == "template", DocumentRow.owner_id == identity
        )
        if (
            self.session.scalar(
                select(ExperimentRow.id)
                .where(ExperimentRow.template_document_id.in_(versions))
                .limit(1)
            )
            is not None
        ):
            raise DomainError("resource_in_use", "Template is referenced by an experiment")
        self.session.execute(delete(TemplateRow).where(TemplateRow.id == identity))
