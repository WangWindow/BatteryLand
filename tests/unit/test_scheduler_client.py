import json

import httpx
import pytest

from simple_impl.scheduler.client import FifoPolicy, SchedulerClient


def test_fifo_dispatches_the_first_server_ordered_candidate():
    calls = []

    def transport(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "waiting": [
                            {"id": "first", "revision": 2},
                            {"id": "second", "revision": 3},
                        ],
                        "active": [],
                        "dispatch_paused": False,
                    }
                },
            )
        return httpx.Response(202, json={"data": {"id": "first"}})

    with httpx.Client(base_url="http://engine", transport=httpx.MockTransport(transport)) as http:
        assert SchedulerClient(http).tick() == "first"
    assert json.loads(calls[1].content) == {
        "experiment_id": "first",
        "expected_revision": 2,
        "policy_id": "fifo",
    }


@pytest.mark.parametrize("state", [{"active": [{}]}, {"dispatch_paused": True}, {"waiting": []}])
def test_no_dispatch_when_capacity_or_queue_is_unavailable(state):
    queue = {
        "waiting": [{"id": "first", "revision": 1}],
        "active": [],
        "dispatch_paused": False,
    } | state
    assert FifoPolicy().choose(queue) is None


def test_policy_can_be_replaced_without_engine_imports():
    class LastPolicy:
        policy_id = "last-test-only"

        def choose(self, queue):
            return queue["waiting"][-1]

    calls = []

    def transport(request):
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "waiting": [{"id": "a", "revision": 1}, {"id": "b", "revision": 2}],
                        "active": [],
                        "dispatch_paused": False,
                    }
                },
            )
        calls.append(json.loads(request.content))
        return httpx.Response(202, json={"data": {"id": "b"}})

    with httpx.Client(base_url="http://engine", transport=httpx.MockTransport(transport)) as http:
        assert SchedulerClient(http, LastPolicy()).tick() == "b"
    assert calls[0]["policy_id"] == "last-test-only"


@pytest.mark.parametrize("failure", [409, 503, "timeout"])
def test_lost_or_conflicting_dispatch_refreshes_queue_before_retry(failure):
    posts = []

    def transport(request):
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "waiting": [{"id": "first", "revision": 1}],
                        "active": [{}] if posts else [],
                        "dispatch_paused": False,
                    }
                },
            )
        posts.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("Response lost after claim", request=request)
        return httpx.Response(failure, json={"message": "refresh"})

    with httpx.Client(base_url="http://engine", transport=httpx.MockTransport(transport)) as http:
        worker = SchedulerClient(http)
        assert worker.tick() is None
        assert worker.tick() is None
    assert len(posts) == 1
