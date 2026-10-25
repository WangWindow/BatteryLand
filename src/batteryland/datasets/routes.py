from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from batteryland.api.schemas import Envelope, Page, RequestModel
from batteryland.container import Container
from batteryland.datasets.service import ResourceService

router = APIRouter(prefix="/api/v1", tags=["resources"])


class SourceOption(RequestModel):
    root_alias: str
    display_name: str
    availability: str
    file_count: int


class DataSource(RequestModel):
    id: str
    name: str
    root_alias: str
    group_prefix: str
    revision: int
    battery_count: int
    available_battery_count: int
    availability: str
    created_at: str


class Battery(RequestModel):
    id: str
    source_id: str
    file_name: str
    relative_key: str
    parent_battery_id: str | None
    metadata: dict[str, Any]
    availability: str
    file_size_bytes: int | None
    modified_at_ns: int | None
    created_at: str


class DiscoveredBatteryFile(RequestModel):
    file_name: str
    relative_key: str
    size_bytes: int = Field(ge=0)
    importable: bool
    reason: str | None


class Pagination(RequestModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=200)


def service(request: Request) -> ResourceService:
    return cast(Container, request.app.state.container).resources


@router.get("/data-sources", response_model=Envelope[Page[DataSource]])
def list_sources(
    paging: Annotated[Pagination, Query()], resources: Annotated[ResourceService, Depends(service)]
) -> dict[str, Any]:
    return {"data": resources.list_sources(paging.page, paging.page_size)}


@router.get("/data-sources/options", response_model=Envelope[list[SourceOption]])
def source_options(resources: Annotated[ResourceService, Depends(service)]) -> dict[str, Any]:
    return {"data": resources.source_options()}


@router.get("/data-sources/{source_id}/files", response_model=Envelope[Page[DiscoveredBatteryFile]])
def source_files(
    source_id: UUID,
    resources: Annotated[ResourceService, Depends(service)],
    q: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": resources.list_source_files(str(source_id), q, page, page_size)}


@router.get("/batteries", response_model=Envelope[Page[Battery]])
def list_batteries(
    resources: Annotated[ResourceService, Depends(service)],
    source_ids: Annotated[list[UUID] | None, Query()] = None,
    q: str | None = None,
    chemistry: str | None = None,
    material: str | None = None,
    temperature_c: float | None = None,
    nominal_capacity_ah: float | None = None,
    temperature_c_min: float | None = None,
    temperature_c_max: float | None = None,
    nominal_capacity_ah_min: float | None = None,
    nominal_capacity_ah_max: float | None = None,
    availability: str | None = Query(default=None, max_length=32),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    filters = {
        "source_ids": [str(source_id) for source_id in source_ids]
        if source_ids is not None
        else None,
        "q": q,
        "chemistry": chemistry,
        "material": material,
        "temperature_c": temperature_c,
        "nominal_capacity_ah": nominal_capacity_ah,
        "temperature_c_min": temperature_c_min,
        "temperature_c_max": temperature_c_max,
        "nominal_capacity_ah_min": nominal_capacity_ah_min,
        "nominal_capacity_ah_max": nominal_capacity_ah_max,
        "availability": availability,
    }
    return {"data": resources.list_batteries(filters, page, page_size)}


@router.get("/batteries/facets", response_model=Envelope[dict[str, Any]])
def battery_facets(
    resources: Annotated[ResourceService, Depends(service)],
    source_ids: Annotated[list[UUID] | None, Query()] = None,
) -> dict[str, Any]:
    return {
        "data": resources.battery_facets(
            [str(source_id) for source_id in source_ids] if source_ids is not None else None
        )
    }


@router.get("/batteries/{battery_id}", response_model=Envelope[Battery])
def get_battery(
    battery_id: UUID, resources: Annotated[ResourceService, Depends(service)]
) -> dict[str, Any]:
    return {"data": resources.get_battery(str(battery_id))}
