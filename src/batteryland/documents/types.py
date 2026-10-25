"""Identity of an immutable business document."""

from dataclasses import dataclass


@dataclass(frozen=True)
class DocumentRef:
    id: str
    kind: str
    owner_id: str
    version: int
    storage_key: str
    sha256: str
    created_at: str
