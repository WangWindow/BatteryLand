from contextlib import AbstractContextManager
from typing import Any, Protocol

from batteryland.domain.documents import DocumentRef


class DocumentStore(Protocol):
    def write_lock(self) -> AbstractContextManager[None]: ...

    def publish(
        self,
        kind: str,
        owner_id: str,
        version: int,
        payload: dict[str, Any],
        *,
        document_id: str | None = None,
    ) -> DocumentRef: ...

    def read(self, reference: DocumentRef) -> dict[str, Any]: ...
