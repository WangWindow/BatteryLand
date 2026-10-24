from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from batteryland.application.resources import ResourceService
from batteryland.bootstrap import Container
from batteryland.interfaces.api.schemas import Envelope, Page, RequestModel

router = APIRouter(prefix="/api/v1", tags=["resources"])


class DataSourceWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    root_alias: str = Field(min_length=1)


class DataSource(RequestModel):
    id: str
    name: str
    root_alias: str
    revision: int
    availability: str
    created_at: str


class BatteryInput(RequestModel):
    file_name: str = Field(min_length=1)
    relative_key: str | None = None
    parent_battery_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Battery(BatteryInput):
    id: str
    source_id: str
    availability: str
    created_at: str


class BatteryImport(RequestModel):
    batteries: list[BatteryInput]


class ImportReport(RequestModel):
    imported: int
    existing: int
    errors: list[dict[str, Any]]


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


@router.post("/data-sources", status_code=201, response_model=Envelope[DataSource])
def add_source(
    body: DataSourceWrite, resources: Annotated[ResourceService, Depends(service)]
) -> dict[str, Any]:
    return {"data": resources.create_source(body.name, body.root_alias)}


@router.post("/data-sources/{source_id}/import", response_model=Envelope[ImportReport])
def import_batteries(
    source_id: UUID,
    body: BatteryImport,
    resources: Annotated[ResourceService, Depends(service)],
) -> dict[str, Any]:
    return {
        "data": resources.import_batteries(
            str(source_id),
            [item.model_dump(mode="json", exclude_none=True) for item in body.batteries],
        )
    }


@router.get("/batteries", response_model=Envelope[Page[Battery]])
def list_batteries(
    resources: Annotated[ResourceService, Depends(service)],
    source_id: UUID | None = None,
    q: str | None = None,
    chemistry: str | None = None,
    material: str | None = None,
    temperature_c: float | None = None,
    nominal_capacity_ah: float | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    filters = {
        "source_id": str(source_id) if source_id else None,
        "q": q,
        "chemistry": chemistry,
        "material": material,
        "temperature_c": temperature_c,
        "nominal_capacity_ah": nominal_capacity_ah,
    }
    return {"data": resources.list_batteries(filters, page, page_size)}


@router.get("/batteries/{battery_id}", response_model=Envelope[Battery])
def get_battery(
    battery_id: UUID, resources: Annotated[ResourceService, Depends(service)]
) -> dict[str, Any]:
    return {"data": resources.get_battery(str(battery_id))}
