import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from uuid import uuid4

from batteryland.application.experiments import ExperimentService
from batteryland.application.ports.documents import DocumentStore
from batteryland.application.ports.persistence import Record, UnitOfWorkFactory
from batteryland.application.ports.training import ExecutionFiles, SchedulerPolicy, TrainingGateway
from batteryland.domain.errors import DomainError
from batteryland.domain.experiments import ACTIVE_STATES, TERMINAL_STATES

logger = logging.getLogger(__name__)


def now() -> str:
    return datetime.now(UTC).isoformat()


class ExecutionService:
    def __init__(
        self,
        units: UnitOfWorkFactory,
        documents: DocumentStore,
        experiments: ExperimentService,
        training: TrainingGateway,
        files: ExecutionFiles,
        policy: SchedulerPolicy,
        interrupt_timeout: float,
        terminate_timeout: float,
    ) -> None:
        self.units = units
        self.documents = documents
        self.experiments = experiments
        self.training = training
        self.files = files
        self.policy = policy
        self.interrupt_timeout = interrupt_timeout
        self.terminate_timeout = terminate_timeout
        self._tick_lock = threading.Lock()
        self.collect: Callable[[str], None] = lambda identity: None
        self.collect_pending: Callable[[], None] = lambda: None

    def submit(self, identities: list[str]) -> list[Record]:
        if not identities or len(set(identities)) != len(identities):
            raise DomainError("invalid_input", "Submit a nonempty unique experiment list")
        snapshots: Record = {}
        revisions: dict[str, int] = {}
        for identity in identities:
            experiment = self.experiments.get(identity)
            if experiment["state"] in TERMINAL_STATES:
                raise DomainError("conflict", "Copy a terminal experiment before running again")
            if experiment["state"] != "draft":
                continue
            validated = self.experiments.validate_details(identity)
            if not validated["valid"]:
                error = validated["errors"][0]
                raise DomainError(
                    error.get("error", "invalid_input"),
                    error.get("message", "Execution validation failed"),
                    details={"experiment_id": identity, "errors": validated["errors"]},
                )
            value = self.experiments.validation_input(identity)
            if value["experiment"]["revision"] != experiment["revision"]:
                raise DomainError("conflict", "Experiment changed during validation")
            snapshots[identity] = {
                "native_config": experiment["native_config"],
                "bindings": experiment["bindings"],
                "resources": value["resources"],
                "provider_commit": validated.get("provider_commit"),
                "components": validated.get("components", []),
                "requested_device": experiment["native_config"]["mate"]["device"],
            }
            revisions[identity] = experiment["revision"]
        with self.documents.write_lock():
            published = {
                identity: self.documents.publish("experiment_snapshot", identity, 1, snapshot)
                for identity, snapshot in snapshots.items()
            }
            with self.units() as unit:
                for identity in identities:
                    if identity not in published:
                        if unit.experiments.get(identity)["state"] in TERMINAL_STATES:
                            raise DomainError("conflict", "Experiment finished while submitting")
                        continue
                    document = published[identity]
                    unit.documents.add(document)
                    unit.experiments.enqueue(
                        identity,
                        revisions[identity],
                        document.id,
                        snapshots[identity]["requested_device"],
                        str(uuid4()),
                    )
        return [self.experiments.get(identity) for identity in identities]

    def queue(self) -> Record:
        with self.units() as unit:
            waiting = unit.experiments.executions({"queued"})
            active = unit.experiments.executions(ACTIVE_STATES)
        paused = any(item["state"] == "needs_reconciliation" for item in active)

        def public(item: Record) -> Record:
            return {
                key: value
                for key, value in self.experiments._public(item).items()
                if not key.startswith("_")
            }

        return {
            "waiting": [public(item) for item in waiting],
            "active": [public(item) for item in active],
            "dispatch_paused": paused,
            "reason": "Execution identity requires reconciliation" if paused else None,
        }

    def stop(self, identity: str) -> Record:
        with self.units() as unit:
            experiment = unit.experiments.get(identity)
            state = experiment["state"]
            if state == "queued":
                unit.experiments.transition(
                    identity, {state}, "cancelled", {"stop_requested_at": now()}
                )
            elif state in {"starting", "running"}:
                unit.experiments.transition(
                    identity, {state}, "stopping", {"stop_requested_at": now()}
                )
            elif state == "needs_reconciliation":
                raise DomainError(
                    "needs_reconciliation", "Verify the original process before stopping"
                )
            elif state == "draft":
                raise DomainError("conflict", "Draft has not been submitted")
        return self.experiments.get(identity)

    def _transition(
        self, identity: str, expected: set[str], target: str, fields: Record | None = None
    ) -> None:
        with self.units() as unit:
            unit.experiments.transition(identity, expected, target, fields or {})

    def _start(self, candidate: Record) -> None:
        identity = candidate["id"]
        with self.units() as unit:
            if not unit.experiments.transition(identity, {"queued"}, "starting", {}):
                return
            header = unit.experiments.get(identity)
            execution = unit.experiments.execution(identity)
            reference = unit.documents.get(header["frozen_document_id"])
        stage = "prepare"
        try:
            snapshot = self.documents.read(reference)["payload"]
            materialized = self.files.materialize(identity, execution["intent_id"], snapshot)
            prepared = self.training.prepare(materialized)
            if any(
                prepared.get(key) != materialized[key]
                for key in ("experiment_id", "intent_id", "input_manifest_sha256")
            ):
                raise DomainError(
                    "integration_precondition_failed",
                    "Preparation receipt does not match the execution input",
                )
            self.files.record_receipt(identity, "prepare", prepared)
            with self.units() as unit:
                unit.experiments.update_execution(identity, {"prepared": prepared})
                if unit.experiments.get(identity)["state"] == "stopping":
                    unit.experiments.transition(identity, {"stopping"}, "stopped", {})
                    return
            stage = "spawn"
            receipt = self.training.spawn(prepared)
            if any(
                receipt.get(key) != prepared[key]
                for key in (
                    "experiment_id",
                    "intent_id",
                    "input_manifest_sha256",
                    "provider_config_sha256",
                    "directory_ref",
                )
            ):
                raise DomainError(
                    "needs_reconciliation", "Process receipt does not match the prepared execution"
                )
            self.files.record_receipt(identity, "process", receipt)
            with self.units() as unit:
                unit.experiments.update_execution(
                    identity,
                    {
                        "receipt": receipt,
                        "started_at": receipt.get("started_at", now()),
                        "effective_device": receipt.get("effective_device"),
                    },
                )
                if unit.experiments.get(identity)["state"] == "starting":
                    unit.experiments.transition(identity, {"starting"}, "running", {})
        except Exception as exc:
            logger.exception("Execution %s failed during %s", identity, stage)
            uncertain = (
                stage == "spawn"
                or isinstance(exc, DomainError)
                and exc.symbol == "needs_reconciliation"
            )
            fields = {
                "error": {
                    "error": exc.symbol if isinstance(exc, DomainError) else "execution_failed",
                    "message": str(exc),
                }
            }
            with self.units() as unit:
                if uncertain:
                    unit.experiments.transition(
                        identity, {"starting", "stopping"}, "needs_reconciliation", fields
                    )
                elif not unit.experiments.transition(identity, {"starting"}, "failed", fields):
                    unit.experiments.transition(identity, {"stopping"}, "stopped", fields)

    def _watch(self, record: Record) -> None:
        identity = record["id"]
        execution = record["_execution"]
        receipt = execution["receipt"]
        if receipt is None:
            self._transition(
                identity,
                {"starting", "running", "stopping"},
                "needs_reconciliation",
                {
                    "error": {
                        "error": "receipt_missing",
                        "message": "Execution startup cannot be proven",
                    }
                },
            )
            return
        try:
            observed = self.training.observe(receipt)
        except DomainError as exc:
            self._transition(
                identity,
                {"starting", "running", "stopping"},
                "needs_reconciliation",
                {"error": {"error": exc.symbol, "message": exc.message}},
            )
            return
        if not observed["identity_matches"]:
            self._transition(identity, {"starting", "running", "stopping"}, "needs_reconciliation")
            return
        if not observed["alive"]:
            code = observed.get("exit_code")
            provider = observed.get("provider_status")
            if code == 0 or provider == "completed":
                target = "succeeded"
            elif execution["stop_requested_at"]:
                target = "stopped"
            elif code is not None or provider in {"failed", "interrupted"}:
                target = "failed"
            else:
                target = "needs_reconciliation"
            self._transition(identity, {record["state"]} - {target}, target, {"exit_code": code})
        elif record["state"] == "stopping":
            stage = execution["stop_stage"]
            deadline = execution["stop_deadline"]
            current = time.time()
            if stage is None or deadline is not None and current >= deadline:
                next_stage = {
                    None: "interrupt",
                    "interrupt": "terminate",
                    "terminate": "kill",
                    "kill": None,
                }[stage]
                if next_stage is None:
                    self._transition(identity, {"stopping"}, "needs_reconciliation")
                else:
                    timeout = (
                        self.interrupt_timeout
                        if next_stage == "interrupt"
                        else self.terminate_timeout
                        if next_stage == "terminate"
                        else 1.0
                    )
                    with self.units() as unit:
                        unit.experiments.update_execution(
                            identity, {"stop_stage": next_stage, "stop_deadline": current + timeout}
                        )
                    self.training.signal(receipt, next_stage)
        elif record["state"] in {"starting", "needs_reconciliation"}:
            self._transition(
                identity,
                {record["state"]},
                "stopping" if execution["stop_requested_at"] else "running",
            )
        try:
            self.collect(identity)
        except Exception:
            logger.exception("Artifact collection failed for %s", identity)

    def recover(self) -> None:
        with self.units() as unit:
            records = unit.experiments.executions(ACTIVE_STATES)
        for record in records:
            self._watch(record)

    def reconcile(self, identity: str) -> Record:
        with self.units() as unit:
            header = unit.experiments.get(identity)
            if header["state"] != "needs_reconciliation":
                raise DomainError("conflict", "Only uncertain executions require reconciliation")
            execution = unit.experiments.execution(identity)
        if execution["receipt"] is None:
            recovered = self.files.recover_receipts(identity, execution["intent_id"])
            if not recovered.get("receipt") or not recovered.get("prepared"):
                raise DomainError(
                    "needs_reconciliation", "A complete owned-process receipt is required"
                )
            if recovered["receipt"]["directory_ref"] != recovered["prepared"]["directory_ref"]:
                raise DomainError(
                    "needs_reconciliation", "Preparation and process directories differ"
                )
            with self.units() as unit:
                unit.experiments.update_execution(identity, recovered)
        with self.units() as unit:
            record = next(
                item
                for item in unit.experiments.executions({"needs_reconciliation"})
                if item["id"] == identity
            )
        self._watch(record)
        result = self.experiments.get(identity)
        if result["state"] == "needs_reconciliation":
            raise DomainError(
                "needs_reconciliation", "Process ownership or terminal evidence is still uncertain"
            )
        return result

    def tick(self) -> None:
        if not self._tick_lock.acquire(blocking=False):
            return
        try:
            with self.units() as unit:
                active = unit.experiments.executions(ACTIVE_STATES)
            for record in active:
                if record["state"] != "needs_reconciliation":
                    self._watch(record)
            with self.units() as unit:
                active = unit.experiments.executions(ACTIVE_STATES)
                pending = unit.experiments.executions({"queued"})
            for candidate in self.policy.choose(pending, active):
                self._start(candidate)
            self.collect_pending()
        finally:
            self._tick_lock.release()
