from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.datasets.repository import battery_value, page_of
from batteryland.db.contracts import Record
from batteryland.db.models import (
    BatteryRow,
    DatasetStatisticsRow,
    DocumentRow,
    ExperimentRow,
    SplitMemberRow,
    SplitRow,
)


def split_header(row: SplitRow) -> Record:
    return {
        "id": row.id,
        "name": row.name,
        "source_id": row.source_id,
        "head_document_id": row.head_document_id,
        "revision": row.revision,
        "created_at": row.created_at,
    }


class SqlSplitRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, identity: str, name: str, source_id: str, document_id: str) -> Record:
        row = SplitRow(id=identity, name=name, source_id=source_id, head_document_id=document_id)
        self.session.add(row)
        self.session.flush()
        return split_header(row)

    def get(self, identity: str) -> Record:
        row = self.session.get(SplitRow, identity)
        if row is None:
            raise DomainError("not_found", "Split not found")
        return split_header(row)

    def update(self, identity: str, revision: int, name: str, document_id: str) -> Record:
        updated = self.session.scalar(
            update(SplitRow)
            .where(SplitRow.id == identity, SplitRow.revision == revision)
            .values(name=name, revision=revision + 1, head_document_id=document_id)
            .returning(SplitRow.id)
        )
        if updated is None:
            raise DomainError("conflict", "Split revision has changed")
        return self.get(identity)

    def add_members(self, document_id: str, partitions: dict[str, list[str]]) -> None:
        self.session.add_all(
            [
                SplitMemberRow(
                    document_id=document_id, battery_id=battery, partition=name, ordinal=ordinal
                )
                for name, members in partitions.items()
                for ordinal, battery in enumerate(members)
            ]
        )
        self.session.flush()

    def add_statistics(self, document_id: str, profile: Record) -> None:
        self.session.add(
            DatasetStatisticsRow(
                document_id=document_id,
                schema_version=profile["schema_version"],
                summary=profile,
            )
        )
        self.session.flush()

    def statistics(self, document_id: str) -> Record | None:
        row = self.session.get(DatasetStatisticsRow, document_id)
        return row.summary if row is not None else None

    def list_splits(
        self, source_id: str | None, q: str | None, page: int, page_size: int
    ) -> Record:
        statement = select(SplitRow)
        if source_id:
            statement = statement.where(SplitRow.source_id == source_id)
        if q:
            statement = statement.where(SplitRow.name.contains(q, autoescape=True))
        result = page_of(
            self.session,
            statement.order_by(SplitRow.created_at.desc(), SplitRow.id.desc()),
            split_header,
            page,
            page_size,
        )
        documents = [item["head_document_id"] for item in result["items"]]
        counts = {
            (document, partition): total
            for document, partition, total in self.session.execute(
                select(SplitMemberRow.document_id, SplitMemberRow.partition, func.count())
                .where(SplitMemberRow.document_id.in_(documents))
                .group_by(SplitMemberRow.document_id, SplitMemberRow.partition)
            )
        }
        for item in result["items"]:
            item["head_version"] = item["version"] = item["revision"]
            item["counts"] = {
                name: counts.get((item["head_document_id"], name), 0)
                for name in ("train", "val", "test")
            }
        return result

    def members(self, document_id: str, partition: str | None, page: int, page_size: int) -> Record:
        statement = (
            select(BatteryRow)
            .join(SplitMemberRow, BatteryRow.id == SplitMemberRow.battery_id)
            .where(SplitMemberRow.document_id == document_id)
        )
        if partition:
            statement = statement.where(SplitMemberRow.partition == partition)
        return page_of(
            self.session,
            statement.order_by(
                case({"train": 0, "val": 1, "test": 2}, value=SplitMemberRow.partition),
                SplitMemberRow.ordinal,
            ),
            battery_value,
            page,
            page_size,
        )

    def delete(self, identity: str) -> None:
        self.get(identity)
        versions = select(DocumentRow.id).where(
            DocumentRow.kind == "split", DocumentRow.owner_id == identity
        )
        used = self.session.scalar(
            select(ExperimentRow.id)
            .where(
                or_(
                    ExperimentRow.split_document_id.in_(versions),
                    ExperimentRow.source_split_document_id.in_(versions),
                    ExperimentRow.target_split_document_id.in_(versions),
                )
            )
            .limit(1)
        )
        if used is not None:
            raise DomainError("resource_in_use", "Split is referenced by an experiment")
        self.session.execute(delete(SplitRow).where(SplitRow.id == identity))
