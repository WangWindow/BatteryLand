from typing import Any

from batteryland.scheduler.service import LocalScheduler


class SchedulerStateStub:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    def event(self, *args: Any) -> dict[str, Any]:
        kind, data = args[-2:]
        self.events.append((kind, data))
        return {}


class TrainingStub:
    def __init__(self) -> None:
        self.alive = True

    def status(self, experiment_id: str) -> dict[str, Any]:
        return {
            "receipt": {"pid": 123},
            "observation": {
                "identity_matches": True,
                "alive": self.alive,
                "exit_code": None if self.alive else 0,
                "provider_status": "running" if self.alive else "completed",
            },
        }

    def outputs(
        self, experiment_id: str, console_cursor: str | None, metrics_offset: int
    ) -> dict[str, Any]:
        return {
            "console": {"text": "", "next_cursor": console_cursor},
            "console_start_offset": 0,
            "metrics_text": "",
            "metrics_next_offset": metrics_offset,
            "result": {"epoch": 1 if self.alive else 2},
            "artifacts": [],
        }


class ResultsStub:
    def __init__(self, fail_result: bool = False) -> None:
        self.results: list[dict[str, int]] = []
        self.fail_result = fail_result

    def ingest_external_result(self, experiment_id: str, result: dict[str, int]) -> None:
        if self.fail_result:
            raise RuntimeError("result import failed")
        self.results.append(result)


def running_scheduler(
    *, fail_result: bool = False
) -> tuple[LocalScheduler, dict[str, Any], dict[str, list[Any]]]:
    scheduler = LocalScheduler.__new__(LocalScheduler)
    scheduler.scheduler_state = SchedulerStateStub()
    scheduler.training = TrainingStub()
    scheduler.results = ResultsStub(fail_result)
    scheduler.artifacts = object()
    scheduler.cursors = {}
    scheduler.uploaded_artifacts = set()
    scheduler.stop_stages = {}
    scheduler.last_action = "initialized"

    record = {
        "experiment_id": "experiment-1",
        "claim_token": "claim-1",
        "revision": 3,
        "state": "running",
    }
    snapshot = {"gpus": []}
    return scheduler, record, snapshot


def test_scheduler_imports_mutable_result_only_after_process_exit() -> None:
    scheduler, record, snapshot = running_scheduler()

    scheduler._observe(record, snapshot)

    assert scheduler.results.results == []
    assert scheduler.scheduler_state.events == []

    scheduler.training.alive = False
    scheduler._observe(record, snapshot)

    assert scheduler.results.results == [{"epoch": 2}]
    assert scheduler.scheduler_state.events == [
        ("finished", {"result": "succeeded", "exit_code": 0})
    ]


def test_output_collection_error_does_not_block_terminal_state_update() -> None:
    scheduler, record, snapshot = running_scheduler(fail_result=True)
    scheduler.training.alive = False

    scheduler._observe(record, snapshot)

    assert scheduler.scheduler_state.events == [
        ("finished", {"result": "succeeded", "exit_code": 0})
    ]
