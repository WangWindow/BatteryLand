"""Create and browse logical datasets backed by indexed battery identities."""

from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from batteryland.api.schemas import Envelope, Page, RequestModel
from batteryland.container import Container
from batteryland.datasets.logical import LogicalDatasetService
from batteryland.datasets.routes import Battery

router = APIRouter(prefix="/api/v1/logical-datasets", tags=["logical-datasets"])


class SourceSelection(RequestModel):
    source_id: UUID
    expected_revision: int = Field(ge=1)
    include_all: bool = False
    battery_ids: list[UUID] = Field(default_factory=list)
    excluded_battery_ids: list[UUID] = Field(default_factory=list)


class LogicalDatasetWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    source_selections: list[SourceSelection] = Field(min_length=1)


class PreviewWrite(RequestModel):
    source_selections: list[SourceSelection] = Field(min_length=1)


class LogicalDataset(RequestModel):
    id: str
    name: str
    description: str
    source_snapshot: list[dict[str, Any]]
    member_count: int
    stale: bool
    created_at: str


class LogicalDatasetMember(Battery):
    ordinal: int


def service(request: Request) -> LogicalDatasetService:
    return cast(Container, request.app.state.container).logical_datasets


@router.post("/preview", response_model=Envelope[Page[Battery]])
def preview(
    body: PreviewWrite,
    datasets: Annotated[LogicalDatasetService, Depends(service)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=40, ge=1, le=200),
) -> dict[str, Any]:
    return {
        "data": datasets.preview(
            [item.model_dump(mode="json") for item in body.source_selections], page, page_size
        )
    }


@router.post("", response_model=Envelope[LogicalDataset], status_code=201)
def create(
    body: LogicalDatasetWrite,
    datasets: Annotated[LogicalDatasetService, Depends(service)],
) -> dict[str, Any]:
    return {
        "data": datasets.create(
            body.name,
            body.description,
            [item.model_dump(mode="json") for item in body.source_selections],
        )
    }


@router.get("", response_model=Envelope[Page[LogicalDataset]])
def list_datasets(
    datasets: Annotated[LogicalDatasetService, Depends(service)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": datasets.list(page, page_size)}


@router.get("/{dataset_id}", response_model=Envelope[LogicalDataset])
def get(
    dataset_id: UUID, datasets: Annotated[LogicalDatasetService, Depends(service)]
) -> dict[str, Any]:
    return {"data": datasets.get(str(dataset_id))}


@router.get("/{dataset_id}/members", response_model=Envelope[Page[LogicalDatasetMember]])
def members(
    dataset_id: UUID,
    datasets: Annotated[LogicalDatasetService, Depends(service)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": datasets.members(str(dataset_id), page, page_size)}


@router.delete("/{dataset_id}", response_model=Envelope[dict[str, bool]])
def delete(
    dataset_id: UUID, datasets: Annotated[LogicalDatasetService, Depends(service)]
) -> dict[str, Any]:
    return {"data": datasets.delete(str(dataset_id))}
