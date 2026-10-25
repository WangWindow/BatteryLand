"""Persistence for provider-validated original experiment input."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record
from batteryland.db.models import ValidatedInputRow, ValidatedSplitMemberRow


class SqlValidatedInputRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, experiment_id: str, version: int, value: Record) -> None:
        split = value["split"]
        counts = {partition: len(split[partition]) for partition in ("train", "val", "test")}
        self.session.add(
            ValidatedInputRow(
                experiment_id=experiment_id,
                version=version,
                split_counts=counts,
                **value,
            )
        )
        for partition in ("train", "val", "test"):
            for ordinal, file_name in enumerate(split[partition]):
                self.session.add(
                    ValidatedSplitMemberRow(
                        experiment_id=experiment_id,
                        version=version,
                        partition=partition,
                        ordinal=ordinal,
                        file_name=file_name,
                    )
                )
        self.session.flush()

    def get(self, experiment_id: str, version: int | None = None) -> Record:
        row = (
            self.session.get(ValidatedInputRow, (experiment_id, version))
            if version is not None
            else self.session.scalar(
                select(ValidatedInputRow)
                .where(ValidatedInputRow.experiment_id == experiment_id)
                .order_by(ValidatedInputRow.version.desc())
                .limit(1)
            )
        )
        if row is None:
            raise DomainError("not_found", "Validated experiment input not found")
        return {
            key: getattr(row, key)
            for key in (
                "experiment_id",
                "version",
                "config_text",
                "split_text",
                "config_sha256",
                "split_sha256",
                "config",
                "split",
                "receipt",
                "provider_commit",
                "created_at",
            )
        } | {
            "split_counts": row.split_counts
            or {
                partition: len(row.split.get(partition, []))
                for partition in ("train", "val", "test")
            }
        }

    def members(
        self,
        experiment_id: str,
        version: int | None,
        partition: str | None,
        page: int,
        page_size: int,
    ) -> Record:
        head = self.get(experiment_id, version)
        query = select(ValidatedSplitMemberRow).where(
            ValidatedSplitMemberRow.experiment_id == experiment_id,
            ValidatedSplitMemberRow.version == head["version"],
        )
        if partition is not None:
            query = query.where(ValidatedSplitMemberRow.partition == partition)
        total = self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        rows = self.session.scalars(
            query.order_by(ValidatedSplitMemberRow.partition, ValidatedSplitMemberRow.ordinal)
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()
        return {
            "items": [
                {"partition": row.partition, "ordinal": row.ordinal, "file_name": row.file_name}
                for row in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
