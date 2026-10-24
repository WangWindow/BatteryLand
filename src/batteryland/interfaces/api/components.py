from typing import Annotated, Any, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import ConfigDict, Field

from batteryland.application.artifacts import ArtifactService
from batteryland.bootstrap import Container
from batteryland.domain.errors import DomainError
from batteryland.interfaces.api.schemas import Envelope, Page, RequestModel

router = APIRouter(prefix="/api/v1", tags=["components and artifacts"])


class Component(RequestModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: str
    provider_commit: str
    scope: str
    type: str
    source_hash: str | None
    origin: str
    resource_ref: str | None
    parameter_schema: dict[str, Any] | None = Field(alias="schema")


class ComponentUpload(RequestModel):
    activation: str
    sha256: str
    components: list[Component]


class Artifact(RequestModel):
    id: str
    experiment_id: str | None
    component_id: str | None
    origin: str
    kind: str
    name: str
    sha256: str | None
    size: int | None
    availability: str
    is_directory: bool
    created_at: str


class Capability(RequestModel):
    provider_id: str
    version: str
    available: bool
    reason: str | None = None
    supported_operations: list[str]
    limitations: list[str]


def service(request: Request) -> ArtifactService:
    return cast(Container, request.app.state.container).artifacts


@router.get("/capabilities", response_model=Envelope[list[Capability]])
def capabilities(artifacts: Annotated[ArtifactService, Depends(service)]) -> dict[str, Any]:
    return {"data": artifacts.capabilities()}


@router.get("/components", response_model=Envelope[list[Component]])
def components(
    artifacts: Annotated[ArtifactService, Depends(service)], scope: str | None = None
) -> dict[str, Any]:
    return {"data": artifacts.components(scope)}


@router.get("/components/{scope}/{type}/schema", response_model=Envelope[dict[str, Any]])
def schema(
    scope: str, type: str, artifacts: Annotated[ArtifactService, Depends(service)]
) -> dict[str, Any]:
    return {"data": artifacts.schema(scope, type)}


@router.post("/components/uploads", status_code=201, response_model=Envelope[ComponentUpload])
def upload_component(
    request: Request,
    scope: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    artifacts: Annotated[ArtifactService, Depends(service)],
) -> dict[str, Any]:
    limit = cast(Container, request.app.state.container).settings.component_limit
    content = file.file.read(limit + 1)
    if len(content) > limit:
        raise DomainError("invalid_input", "Component upload exceeds the configured size limit")
    return {"data": artifacts.upload_component(scope, file.filename or "", content)}


@router.get("/checkpoints", response_model=Envelope[Page[Artifact]])
def checkpoints(
    artifacts: Annotated[ArtifactService, Depends(service)],
    component_id: UUID | None = None,
    source_experiment_id: UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {
        "data": artifacts.checkpoints(
            {
                "component_id": str(component_id) if component_id else None,
                "source_experiment_id": str(source_experiment_id) if source_experiment_id else None,
            },
            page,
            page_size,
        )
    }


@router.post("/checkpoints", status_code=201, response_model=Envelope[Artifact])
def upload_checkpoint(
    file: Annotated[UploadFile, File()],
    component_id: Annotated[UUID, Form()],
    artifacts: Annotated[ArtifactService, Depends(service)],
    source_experiment_id: Annotated[UUID | None, Form()] = None,
) -> dict[str, Any]:
    return {
        "data": artifacts.upload_checkpoint(
            str(component_id),
            str(source_experiment_id) if source_experiment_id else None,
            file.filename or "weights.bin",
            file.file,
        )
    }


@router.get("/experiments/{experiment_id}/artifacts", response_model=Envelope[list[Artifact]])
def experiment_artifacts(
    experiment_id: UUID, artifacts: Annotated[ArtifactService, Depends(service)]
) -> dict[str, Any]:
    return {"data": artifacts.for_experiment(str(experiment_id))}


@router.get(
    "/artifacts/{artifact_id}/download",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
def download(
    artifact_id: UUID, artifacts: Annotated[ArtifactService, Depends(service)]
) -> FileResponse:
    path, name = artifacts.download(str(artifact_id))
    return FileResponse(path, filename=name)
