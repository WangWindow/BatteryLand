"""In-process FIFO coordinator. Training itself stays in an isolated Python process."""

import logging
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.components.service import ArtifactService
from batteryland.experiments.validated import ValidatedExperimentService
from batteryland.results.service import ResultService
from batteryland.scheduler.resources import ResourceSampler, choose_device
from batteryland.scheduler.state import SchedulerStateService
from batteryland.training.runs import StartCommand, TrainingRunService

logger = logging.getLogger(__name__)


class LocalScheduler:
    def __init__(
        self,
        scheduler_state: SchedulerStateService,
        experiments: ValidatedExperimentService,
        training: TrainingRunService,
        results: ResultService,
        artifacts: ArtifactService,
        data_dir: Path,
        sampler: ResourceSampler | None = None,
    ) -> None:
        self.scheduler_state = scheduler_state
        self.experiments = experiments
        self.training = training
        self.results = results
        self.artifacts = artifacts
        self.sampler = sampler or ResourceSampler()
        folder = data_dir / "scheduler"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "node-id"
        if not path.exists():
            path.write_text(str(uuid4()))
        self.node_id = path.read_text().strip()
        self.last_action = "initialized"
        self.last_reason: str | None = None
        self.stop_stages: dict[str, tuple[str, float]] = {}

    def _event(self, record: dict[str, Any], kind: str, data: dict[str, Any]) -> dict[str, Any]:
        return self.scheduler_state.event(
            record["experiment_id"],
            str(uuid4()),
            record["claim_token"],
            record["revision"],
            kind,
            data,
        )

    def _launch(self, claim: dict[str, Any]) -> None:
        identity = claim["experiment_id"]
        current = next(
            (
                item
                for item in self.scheduler_state.active(self.node_id)
                if item["experiment_id"] == identity
            ),
            claim,
        )
        if current["state"] == "stopping":
            self._event(current, "finished", {"result": "stopped", "exit_code": None})
            self.last_action = f"stopped-before-launch:{identity}"
            return
        original = claim["input"]
        try:
            process = self.training.start(
                StartCommand(
                    experiment_id=identity,
                    intent_id=claim["intent_id"],
                    resolved_device=claim["resolved_device"],
                    config_text=original["config_text"],
                    split_text=original["split_text"],
                    split_id=original["split_id"],
                    split_version=original["split_version"],
                    receipt=original["receipt"],
                )
            )
        except Exception as exc:
            # A failed start may have launched a process. Observe once; never call start again.
            try:
                process = self.training.status(identity)["receipt"]
            except Exception:
                self._event(claim, "uncertain", {"reason": str(exc)})
                self.last_action = f"uncertain:{identity}"
                return
        self._event(claim, "started", {"receipt": process})
        self.last_action = f"started:{identity}"

    def _outputs(self, record: dict[str, Any], *, include_final_result: bool = False) -> None:
        identity = record["experiment_id"]
        output = self.training.outputs(identity)
        for artifact in output["artifacts"]:
            kind = artifact.get("kind")
            if kind == "metrics":
                self.results.ingest_external_metrics(identity, artifact)
            elif kind == "result" and include_final_result:
                self.results.ingest_external_result(identity, artifact)
            elif kind in {"checkpoint", "config", "file", "status", "input_manifest"}:
                if artifact.get("sha256"):
                    self.artifacts.register_execution_artifact(identity, artifact)

    def _observe(self, record: dict[str, Any], snapshot: dict[str, Any]) -> None:
        identity = record["experiment_id"]
        try:
            current = self.training.status(identity)
        except DomainError as exc:
            if record["state"] in {"starting", "stopping"}:
                self._event(record, "uncertain", {"reason": exc.message})
                self.last_action = f"uncertain:{identity}"
            else:
                self.last_reason = exc.message
            return
        observation = current["observation"]
        if not observation.get("identity_matches"):
            self._event(record, "uncertain", {"reason": "Process identity cannot be verified"})
            self.last_action = f"uncertain:{identity}"
            return
        if record["state"] == "starting":
            self._event(record, "started", {"receipt": current["receipt"]})
            self.last_action = f"observed-start:{identity}"
            return
        if observation["alive"]:
            try:
                self._outputs(record)
            except Exception:
                logger.exception("Failed to collect live outputs for experiment %s", identity)
            if record.get("actual_device") is None:
                pid = current["receipt"].get("pid")
                gpu = next(
                    (
                        item
                        for item in snapshot.get("gpus", [])
                        if f"cuda:{item.get('cuda_index')}" == record["resolved_device"]
                        and pid in (item.get("process_pids") or [])
                    ),
                    None,
                )
                if gpu is not None:
                    self._event(record, "device_observed", {"gpu_uuid": gpu["uuid"]})
            if record["state"] == "stopping":
                previous, began = self.stop_stages.get(identity, ("", 0.0))
                now = time.monotonic()
                stage = (
                    "interrupt"
                    if not previous
                    else "terminate"
                    if previous == "interrupt" and now - began >= 10
                    else "kill"
                    if previous == "terminate" and now - began >= 5
                    else None
                )
                if stage:
                    self.training.stop(identity, stage)
                    self.stop_stages[identity] = (stage, now)
                    self.last_action = f"{stage}:{identity}"
            return
        code = observation.get("exit_code")
        status = observation.get("provider_status")
        if code == 0 or status == "completed":
            result = "succeeded"
        elif record["state"] == "stopping":
            result = "stopped"
        elif code is not None or status in {"failed", "interrupted"}:
            result = "failed"
        else:
            self._event(record, "uncertain", {"reason": "No terminal process evidence"})
            self.last_action = f"uncertain:{identity}"
            return
        try:
            self._outputs(record, include_final_result=True)
        except Exception:
            logger.exception("Failed to collect final outputs for experiment %s", identity)
        self._event(record, "finished", {"result": result, "exit_code": code})
        self.stop_stages.pop(identity, None)
        self.last_action = f"{result}:{identity}"

    def tick(self) -> None:
        snapshot = self.sampler.sample()
        self.scheduler_state.heartbeat(self.node_id, snapshot)
        active = self.scheduler_state.active(self.node_id)
        if active:
            for record in active:
                if record["state"] != "needs_reconciliation":
                    self._observe(record, snapshot)
            return
        queue = self.experiments.queue()
        if queue["active"] or not queue["waiting"]:
            self.last_action = "idle"
            return
        first = queue["waiting"][0]
        requested = first.get("requested_device")
        device = choose_device(requested, snapshot) if isinstance(requested, str) else None
        if device is None:
            self.last_action = "waiting-for-gpu"
            self.last_reason = snapshot.get("reason") or f"No available GPU for {requested}"
            return
        claim, _ = self.scheduler_state.claim(
            first["id"], first["revision"], self.node_id, device, str(uuid4())
        )
        self._launch(claim)
