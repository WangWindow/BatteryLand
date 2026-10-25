"""Transactional scheduler protocol, including serial queue reservation."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from batteryland.application.ports.persistence import Record
from batteryland.domain.errors import DomainError
from batteryland.domain.experiments import ACTIVE_STATES
from batteryland.infrastructure.persistence.experiments import SqlExperimentRepository
from batteryland.infrastructure.persistence.models import (
    ExecutionEventRow,
    ExecutionRow,
    ExperimentRow,
    QueueSequenceRow,
    ResourceSnapshotRow,
    WorkerNodeRow,
    utc_now,
)
from batteryland.infrastructure.persistence.validated_inputs import SqlValidatedInputRepository


class SqlWorkerRepository:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.experiments = SqlExperimentRepository(session)
        self.inputs = SqlValidatedInputRepository(session)

    def heartbeat(self, node_id: str, resources: Record) -> Record:
        timestamp = utc_now()
        node = self.session.get(WorkerNodeRow, node_id)
        if node is None:
            node = WorkerNodeRow(id=node_id, last_seen_at=timestamp, resources=resources)
            self.session.add(node)
        else:
            node.last_seen_at = timestamp
            node.resources = resources
        self.session.flush()
        self.session.add(ResourceSnapshotRow(node_id=node_id, resources=resources))
        cutoff = (datetime.now(UTC) - timedelta(hours=24)).isoformat()
        self.session.execute(
            delete(ResourceSnapshotRow).where(ResourceSnapshotRow.created_at < cutoff)
        )
        return {"id": node_id, "last_seen_at": timestamp, "resources": resources}

    def nodes(self) -> list[Record]:
        return [
            {"id": row.id, "last_seen_at": row.last_seen_at, "resources": row.resources}
            for row in self.session.scalars(select(WorkerNodeRow).order_by(WorkerNodeRow.id))
        ]

    def claim(
        self,
        identity: str,
        revision: int,
        node_id: str,
        device: str,
        request_id: str,
    ) -> tuple[Record, bool]:
        # SQLite obtains its single writer lock before the capacity read.
        self.session.execute(
            update(QueueSequenceRow)
            .where(QueueSequenceRow.id == 1)
            .values(value=QueueSequenceRow.value)
        )
        header = self.experiments.get(identity)
        execution = self.session.get(ExecutionRow, identity)
        if execution is None:
            raise DomainError("not_found", "Execution is not queued")
        if execution.claim_request_id == request_id and execution.owner_node == node_id:
            return self._claim_record(identity, execution), False
        if header["state"] != "queued" or header["revision"] != revision:
            raise DomainError("conflict", "Execution was already claimed or changed")
        active = self.session.scalar(
            select(ExperimentRow.id).where(ExperimentRow.state.in_(ACTIVE_STATES)).limit(1)
        )
        if active is not None:
            raise DomainError("conflict", "Serial execution capacity is occupied")
        oldest = self.session.scalar(
            select(ExecutionRow.experiment_id)
            .join(ExperimentRow, ExperimentRow.id == ExecutionRow.experiment_id)
            .where(ExperimentRow.state == "queued")
            .order_by(ExecutionRow.queue_order)
            .limit(1)
        )
        if oldest != identity:
            raise DomainError("conflict", "FIFO requires the oldest queued experiment")
        node = self.session.get(WorkerNodeRow, node_id)
        if node is None or datetime.fromisoformat(node.last_seen_at) < datetime.now(
            UTC
        ) - timedelta(seconds=30):
            raise DomainError("conflict", "Worker resource heartbeat is stale")
        gpu = next(
            (
                item
                for item in node.resources.get("gpus", [])
                if f"cuda:{item.get('cuda_index')}" == device
            ),
            None,
        )
        if gpu is None or not isinstance(gpu.get("free_bytes"), int) or gpu["free_bytes"] <= 0:
            raise DomainError("unsupported_device", "Selected GPU is not available")
        requested = execution.requested_device
        if requested != "auto" and requested != device:
            raise DomainError("unsupported_device", "Explicit CUDA device cannot be remapped")
        self.inputs.get(identity)
        token = str(uuid4())
        execution.claim_request_id = request_id
        execution.claim_token = token
        execution.owner_node = node_id
        execution.effective_device = device
        self.session.flush()
        if not self.experiments.transition(identity, {"queued"}, "starting", {}):
            raise DomainError("conflict", "Execution claim lost")
        return self._claim_record(identity, execution), True

    def _claim_record(self, identity: str, execution: ExecutionRow) -> Record:
        return {
            "experiment_id": identity,
            "intent_id": execution.intent_id,
            "claim_token": execution.claim_token,
            "node_id": execution.owner_node,
            "requested_device": execution.requested_device,
            "resolved_device": execution.effective_device,
            "input": self.inputs.get(identity),
            "state": self.experiments.get(identity)["state"],
            "revision": self.experiments.get(identity)["revision"],
            "stop_requested_at": execution.stop_requested_at,
            "actual_device": execution.actual_device,
            "actual_gpu_uuid": execution.actual_gpu_uuid,
        }

    def active(self, node_id: str) -> list[Record]:
        rows = self.session.scalars(
            select(ExecutionRow)
            .join(ExperimentRow)
            .where(
                ExecutionRow.owner_node == node_id,
                ExperimentRow.state.in_(ACTIVE_STATES),
            )
        )
        return [self._claim_record(row.experiment_id, row) for row in rows]

    def ensure_owner(self, identity: str, claim_token: str) -> None:
        row = self.session.get(ExecutionRow, identity)
        if row is None or row.claim_token != claim_token:
            raise DomainError("conflict", "Execution ownership token differs")

    def event(
        self,
        identity: str,
        event_id: str,
        claim_token: str,
        expected_revision: int,
        kind: str,
        data: Record,
    ) -> Record:
        execution = self.session.get(ExecutionRow, identity)
        if execution is None or execution.claim_token != claim_token:
            raise DomainError("conflict", "Execution ownership token differs")
        if self.session.get(ExecutionEventRow, (identity, event_id)) is not None:
            return self.experiments.get(identity)
        header = self.experiments.get(identity)
        stopped_during_start = (
            kind == "started"
            and header["state"] == "stopping"
            and header["revision"] == expected_revision + 1
            and execution.stop_requested_at is not None
            and execution.receipt is None
        )
        if header["revision"] != expected_revision and not stopped_during_start:
            raise DomainError("conflict", "Execution revision has changed")
        state = header["state"]
        fields: Record = {}
        if kind == "started":
            if state not in {"starting", "stopping"} or not isinstance(data.get("receipt"), dict):
                raise DomainError("conflict", "Only a starting execution can report a start")
            receipt = data["receipt"]
            if (
                receipt.get("experiment_id") != identity
                or receipt.get("intent_id") != execution.intent_id
            ):
                raise DomainError(
                    "integration_precondition_failed", "Process receipt identity differs"
                )
            fields = {
                "receipt": receipt,
                "started_at": receipt.get("started_at", utc_now()),
                "prepared": {"directory_ref": f"worker-output/{identity}"},
            }
            target = "running" if state == "starting" else "stopping"
        elif kind == "finished":
            if state not in {"starting", "running", "stopping"}:
                raise DomainError("conflict", "Execution cannot finish from its current state")
            result = data.get("result")
            if result not in {"succeeded", "failed", "stopped"}:
                raise DomainError("invalid_input", "Unknown terminal result")
            target = result
            fields = {"exit_code": data.get("exit_code")}
        elif kind == "uncertain":
            if state not in {"starting", "running", "stopping"}:
                raise DomainError("conflict", "Execution cannot be reconciled from its state")
            target = "needs_reconciliation"
            fields = {
                "error": {
                    "error": "uncertain",
                    "message": str(data.get("reason", "Process identity is uncertain")),
                }
            }
        elif kind == "device_observed":
            if state not in {"running", "stopping"} or execution.receipt is None:
                raise DomainError("conflict", "Only a running process can report device evidence")
            node = self.session.get(WorkerNodeRow, execution.owner_node)
            pid = execution.receipt.get("pid")
            gpu = (
                next(
                    (
                        item
                        for item in node.resources.get("gpus", [])
                        if f"cuda:{item.get('cuda_index')}" == execution.effective_device
                        and item.get("uuid") == data.get("gpu_uuid")
                    ),
                    None,
                )
                if node
                else None
            )
            if (
                not isinstance(pid, int)
                or gpu is None
                or not isinstance(gpu.get("process_pids"), list)
                or pid not in gpu["process_pids"]
            ):
                raise DomainError(
                    "integration_precondition_failed", "GPU process evidence is missing"
                )
            target = state
            fields = {
                "actual_device": execution.effective_device,
                "actual_gpu_uuid": gpu["uuid"],
            }
        else:
            raise DomainError("invalid_input", "Unknown execution event")
        if target == state:
            self.experiments.update_execution(identity, fields)
        elif not self.experiments.transition(identity, {state}, target, fields):
            raise DomainError("conflict", "Execution state changed concurrently")
        self.session.add(
            ExecutionEventRow(
                experiment_id=identity,
                event_id=event_id,
                kind=kind,
                claim_token=claim_token,
            )
        )
        self.session.flush()
        return self.experiments.get(identity)
