"""HTTP scheduling boundary, without access to engine internals."""

import logging
from typing import Any, Protocol

import httpx

logger = logging.getLogger(__name__)


class SchedulingPolicy(Protocol):
    policy_id: str

    def choose(self, queue: dict[str, Any]) -> dict[str, Any] | None: ...


class FifoPolicy:
    policy_id = "fifo"

    def choose(self, queue: dict[str, Any]) -> dict[str, Any] | None:
        if queue["active"] or queue["dispatch_paused"] or not queue["waiting"]:
            return None
        return queue["waiting"][0]


class SchedulerClient:
    def __init__(self, client: httpx.Client, policy: SchedulingPolicy | None = None) -> None:
        self.client = client
        self.policy = policy or FifoPolicy()

    def tick(self) -> str | None:
        try:
            response = self.client.get("/api/v1/queue")
            response.raise_for_status()
            candidate = self.policy.choose(response.json()["data"])
            if candidate is None:
                return None
            response = self.client.post(
                "/api/v1/queue/dispatch",
                json={
                    "experiment_id": candidate["id"],
                    "expected_revision": candidate["revision"],
                    "policy_id": self.policy.policy_id,
                },
            )
            response.raise_for_status()
            return response.json()["data"]["id"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            # Refresh the authoritative queue on the next tick. A lost response
            # may already have claimed the execution; never create a new one.
            logger.warning("Scheduler request failed; refreshing on next poll: %s", exc)
            return None
