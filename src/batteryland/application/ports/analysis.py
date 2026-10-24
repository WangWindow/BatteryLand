from typing import Protocol

from batteryland.application.ports.persistence import Record


class DifferenceAnalyzer(Protocol):
    def compare(self, sets: list[Record], kind: str, category: str | None) -> Record: ...


class ChartBuilder(Protocol):
    def build(self, request: Record, data: Record) -> Record: ...
