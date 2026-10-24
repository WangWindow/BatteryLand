import threading

import pytest
from fastapi.testclient import TestClient
from test_scheduler import ControlledTraining, advance, dispatch_next, draft

from batteryland.bootstrap import Container
from batteryland.config import Settings
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.persistence.database import Database
from batteryland.interfaces.api.app import create_app


def test_reconciliation_recovers_committed_disk_receipt_without_respawn(settings: Settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        identity = draft(client, "uncertain", duration=30)["id"]
        container = app.state.container
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [identity]}
        ).raise_for_status()
        dispatch_next(client)
        container.execution.tick()
        with container.database.unit_of_work() as unit:
            original = unit.experiments.execution(identity)["receipt"]
            unit.experiments.transition(identity, {"running"}, "needs_reconciliation", {})
            unit.experiments.update_execution(identity, {"receipt": None})
        try:
            assert container.execution.queue()["dispatch_paused"]
            container.execution.tick()
            assert training.started == [identity]
            assert container.execution.reconcile(identity)["state"] == "running"
            assert training.started == [identity]
            client.post(f"/api/v1/experiments/{identity}/stop").raise_for_status()
            assert advance(container, client, [identity]) == ["stopped"]
        finally:
            training.signal(original, "kill")


def test_uncertain_recovery_preserves_stop_intent(settings: Settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        identity = draft(client, "stopping", duration=30)["id"]
        container = app.state.container
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [identity]}
        ).raise_for_status()
        dispatch_next(client)
        container.execution.tick()
        with container.database.unit_of_work() as unit:
            receipt = unit.experiments.execution(identity)["receipt"]
        try:
            client.post(f"/api/v1/experiments/{identity}/stop").raise_for_status()
            with container.database.unit_of_work() as unit:
                unit.experiments.transition(identity, {"stopping"}, "needs_reconciliation", {})
            assert container.execution.reconcile(identity)["state"] == "stopping"
            assert advance(container, client, [identity]) == ["stopped"]
        finally:
            training.signal(receipt, "kill")


def test_runtime_lease_and_failed_startup_release(settings: Settings, monkeypatch):
    container = Container(settings)
    try:
        with pytest.raises(DomainError, match="Another backend"):
            Container(settings)
    finally:
        container.close()
    original = Database.initialize

    def fail(self):
        raise RuntimeError("Migration failed")

    monkeypatch.setattr(Database, "initialize", fail)
    with pytest.raises(RuntimeError, match="Migration failed"):
        Container(settings)
    monkeypatch.setattr(Database, "initialize", original)
    restored = Container(settings)
    restored.close()


def test_stop_during_confirmed_preparation_failure_has_no_process(settings: Settings):
    entered, release = threading.Event(), threading.Event()

    class FailedPreparation(ControlledTraining):
        def prepare(self, materialized):
            entered.set()
            assert release.wait(5)
            raise DomainError("integration_precondition_failed", "Preparation failed before spawn")

    training = FailedPreparation(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        identity = draft(client, "prepare-race")["id"]
        container = app.state.container
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [identity]}
        ).raise_for_status()
        worker = threading.Thread(target=lambda: dispatch_next(client))
        worker.start()
        try:
            assert entered.wait(5)
            assert (
                client.post(f"/api/v1/experiments/{identity}/stop").json()["data"]["state"]
                == "stopping"
            )
        finally:
            release.set()
            worker.join(timeout=5)
        assert not worker.is_alive()
        assert container.experiments.get(identity)["state"] == "stopped"
        assert training.started == []
