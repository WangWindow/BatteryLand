from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient
from test_scheduler import ControlledTraining, draft

from batteryland.interfaces.api.app import create_app


@pytest.fixture
def platform(settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        try:
            yield client, app.state.container, training
        finally:
            if hasattr(training, "runner"):
                for receipt in training.runner.receipts.values():
                    training.runner.signal(receipt, "kill")
                for process in training.runner.processes.values():
                    process.wait(timeout=5)


def queued(client, name):
    item = draft(client, name, duration=1)
    response = client.post("/api/v1/queue/submissions", json={"experiment_ids": [item["id"]]})
    response.raise_for_status()
    return response.json()["data"][0]


def dispatch(client, item, **fields):
    return client.post(
        "/api/v1/queue/dispatch",
        json={"experiment_id": item["id"], "expected_revision": item["revision"]} | fields,
    )


def test_backend_tick_dispatches_queued_work_without_an_http_client(platform, monkeypatch):
    client, container, training = platform
    item = queued(client, "waiting")
    import httpx

    def unexpected_http(*args, **kwargs):
        raise AssertionError("Internal scheduling must not use HTTP")

    monkeypatch.setattr(httpx.Client, "request", unexpected_http)
    container.execution.tick()
    assert container.experiments.get(item["id"])["state"] == "running"
    assert training.started == [item["id"]]


def test_internal_policy_can_change_selection_without_changing_execution(platform):
    client, container, training = platform
    entries = [queued(client, name) for name in ("first", "last")]

    class LastPolicy:
        def choose(self, pending, active):
            return pending[-1] if pending and not active else None

    container.execution.scheduler = LastPolicy()
    container.execution.tick()
    assert training.started == [entries[-1]["id"]]


def test_dispatch_is_idempotent_and_preserves_execution_identity(platform):
    client, container, training = platform
    item = queued(client, "once")
    first = dispatch(client, item)
    assert first.status_code == 202, first.text
    for _ in range(10):
        repeated = dispatch(client, item)
        assert repeated.status_code == 200
        assert repeated.json()["data"]["id"] == item["id"]
    assert training.started == [item["id"]]


def test_concurrent_dispatches_cannot_exceed_capacity(platform):
    client, container, training = platform
    entries = [queued(client, name) for name in ("first", "second")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda item: dispatch(client, item), entries))
    assert sorted(response.status_code for response in responses) == [202, 409]
    assert len(training.started) == 1


def test_stale_revision_and_unexpected_control_fields_are_rejected(platform):
    client, container, training = platform
    item = queued(client, "revision")
    assert dispatch(client, item, expected_revision=item["revision"] + 1).status_code == 409
    assert dispatch(client, item, device="cuda:0").status_code == 422
    assert dispatch(client, item, expected_revision=0).status_code == 422
    assert training.started == []


def test_uncertain_execution_blocks_another_dispatch(platform):
    client, container, training = platform
    first, second = [queued(client, name) for name in ("uncertain", "blocked")]
    assert dispatch(client, first).status_code == 202
    container.execution._transition(first["id"], {"running"}, "needs_reconciliation")
    response = dispatch(client, second)
    assert response.status_code == 409
    assert response.json()["data"]["error"] == "needs_reconciliation"
    assert len(training.started) == 1


def test_stop_during_preparation_never_spawns(platform, monkeypatch):
    client, container, training = platform
    entered, proceed = Event(), Event()
    original = training.prepare

    def prepare(value):
        entered.set()
        assert proceed.wait(5)
        return original(value)

    monkeypatch.setattr(training, "prepare", prepare)
    item = queued(client, "stop-before-start")
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(dispatch, client, item)
        try:
            assert entered.wait(5)
            assert client.post(f"/api/v1/experiments/{item['id']}/stop").status_code == 202
        finally:
            proceed.set()
        assert future.result(timeout=10).json()["data"]["state"] == "stopped"
    assert training.started == []
