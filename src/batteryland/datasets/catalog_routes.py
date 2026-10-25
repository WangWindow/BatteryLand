"""Read-only provider-named data collections and split shortcuts."""

from typing import Annotated, Any, Literal, cast

from fastapi import APIRouter, Depends, Query, Request

from batteryland.api.schemas import Envelope, Page, RequestModel
from batteryland.container import Container
from batteryland.datasets.catalog import NamedGroupService

router = APIRouter(prefix="/api/v1/catalog/named-groups", tags=["catalog"])


class Counts(RequestModel):
    train: int
    val: int
    test: int
    matched: int
    missing: int
    ambiguous: int


class NamedGroup(RequestModel):
    id: str
    name: str
    manifest_sha256: str
    counts: Counts
    created_at: str


class NamedGroupDetail(NamedGroup):
    document: dict[str, Any]


class Member(RequestModel):
    partition: Literal["train", "val", "test"]
    ordinal: int
    file_name: str
    battery_id: str | None
    match_status: Literal["matched", "missing", "ambiguous"]
    candidate_count: int


def service(request: Request) -> NamedGroupService:
    return cast(Container, request.app.state.container).named_groups


@router.get("", response_model=Envelope[Page[NamedGroup]])
def list_groups(
    catalog: Annotated[NamedGroupService, Depends(service)],
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": catalog.list(page, page_size)}


@router.get("/{name}", response_model=Envelope[NamedGroupDetail])
def get_group(name: str, catalog: Annotated[NamedGroupService, Depends(service)]) -> dict[str, Any]:
    return {"data": catalog.get(name)}


@router.get("/{name}/members", response_model=Envelope[Page[Member]])
def list_members(
    name: str,
    catalog: Annotated[NamedGroupService, Depends(service)],
    partition: Literal["train", "val", "test"] | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": catalog.members(name, partition, page, page_size)}
