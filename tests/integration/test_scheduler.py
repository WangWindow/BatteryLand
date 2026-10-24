import shutil
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from batteryland.config import Settings
from batteryland.interfaces.api.app import create_app


class ControlledTraining:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.started = []

    def validate(self, config, resources):
        return {
            "valid": True,
            "errors": [],
            "warnings": [],
            "provider_commit": "controlled-test",
            "components": [],
        }

    def prepare(self, materialized):
        experiment = materialized["experiment_id"]
        directory = self.settings.data_dir / "runs" / experiment
        directory.mkdir(parents=True, exist_ok=False)
        shutil.copyfile(materialized["config_path"], directory / "config.yaml")
        return {
            "experiment_id": experiment,
            "intent_id": materialized["intent_id"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
            "provider_config_sha256": materialized["config_sha256"],
            "directory": str(directory),
            "directory_ref": str(directory.relative_to(self.settings.data_dir)),
            "duration": materialized["snapshot"]["native_config"]["mate"].get("duration", 0.03),
        }

    def spawn(self, prepared):
        from batteryland.infrastructure.scheduling import ProcessSupervisor

        runner = getattr(self, "runner", None) or ProcessSupervisor()
        self.runner = runner
        self.started.append(prepared["experiment_id"])
        receipt = runner.start(
            [
                sys.executable,
                "-c",
                "import time; print('started',flush=True); time.sleep(float(__import__('sys').argv[1])); print('done',flush=True)",
                str(prepared["duration"]),
            ],
            Path(prepared["directory"]),
            prepared["experiment_id"],
        )
        return receipt | {
            "intent_id": prepared["intent_id"],
            "input_manifest_sha256": prepared["input_manifest_sha256"],
            "provider_config_sha256": prepared["provider_config_sha256"],
            "directory_ref": prepared["directory_ref"],
            "requested_device": "cpu",
            "effective_device": "cpu",
        }

    def observe(self, receipt):
        return self.runner.observe(receipt)

    def signal(self, receipt, stage):
        return self.runner.signal(receipt, stage)


def draft(client, name, device="cpu", duration=0.03):
    response = client.post(
        "/api/v1/experiments",
        json={
            "name": name,
            "native_config": {
                "mate": {"seed": 42, "device": device, "experiment": name, "duration": duration},
                "task": {"type": "MyTask"},
            },
        },
    )
    response.raise_for_status()
    return response.json()["data"]


def dispatch_next(client):
    queue = client.get("/api/v1/queue").json()["data"]
    if queue["active"] or queue["dispatch_paused"] or not queue["waiting"]:
        return
    item = queue["waiting"][0]
    client.post(
        "/api/v1/queue/dispatch",
        json={
            "experiment_id": item["id"],
            "expected_revision": item["revision"],
            "policy_id": "test-fifo",
        },
    ).raise_for_status()


def advance(container, client, identities, *, timeout=5):
    deadline = time.monotonic() + timeout
    states = []
    while time.monotonic() < deadline:
        dispatch_next(client)
        container.execution.tick()
        states = [
            client.get(f"/api/v1/experiments/{identity}").json()["data"]["state"]
            for identity in identities
        ]
        if all(state in {"succeeded", "failed", "stopped", "cancelled"} for state in states):
            return states
        time.sleep(0.01)
    raise AssertionError(f"Tasks did not finish: {states}")


def test_fifo_submission_is_single_use_and_snapshots_are_frozen(settings: Settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        entries = [draft(client, name) for name in "ABC"]
        identities = [item["id"] for item in entries]
        submitted = client.post("/api/v1/queue/submissions", json={"experiment_ids": identities})
        assert submitted.status_code == 202
        for _ in range(10):
            assert client.post(
                "/api/v1/queue/submissions", json={"experiment_ids": identities[:1]}
            ).status_code in {200, 202}
        assert (
            client.patch(
                f"/api/v1/experiments/{identities[0]}",
                json={"name": "mutated", "expected_revision": 1},
            ).status_code
            == 409
        )
        assert advance(app.state.container, client, identities) == ["succeeded"] * 3
        assert training.started == identities
        assert (
            client.post(
                "/api/v1/queue/submissions", json={"experiment_ids": identities[:1]}
            ).status_code
            == 409
        )
        copied = client.post(f"/api/v1/experiments/{identities[0]}/copy").json()["data"]
        assert copied["state"] == "draft" and copied["execution"] is None


def test_invalid_batch_is_atomic_and_stop_confirms_process_exit(settings: Settings):
    settings = Settings(
        data_dir=settings.data_dir,
        source_roots=settings.source_roots,
        interrupt_timeout=0.1,
        terminate_timeout=0.1,
    )
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        valid = draft(client, "valid", duration=30)
        invalid = draft(client, "invalid", device="auto")
        response = client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [valid["id"], invalid["id"]]}
        )
        assert response.status_code == 422
        assert client.get(f"/api/v1/experiments/{valid['id']}").json()["data"]["state"] == "draft"
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [valid["id"]]}
        ).raise_for_status()
        dispatch_next(client)
        app.state.container.execution.tick()
        stopping = client.post(f"/api/v1/experiments/{valid['id']}/stop")
        assert stopping.status_code == 202 and stopping.json()["data"]["state"] == "stopping"
        assert advance(app.state.container, client, [valid["id"]]) == ["stopped"]
        assert not training.runner.observe(training.runner.receipts[valid["id"]])["alive"]


def test_queued_cancel_and_restart_do_not_reexecute(settings: Settings):
    training = ControlledTraining(settings)
    with TestClient(create_app(settings, training=training, start_monitor=False)) as client:
        cancelled = draft(client, "cancel")
        waiting = draft(client, "wait")
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [cancelled["id"], waiting["id"]]}
        ).raise_for_status()
        assert (
            client.post(f"/api/v1/experiments/{cancelled['id']}/stop").json()["data"]["state"]
            == "cancelled"
        )
    second = ControlledTraining(settings)
    app = create_app(settings, training=second, start_monitor=False)
    with TestClient(app) as client:
        assert advance(app.state.container, client, [waiting["id"]]) == ["succeeded"]
        assert second.started == [waiting["id"]]
