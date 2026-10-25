from typing import Protocol

from batteryland.db.contracts import Record


class SchedulingPolicy(Protocol):
    def choose(self, pending: list[Record], active: list[Record]) -> Record | None: ...
