"""Authenticated compatibility API for scheduler operations."""

import hmac
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Header, Request, Response, UploadFile
from pydantic import Field

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.common.errors import DomainError
from batteryland.components.service import ArtifactService
from batteryland.container import Container
from batteryland.results.service import ResultService
from batteryland.scheduler.operations import WorkerProtocolService


def authenticate(request: Request, authorization: Annotated[str | None, Header()] = None) -> None:
    expected = request.app.state.settings.service_token
    if not expected:
        raise DomainError("provider_unavailable", "Service token is not configured")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not hmac.compare_digest(supplied, expected):
        raise DomainError("unauthorized", "Worker authentication failed")


router = APIRouter(
    prefix="/api/v1/worker", tags=["worker protocol"], dependencies=[Depends(authenticate)]
)


class GpuSnapshot(RequestModel):
    cuda_index: int = Field(ge=0)
    uuid: str
    total_bytes: int | None = Field(default=None, ge=0)
    free_bytes: int | None = Field(default=None, ge=0)
    memory_used_bytes: int | None = Field(default=None, ge=0)
    utilization_percent: float | None = Field(default=None, ge=0, le=100)
    process_pids: list[int] | None = None
    reason: str | None = None


class ResourceSnapshot(RequestModel):
    cpu_percent: float | None = Field(default=None, ge=0, le=100)
    memory_total: int | None = Field(default=None, ge=0)
    memory_available: int | None = Field(default=None, ge=0)
    gpus: list[GpuSnapshot]
    reason: str | None = None


class ClaimRequest(RequestModel):
    experiment_id: UUID
    expected_revision: int = Field(ge=1)
    node_id: UUID
    resolved_device: str
    request_id: UUID


class EventRequest(RequestModel):
    event_id: UUID
    claim_token: UUID
    expected_revision: int = Field(ge=1)
    kind: Literal["started", "finished", "uncertain", "device_observed"]
    data: dict[str, Any] = Field(default_factory=dict)


class ResultReport(RequestModel):
    claim_token: UUID
    result: dict[str, Any]


class ChunkReport(RequestModel):
    claim_token: UUID
    offset: int = Field(ge=0)
    text: str = Field(max_length=256 * 1024)


def service(request: Request) -> WorkerProtocolService:
    return cast(Container, request.app.state.container).workers


def results(request: Request) -> ResultService:
    return cast(Container, request.app.state.container).results


def artifacts(request: Request) -> ArtifactService:
    return cast(Container, request.app.state.container).artifacts


@router.put("/nodes/{node_id}", response_model=Envelope[dict[str, Any]])
def heartbeat(
    node_id: UUID,
    body: ResourceSnapshot,
    worker: Annotated[WorkerProtocolService, Depends(service)],
) -> dict[str, Any]:
    return {"data": worker.heartbeat(str(node_id), body.model_dump(mode="json"))}


@router.get("/nodes", response_model=Envelope[list[dict[str, Any]]])
def nodes(worker: Annotated[WorkerProtocolService, Depends(service)]) -> dict[str, Any]:
    return {"data": worker.nodes()}


@router.post("/claims", response_model=Envelope[dict[str, Any]], status_code=201)
def claim(
    body: ClaimRequest,
    response: Response,
    worker: Annotated[WorkerProtocolService, Depends(service)],
) -> dict[str, Any]:
    value, created = worker.claim(
        str(body.experiment_id),
        body.expected_revision,
        str(body.node_id),
        body.resolved_device,
        str(body.request_id),
    )
    response.status_code = 201 if created else 200
    return {"data": value}


@router.get("/nodes/{node_id}/active", response_model=Envelope[list[dict[str, Any]]])
def active(
    node_id: UUID, worker: Annotated[WorkerProtocolService, Depends(service)]
) -> dict[str, Any]:
    return {"data": worker.active(str(node_id))}


@router.post("/experiments/{experiment_id}/events", response_model=Envelope[dict[str, Any]])
def event(
    experiment_id: UUID,
    body: EventRequest,
    worker: Annotated[WorkerProtocolService, Depends(service)],
) -> dict[str, Any]:
    return {
        "data": worker.event(
            str(experiment_id),
            str(body.event_id),
            str(body.claim_token),
            body.expected_revision,
            body.kind,
            body.data,
        )
    }


@router.put("/experiments/{experiment_id}/result", response_model=Envelope[dict[str, Any]])
def report_result(
    experiment_id: UUID,
    body: ResultReport,
    worker: Annotated[WorkerProtocolService, Depends(service)],
    result_service: Annotated[ResultService, Depends(results)],
) -> dict[str, Any]:
    identity = str(experiment_id)
    worker.ensure_owner(identity, str(body.claim_token))
    return {"data": result_service.ingest_external_result(identity, body.result)}


@router.put("/experiments/{experiment_id}/logs/{stream}", response_model=Envelope[dict[str, Any]])
def report_log(
    experiment_id: UUID,
    stream: str,
    body: ChunkReport,
    worker: Annotated[WorkerProtocolService, Depends(service)],
    result_service: Annotated[ResultService, Depends(results)],
) -> dict[str, Any]:
    identity = str(experiment_id)
    worker.ensure_owner(identity, str(body.claim_token))
    return {"data": result_service.ingest_external_log(identity, stream, body.offset, body.text)}


@router.put("/experiments/{experiment_id}/metrics", response_model=Envelope[dict[str, Any]])
def report_metrics(
    experiment_id: UUID,
    body: ChunkReport,
    worker: Annotated[WorkerProtocolService, Depends(service)],
    result_service: Annotated[ResultService, Depends(results)],
) -> dict[str, Any]:
    identity = str(experiment_id)
    worker.ensure_owner(identity, str(body.claim_token))
    return {"data": result_service.ingest_external_metrics(identity, body.offset, body.text)}


@router.post(
    "/experiments/{experiment_id}/artifacts",
    status_code=201,
    response_model=Envelope[dict[str, Any]],
)
def report_artifact(
    experiment_id: UUID,
    claim_token: Annotated[UUID, Form()],
    kind: Annotated[str, Form()],
    sha256: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    worker: Annotated[WorkerProtocolService, Depends(service)],
    artifact_service: Annotated[ArtifactService, Depends(artifacts)],
) -> dict[str, Any]:
    identity = str(experiment_id)
    worker.ensure_owner(identity, str(claim_token))
    return {
        "data": artifact_service.upload_execution_artifact(
            identity, file.filename or "", kind, sha256, file.file
        )
    }
