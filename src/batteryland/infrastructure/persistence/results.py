from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from batteryland.application.ports.persistence import Record
from batteryland.infrastructure.persistence.models import IngestionCursorRow, MetricRow, ResultRow
from batteryland.infrastructure.persistence.resources import page_of


class SqlResultRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, identity: str) -> Record:
        row = self.session.get(ResultRow, identity)
        if row is None:
            return {
                "head_document_id": None,
                "source_artifact_id": None,
                "import_status": "unavailable",
                "error": None,
            }
        return {
            key: getattr(row, key)
            for key in ("head_document_id", "source_artifact_id", "import_status", "error")
        }

    def status(self, identity: str, status: str, error: str | None) -> None:
        row = self.session.get(ResultRow, identity)
        if row is None:
            row = ResultRow(experiment_id=identity)
            self.session.add(row)
        row.import_status, row.error = status, error
        self.session.flush()

    def publish(
        self, identity: str, document_id: str, artifact_id: str, version: int, metrics: list[Record]
    ) -> None:
        self.status(identity, "available", None)
        row = self.session.get(ResultRow, identity)
        assert row is not None
        row.head_document_id, row.source_artifact_id = document_id, artifact_id
        self.session.execute(
            delete(MetricRow).where(
                MetricRow.experiment_id == identity, MetricRow.record_type == "final"
            )
        )
        self.session.add_all(
            [
                MetricRow(
                    experiment_id=identity,
                    record_type="final",
                    source_document_id=document_id,
                    source_artifact_id=artifact_id,
                    generation=version,
                    record_offset=0,
                    **value,
                )
                for value in metrics
            ]
        )

    def cursor(self, identity: str) -> Record | None:
        row = self.session.scalar(
            select(IngestionCursorRow).where(
                IngestionCursorRow.experiment_id == identity,
                IngestionCursorRow.artifact_kind == "metrics",
            )
        )
        return (
            None
            if row is None
            else {
                key: getattr(row, key)
                for key in ("file_identity", "generation", "byte_offset", "source_hash", "revision")
            }
        )

    def ingest(self, identity: str, cursor: Record, metrics: list[Record], reset: bool) -> None:
        row = self.session.scalar(
            select(IngestionCursorRow).where(
                IngestionCursorRow.experiment_id == identity,
                IngestionCursorRow.artifact_kind == "metrics",
            )
        )
        if reset:
            self.session.execute(
                delete(MetricRow).where(
                    MetricRow.experiment_id == identity, MetricRow.record_type == "epoch"
                )
            )
        self.session.add_all([MetricRow(experiment_id=identity, **value) for value in metrics])
        if row is None:
            row = IngestionCursorRow(experiment_id=identity, artifact_kind="metrics")
            self.session.add(row)
        for key in ("file_identity", "generation", "byte_offset", "source_hash"):
            setattr(row, key, cursor[key])
        row.revision = (row.revision or 0) + 1
        self.session.flush()

    def metrics(self, identity: str, filters: Record, page: int, page_size: int) -> Record:
        query = select(MetricRow).where(
            MetricRow.experiment_id == identity, MetricRow.record_type == "epoch"
        )
        for key in ("stage", "name"):
            if filters.get(key) is not None:
                query = query.where(getattr(MetricRow, key) == filters[key])
        if filters.get("after_epoch") is not None:
            query = query.where(MetricRow.epoch > filters["after_epoch"])
        return page_of(
            self.session,
            query.order_by(MetricRow.epoch, MetricRow.stage, MetricRow.name),
            lambda row: {
                key: getattr(row, key)
                for key in ("epoch", "stage", "name", "value", "unit", "granularity")
            },
            page,
            page_size,
        )
