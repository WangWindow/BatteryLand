"""Read-only BatteryLife exploration under BatteryLand battery identities."""

from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container
from batteryland.datasets.battery_detail import BatteryDetailService

router = APIRouter(prefix="/api/v1/batteries", tags=["battery-detail"])


class CapacityCycle(RequestModel):
    index: int
    number: int | None
    discharge_capacity_ah: float | None
    charge_capacity_ah: float | None
    relative_capacity_percent: float | None


class BatteryAnalysis(RequestModel):
    battery_id: str
    source_id: str
    source_name: str
    file_name: str
    registered_metadata: dict[str, Any]
    metadata: dict[str, Any]
    life_label: float | None
    life_label_file: str | None
    cycle_count: int
    first_recorded_cycle: int | None
    last_recorded_cycle: int | None
    max_recorded_cycle: int | None
    first_valid_discharge_ah: float | None
    cycles: list[CapacityCycle]


class CycleSamples(RequestModel):
    index: int
    number: int | None
    point_count: int
    sample_indices: list[int]
    duration_min: float | None
    time_unit: str
    points: list[list[float | None]]


def detail_service(request: Request) -> BatteryDetailService:
    return cast(Container, request.app.state.container).battery_detail


@router.get("/{battery_id}/analysis", response_model=Envelope[BatteryAnalysis])
def analysis(
    battery_id: UUID, detail: Annotated[BatteryDetailService, Depends(detail_service)]
) -> dict[str, Any]:
    return {"data": detail.summary(str(battery_id))}


@router.get("/{battery_id}/cycles/{index}", response_model=Envelope[CycleSamples])
def cycle(
    battery_id: UUID, index: int, detail: Annotated[BatteryDetailService, Depends(detail_service)]
) -> dict[str, Any]:
    return {"data": detail.cycle(str(battery_id), index)}
