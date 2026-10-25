"""Indexed provider manifests, with honest resolution against the fixed battery pool."""

from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record
from batteryland.db.models import NamedGroupMemberRow, NamedGroupRow


def group_value(row: NamedGroupRow) -> Record:
    return {
        "id": row.id,
        "name": row.name,
        "manifest_sha256": row.manifest_sha256,
        "counts": row.counts,
        "created_at": row.created_at,
    }


class SqlNamedGroupRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def put(
        self, name: str, digest: str, document: Record, counts: Record, members: Sequence[Record]
    ) -> Record:
        row = self.session.scalar(select(NamedGroupRow).where(NamedGroupRow.name == name))
        if row is None:
            row = NamedGroupRow(name=name, manifest_sha256=digest, document=document, counts=counts)
            self.session.add(row)
            self.session.flush()
        else:
            row.manifest_sha256 = digest
            row.document = document
            row.counts = counts
            self.session.execute(
                delete(NamedGroupMemberRow).where(NamedGroupMemberRow.group_id == row.id)
            )
        for member in members:
            self.session.add(NamedGroupMemberRow(group_id=row.id, **member))
        self.session.flush()
        return group_value(row)

    def list(self, page: int, page_size: int) -> Record:
        total = self.session.scalar(select(func.count()).select_from(NamedGroupRow)) or 0
        rows = self.session.scalars(
            select(NamedGroupRow)
            .order_by(NamedGroupRow.name)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
        return {
            "items": [group_value(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def get(self, name: str) -> Record:
        row = self.session.scalar(select(NamedGroupRow).where(NamedGroupRow.name == name))
        if row is None:
            raise DomainError("not_found", "Named group not found")
        return group_value(row) | {"document": row.document}

    def members(self, name: str, partition: str | None, page: int, page_size: int) -> Record:
        row = self.session.scalar(select(NamedGroupRow).where(NamedGroupRow.name == name))
        if row is None:
            raise DomainError("not_found", "Named group not found")
        query = select(NamedGroupMemberRow).where(NamedGroupMemberRow.group_id == row.id)
        if partition is not None:
            query = query.where(NamedGroupMemberRow.partition == partition)
        total = self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.session.scalars(
            query.order_by(NamedGroupMemberRow.partition, NamedGroupMemberRow.ordinal)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
        return {
            "items": [
                {
                    "partition": member.partition,
                    "ordinal": member.ordinal,
                    "file_name": member.file_name,
                    "battery_id": member.battery_id,
                    "match_status": member.match_status,
                    "candidate_count": member.candidate_count,
                }
                for member in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
