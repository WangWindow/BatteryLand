"""Provider operations used by component and training workflows."""

from typing import Protocol

from batteryland.db.contracts import Record


class ComponentGateway(Protocol):
    def components(self, scope: str | None = None) -> list[Record]: ...
    def schema(self, scope: str, name: str) -> Record: ...
    def upload(self, scope: str, filename: str, content: bytes) -> Record: ...
