"""Public experiment response models."""

from typing import Any

from batteryland.api.schemas import RequestModel


class ExperimentSummary(RequestModel):
    id: str
    name: str
    kind: str
    state: str
    revision: int
    created_at: str
    requested_device: str | None
    effective_device: str | None
    actual_device: str | None
    actual_gpu_uuid: str | None
    execution: dict[str, Any] | None
    collection: dict[str, Any]
