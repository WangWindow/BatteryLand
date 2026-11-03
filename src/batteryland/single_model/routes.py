"""HTTP routes for single-model SOH curve visualization."""

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container

from .service import SingleModelService

router = APIRouter(prefix="/api/v1/single-model", tags=["single-model"])


class SohCurveRequest(RequestModel):
    dataset_name: str = Field(min_length=1, max_length=200)
    file_names: list[str] = Field(min_length=1, max_length=200)
    max_points: int = Field(default=300, ge=50, le=1000)


def service(request: Request) -> SingleModelService:
    return cast(Container, request.app.state.container).single_model


@router.post("/soh-curves", response_model=Envelope[dict[str, Any]])
def soh_curves(
    body: SohCurveRequest, single_model: Annotated[SingleModelService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": single_model.soh_curves(body.dataset_name, body.file_names, body.max_points)
    }
