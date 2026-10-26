"""Indexed provider manifests, with honest resolution against the fixed battery pool."""

from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.datasets.repository import battery_value
from batteryland.db.contracts import Record
from batteryland.db.models import (
    BatteryRow,
    CatalogScanRow,
    DataSourceRow,
    LogicalDatasetMemberRow,
    LogicalDatasetRow,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class SqlCatalogRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def status(self) -> Record:
        row = self.session.get(CatalogScanRow, "assets")
        if row is None:
            return {
                "state": "idle",
                "generation": 0,
                "file_count": 0,
                "source_count": 0,
                "started_at": None,
                "completed_at": None,
                "error": None,
            }
        return {
            "state": row.state,
            "generation": row.generation,
            "file_count": row.file_count,
            "source_count": row.source_count,
            "started_at": row.started_at,
            "completed_at": row.completed_at,
            "error": row.error,
        }

    def start_scan(self) -> Record:
        row = self.session.get(CatalogScanRow, "assets")
        if row is None:
            row = CatalogScanRow(id="assets", state="running", generation=1, started_at=_now())
            self.session.add(row)
        else:
            row.state = "running"
            row.generation += 1
            row.started_at = _now()
            row.error = None
        self.session.flush()
        return self.status()

    def complete_scan(self, file_count: int, source_count: int) -> Record:
        row = self.session.get(CatalogScanRow, "assets")
        if row is None:
            raise DomainError("storage_corrupt", "Asset scan state was not initialized")
        row.state = "ready"
        row.file_count = file_count
        row.source_count = source_count
        row.completed_at = _now()
        row.error = None
        self.session.flush()
        return self.status()

    def fail_scan(self, error: str) -> Record:
        row = self.session.get(CatalogScanRow, "assets")
        if row is None:
            row = CatalogScanRow(id="assets", state="failed", generation=1)
            self.session.add(row)
        row.state = "failed"
        row.completed_at = _now()
        row.error = error[:1000]
        self.session.flush()
        return self.status()


def _logical_dataset_value(session: Session, row: LogicalDatasetRow) -> Record:
    count = (
        session.scalar(
            select(func.count())
            .select_from(LogicalDatasetMemberRow)
            .where(LogicalDatasetMemberRow.dataset_id == row.id)
        )
        or 0
    )
    current_revisions = {
        identity: revision
        for identity, revision in session.execute(
            select(DataSourceRow.id, DataSourceRow.revision).where(
                DataSourceRow.id.in_([source["source_id"] for source in row.source_snapshot])
            )
        )
    }
    stale = any(
        current_revisions.get(source["source_id"]) != source["source_revision"]
        for source in row.source_snapshot
    )
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "source_snapshot": row.source_snapshot,
        "member_count": count,
        "stale": stale,
        "created_at": row.created_at,
    }


class SqlLogicalDatasetRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        identity: str,
        name: str,
        description: str,
        source_snapshot: Sequence[Record],
        battery_ids: Sequence[str],
    ) -> Record:
        row = LogicalDatasetRow(
            id=identity,
            name=name,
            description=description,
            source_snapshot=source_snapshot,
        )
        self.session.add(row)
        self.session.flush()
        self.session.add_all(
            LogicalDatasetMemberRow(dataset_id=identity, ordinal=index, battery_id=battery_id)
            for index, battery_id in enumerate(battery_ids)
        )
        self.session.flush()
        return _logical_dataset_value(self.session, row)

    def get(self, identity: str) -> Record:
        row = self.session.get(LogicalDatasetRow, identity)
        if row is None:
            raise DomainError("not_found", "Logical dataset not found")
        return _logical_dataset_value(self.session, row)

    def battery_ids(self, identity: str) -> Sequence[str]:
        self.get(identity)
        return tuple(
            self.session.scalars(
                select(LogicalDatasetMemberRow.battery_id)
                .where(LogicalDatasetMemberRow.dataset_id == identity)
                .order_by(LogicalDatasetMemberRow.ordinal)
            )
        )

    def list(self, page: int, page_size: int) -> Record:
        total = self.session.scalar(select(func.count()).select_from(LogicalDatasetRow)) or 0
        rows = self.session.scalars(
            select(LogicalDatasetRow)
            .order_by(LogicalDatasetRow.created_at.desc(), LogicalDatasetRow.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
        return {
            "items": [_logical_dataset_value(self.session, row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def members(self, identity: str, page: int, page_size: int) -> Record:
        self.get(identity)
        query = (
            select(LogicalDatasetMemberRow, BatteryRow)
            .join(BatteryRow, BatteryRow.id == LogicalDatasetMemberRow.battery_id)
            .where(LogicalDatasetMemberRow.dataset_id == identity)
        )
        total = self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.session.execute(
            query.order_by(LogicalDatasetMemberRow.ordinal)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
        return {
            "items": [
                battery_value(battery) | {"ordinal": member.ordinal} for member, battery in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def delete(self, identity: str) -> None:
        row = self.session.get(LogicalDatasetRow, identity)
        if row is None:
            raise DomainError("not_found", "Logical dataset not found")
        self.session.delete(row)
