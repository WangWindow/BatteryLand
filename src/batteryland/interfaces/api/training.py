"""Single-port validation and local coordinator status."""

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request

from batteryland.bootstrap import Container
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.training.runs import TrainingRunService
from batteryland.interfaces.api.schemas import Envelope, RequestModel

router = APIRouter(prefix="/api/v1", tags=["training and scheduling"])


class ValidationRequest(RequestModel):
    config_text: str
    split_text: str


def training_service(request: Request) -> TrainingRunService:
    service = cast(Container, request.app.state.container).training_runs
    if service is None:
        raise DomainError("unsupported_capability", "Local training validation is unavailable")
    return service


@router.post("/training/validation", response_model=Envelope[dict[str, Any]])
def validate(
    body: ValidationRequest, service: Annotated[TrainingRunService, Depends(training_service)]
) -> dict[str, Any]:
    return {"data": service.validate(body.config_text, body.split_text)}


@router.get("/scheduler/status", response_model=Envelope[dict[str, Any]])
def scheduler_status(request: Request) -> dict[str, Any]:
    scheduler = getattr(request.app.state, "scheduler", None)
    return {
        "data": {
            "enabled": scheduler is not None,
            "node_id": scheduler.node_id if scheduler else None,
            "last_action": scheduler.last_action if scheduler else None,
            "reason": scheduler.last_reason if scheduler else None,
        }
    }


@router.get("/scheduler/resources", response_model=Envelope[list[dict[str, Any]]])
def scheduler_resources(request: Request) -> dict[str, Any]:
    container = cast(Container, request.app.state.container)
    return {"data": container.workers.nodes()}
