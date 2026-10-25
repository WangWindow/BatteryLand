"""Queue selection policies independent of persistence and process control."""

from typing import Any


class FifoPolicy:
    def choose(
        self, pending: list[dict[str, Any]], active: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        return pending[0] if pending and not active else None
