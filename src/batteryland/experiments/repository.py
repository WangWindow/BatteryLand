from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record
from batteryland.db.models import (
    ArtifactRow,
    ExecutionRow,
    ExperimentQueryRow,
    ExperimentRow,
    QueueSequenceRow,
    ResultRow,
    ValidatedInputRow,
    utc_now,
)
from batteryland.experiments.states import ensure_transition

REFERENCE_FIELDS = (
    "split_document_id",
    "source_split_document_id",
    "target_split_document_id",
    "checkpoint_id",
)


def experiment_header(
    row: ExperimentRow,
    query: ExperimentQueryRow | None,
    execution: ExecutionRow | None,
    result: ResultRow | None = None,
) -> Record:
    value = {
        key: getattr(row, key)
        for key in (
            "id",
            "name",
            "kind",
            "state",
            "revision",
            "created_at",
            "draft_document_id",
            "frozen_document_id",
            *REFERENCE_FIELDS,
        )
    }
    value["requested_device"] = query.requested_device if query else None
    value["effective_device"] = execution.effective_device if execution else None
    value["actual_device"] = execution.actual_device if execution else None
    value["actual_gpu_uuid"] = execution.actual_gpu_uuid if execution else None
    value["execution"] = (
        None
        if execution is None
        else {
            key: getattr(execution, key)
            for key in (
                "queued_at",
                "started_at",
                "finished_at",
                "stop_requested_at",
                "stop_stage",
                "stop_deadline",
                "exit_code",
                "error",
            )
        }
    )
    value["collection"] = {
        "status": result.import_status if result else "unavailable",
        "error": result.error if result else None,
    }
    return value


class SqlExperimentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(
        self, identity: str, value: Record, document_id: str, references: Record, query: Record
    ) -> Record:
        row = ExperimentRow(
            id=identity,
            name=value["name"],
            kind=value.get("kind", "train"),
            draft_document_id=document_id,
            **references,
        )
        self.session.add(row)
        self.session.flush()
        self.session.add(
            ExperimentQueryRow(
                experiment_id=identity, document_id=document_id, created_at=row.created_at, **query
            )
        )
        self.session.flush()
        return self.get(identity)

    def get(self, identity: str) -> Record:
        row = self.session.get(ExperimentRow, identity)
        if row is None:
            raise DomainError("not_found", "Experiment not found")
        return experiment_header(
            row,
            self.session.get(ExperimentQueryRow, identity),
            self.session.get(ExecutionRow, identity),
            self.session.get(ResultRow, identity),
        )

    def update(
        self,
        identity: str,
        revision: int,
        value: Record,
        document_id: str,
        references: Record,
        query: Record,
    ) -> Record:
        changed = self.session.scalar(
            update(ExperimentRow)
            .where(
                ExperimentRow.id == identity,
                ExperimentRow.revision == revision,
                ExperimentRow.state == "draft",
            )
            .values(
                name=value["name"],
                kind=value["kind"],
                revision=revision + 1,
                draft_document_id=document_id,
                **references,
            )
            .returning(ExperimentRow.id)
        )
        if changed is None:
            raise DomainError("conflict", "Experiment revision or state has changed")
        self.session.execute(
            update(ExperimentQueryRow)
            .where(ExperimentQueryRow.experiment_id == identity)
            .values(document_id=document_id, **query)
        )
        return self.get(identity)

    def list_experiments(self, filters: Record, page: int, page_size: int) -> Record:
        statement = (
            select(ExperimentRow, ExperimentQueryRow, ExecutionRow, ResultRow)
            .join(ExperimentQueryRow)
            .outerjoin(ExecutionRow)
            .outerjoin(ResultRow, ResultRow.experiment_id == ExperimentRow.id)
            .where(ExperimentRow.id.in_(select(ValidatedInputRow.experiment_id).distinct()))
        )
        for key, value in filters.items():
            if value is None:
                continue
            if key == "q":
                statement = statement.where(ExperimentRow.name.contains(value, autoescape=True))
            elif key == "state":
                statement = statement.where(ExperimentRow.state == value)
            elif key == "created_from":
                statement = statement.where(ExperimentRow.created_at >= value)
            elif key == "created_to":
                statement = statement.where(ExperimentRow.created_at <= value)
            elif key in {
                "source_id",
                "split_id",
                "model_type",
                "task_type",
                "requested_device",
                "source_domain",
                "target_domain",
            }:
                column = getattr(ExperimentQueryRow, key)
                statement = statement.where(func.lower(column) == value.lower())
        total = self.session.scalar(select(func.count()).select_from(statement.subquery())) or 0
        rows = self.session.execute(
            statement.order_by(ExperimentRow.created_at.desc(), ExperimentRow.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
        return {
            "items": [
                experiment_header(row, query, execution, result)
                for row, query, execution, result in rows
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def delete(self, identity: str) -> None:
        record = self.get(identity)
        if record["state"] not in {"draft", "succeeded", "failed", "cancelled", "stopped"}:
            raise DomainError("resource_in_use", "Active experiment cannot be deleted")
        used = self.session.scalar(
            select(ExperimentRow.id)
            .join(ArtifactRow, ExperimentRow.checkpoint_id == ArtifactRow.id)
            .where(ArtifactRow.experiment_id == identity)
            .limit(1)
        )
        if used:
            raise DomainError("resource_in_use", "Experiment artifacts are referenced")
        self.session.execute(delete(ExperimentRow).where(ExperimentRow.id == identity))

    def enqueue(
        self, identity: str, revision: int, snapshot_id: str, device: str, intent_id: str
    ) -> None:
        changed = self.session.scalar(
            update(ExperimentRow)
            .where(
                ExperimentRow.id == identity,
                ExperimentRow.state == "draft",
                ExperimentRow.revision == revision,
            )
            .values(state="queued", frozen_document_id=snapshot_id, revision=revision + 1)
            .returning(ExperimentRow.id)
        )
        if changed is None:
            raise DomainError("conflict", "Experiment changed while submitting")
        if self.session.get(QueueSequenceRow, 1) is None:
            self.session.add(QueueSequenceRow(id=1, value=0))
            self.session.flush()
        order = self.session.scalar(
            update(QueueSequenceRow)
            .where(QueueSequenceRow.id == 1)
            .values(value=QueueSequenceRow.value + 1)
            .returning(QueueSequenceRow.value)
        )
        self.session.add(
            ExecutionRow(
                experiment_id=identity,
                intent_id=intent_id,
                queue_order=order,
                requested_device=device,
            )
        )
        self.session.execute(
            update(ExperimentQueryRow)
            .where(ExperimentQueryRow.experiment_id == identity)
            .values(document_id=snapshot_id)
        )
        self.session.flush()

    def execution(self, identity: str) -> Record:
        row = self.session.get(ExecutionRow, identity)
        if row is None:
            raise DomainError("not_found", "Execution not found")
        return self._execution_value(row)

    @staticmethod
    def _execution_value(row: ExecutionRow) -> Record:
        return {
            key: getattr(row, key)
            for key in (
                "experiment_id",
                "intent_id",
                "queue_order",
                "queued_at",
                "requested_device",
                "effective_device",
                "prepared",
                "receipt",
                "started_at",
                "finished_at",
                "stop_requested_at",
                "stop_stage",
                "stop_deadline",
                "exit_code",
                "error",
            )
        }

    def executions(self, states: set[str]) -> list[Record]:
        rows = self.session.execute(
            select(ExperimentRow, ExperimentQueryRow, ExecutionRow)
            .join(ExecutionRow)
            .outerjoin(ExperimentQueryRow, ExperimentQueryRow.experiment_id == ExperimentRow.id)
            .where(ExperimentRow.state.in_(states))
            .where(ExperimentRow.id.in_(select(ValidatedInputRow.experiment_id).distinct()))
            .order_by(ExecutionRow.queue_order, ExperimentRow.id)
        )
        return [
            experiment_header(row, query, execution)
            | {"_execution": self._execution_value(execution)}
            for row, query, execution in rows
        ]

    def transition(self, identity: str, expected: set[str], target: str, fields: Record) -> bool:
        row = self.session.get(ExperimentRow, identity)
        if row is None or row.state not in expected:
            return False
        ensure_transition(row.state, target)
        changed = self.session.scalar(
            update(ExperimentRow)
            .where(
                ExperimentRow.id == identity,
                ExperimentRow.state == row.state,
                ExperimentRow.revision == row.revision,
            )
            .values(state=target, revision=row.revision + 1)
            .returning(ExperimentRow.id)
        )
        if changed is None:
            return False
        if target in {"succeeded", "failed", "stopped", "cancelled"}:
            fields = {"finished_at": utc_now()} | fields
        self.update_execution(identity, fields)
        return True

    def update_execution(self, identity: str, fields: Record) -> None:
        if fields:
            self.session.execute(
                update(ExecutionRow).where(ExecutionRow.experiment_id == identity).values(**fields)
            )
