from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from batteryland.application.execution import ExecutionService
from batteryland.bootstrap import Container
from batteryland.interfaces.api.experiments import Experiment
from batteryland.interfaces.api.schemas import Envelope, RequestModel

router = APIRouter(prefix="/api/v1", tags=["execution"])


class Submission(RequestModel):
    experiment_ids: list[UUID] = Field(min_length=1)


class Dispatch(RequestModel):
    experiment_id: UUID
    expected_revision: int = Field(ge=1)
    policy_id: str = Field(default="fifo", min_length=1, max_length=100)


class Queue(RequestModel):
    waiting: list[Experiment]
    active: list[Experiment]
    dispatch_paused: bool
    reason: str | None


def service(request: Request) -> ExecutionService:
    return cast(Container, request.app.state.container).execution


@router.post("/queue/submissions", status_code=202, response_model=Envelope[list[Experiment]])
def submit(
    body: Submission, execution: Annotated[ExecutionService, Depends(service)]
) -> dict[str, Any]:
    return {"data": execution.submit([str(identity) for identity in body.experiment_ids])}


@router.get("/queue", response_model=Envelope[Queue])
def queue(execution: Annotated[ExecutionService, Depends(service)]) -> dict[str, Any]:
    return {"data": execution.queue()}


@router.post("/queue/dispatch", status_code=202, response_model=Envelope[Experiment])
def dispatch(
    body: Dispatch,
    response: Response,
    execution: Annotated[ExecutionService, Depends(service)],
) -> dict[str, Any]:
    experiment, claimed = execution.dispatch(
        str(body.experiment_id), body.expected_revision, body.policy_id
    )
    response.status_code = 202 if claimed else 200
    return {"data": experiment}


@router.post(
    "/experiments/{experiment_id}/stop", status_code=202, response_model=Envelope[Experiment]
)
def stop(
    experiment_id: UUID, execution: Annotated[ExecutionService, Depends(service)]
) -> dict[str, Any]:
    return {"data": execution.stop(str(experiment_id))}
