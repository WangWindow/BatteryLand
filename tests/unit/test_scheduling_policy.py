import pytest

from batteryland.scheduler.policy import FifoPolicy


def test_fifo_preserves_the_persisted_queue_order():
    pending = [{"id": "first"}, {"id": "second"}]
    assert FifoPolicy().choose(pending, []) == pending[0]
    assert pending == [{"id": "first"}, {"id": "second"}]


@pytest.mark.parametrize(
    "pending,active",
    [
        ([], []),
        ([{"id": "waiting"}], [{"state": "running"}]),
        ([{"id": "waiting"}], [{"state": "needs_reconciliation"}]),
    ],
)
def test_policy_does_not_dispatch_without_available_capacity(pending, active):
    assert FifoPolicy().choose(pending, active) is None
