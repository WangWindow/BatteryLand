"""Public workflow for complete provider-validated experiment inputs."""

from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from batteryland.application.validated_experiments import ValidatedExperimentService
from batteryland.bootstrap import Container
from batteryland.interfaces.api.schemas import Envelope, Page, RequestModel

router = APIRouter(prefix="/api/v1/validated-experiments", tags=["validated experiments"])


class ValidatedExperimentWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    config_text: str = Field(min_length=1, max_length=1024 * 1024)
    split_text: str = Field(min_length=1, max_length=8 * 1024 * 1024)
    receipt: dict[str, Any]


class ValidatedExperimentUpdate(ValidatedExperimentWrite):
    expected_revision: int = Field(ge=1)


class ValidatedExperiment(RequestModel):
    id: str
    name: str
    state: str
    revision: int
    version: int
    requested_device: str | None
    resolved_device: str | None
    actual_device: str | None
    actual_gpu_uuid: str | None
    experiment_id: str
    config_text: str
    split_text: str
    config_sha256: str
    split_sha256: str
    config: dict[str, Any]
    split: dict[str, Any]
    split_counts: dict[str, int]
    receipt: dict[str, Any]
    provider_commit: str
    created_at: str


def service(request: Request) -> ValidatedExperimentService:
    return cast(Container, request.app.state.container).validated_experiments


@router.post("", status_code=201, response_model=Envelope[ValidatedExperiment])
def create(
    body: ValidatedExperimentWrite,
    workflow: Annotated[ValidatedExperimentService, Depends(service)],
) -> dict[str, Any]:
    return {"data": workflow.create(body.name, body.config_text, body.split_text, body.receipt)}


@router.get("/{experiment_id}", response_model=Envelope[ValidatedExperiment])
def get(
    experiment_id: UUID,
    workflow: Annotated[ValidatedExperimentService, Depends(service)],
    version: int | None = Query(None, ge=1),
) -> dict[str, Any]:
    return {"data": workflow.get(str(experiment_id), version)}


class SplitMember(RequestModel):
    partition: Literal["train", "val", "test"]
    ordinal: int
    file_name: str


@router.get("/{experiment_id}/members", response_model=Envelope[Page[SplitMember]])
def members(
    experiment_id: UUID,
    workflow: Annotated[ValidatedExperimentService, Depends(service)],
    version: int | None = Query(None, ge=1),
    partition: Literal["train", "val", "test"] | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": workflow.members(str(experiment_id), version, partition, page, page_size)}


@router.put("/{experiment_id}", response_model=Envelope[ValidatedExperiment])
def update(
    experiment_id: UUID,
    body: ValidatedExperimentUpdate,
    workflow: Annotated[ValidatedExperimentService, Depends(service)],
) -> dict[str, Any]:
    return {
        "data": workflow.update(
            str(experiment_id),
            body.expected_revision,
            body.name,
            body.config_text,
            body.split_text,
            body.receipt,
        )
    }


@router.post(
    "/{experiment_id}/submit", status_code=202, response_model=Envelope[ValidatedExperiment]
)
def submit(
    experiment_id: UUID,
    workflow: Annotated[ValidatedExperimentService, Depends(service)],
) -> dict[str, Any]:
    return {"data": workflow.submit(str(experiment_id))}
