"""Public queue status for the in-process scheduler."""

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Request

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container
from batteryland.experiments.schemas import ExperimentSummary
from batteryland.experiments.validated import ValidatedExperimentService

router = APIRouter(prefix="/api/v1/scheduler", tags=["scheduler"])


class Queue(RequestModel):
    waiting: list[ExperimentSummary]
    active: list[ExperimentSummary]
    dispatch_paused: bool
    reason: str | None


def service(request: Request) -> ValidatedExperimentService:
    return cast(Container, request.app.state.container).validated_experiments


@router.get("/queue", response_model=Envelope[Queue])
def queue(workflow: Annotated[ValidatedExperimentService, Depends(service)]) -> dict[str, Any]:
    return {"data": workflow.queue()}
