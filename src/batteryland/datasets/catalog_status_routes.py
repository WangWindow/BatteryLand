"""Expose background asset-catalog synchronization state."""

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container

router = APIRouter(prefix="/api/v1/catalog", tags=["catalog"])


class CatalogStatus(RequestModel):
    state: str
    generation: int
    file_count: int
    source_count: int
    started_at: str | None
    completed_at: str | None
    error: str | None


def status(request: Request) -> dict[str, Any]:
    container = cast(Container, request.app.state.container)
    with container.database.unit_of_work() as unit:
        return unit.catalog.status()


@router.get("/status", response_model=Envelope[CatalogStatus])
def get_status(catalog: Annotated[dict[str, Any], Depends(status)]) -> dict[str, Any]:
    return {"data": catalog}
