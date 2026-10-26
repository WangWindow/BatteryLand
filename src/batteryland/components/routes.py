import html
import mimetypes
import re
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from typing import Annotated, Any, cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from pydantic import ConfigDict, Field

from batteryland.api.schemas import Envelope, Page, RequestModel
from batteryland.common.errors import DomainError
from batteryland.components.service import ArtifactService
from batteryland.container import Container

router = APIRouter(prefix="/api/v1", tags=["components and artifacts"])
NETRON_PACKAGE = Path(str(files("netron"))).resolve()


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


def service(request: Request) -> ArtifactService:
    return cast(Container, request.app.state.container).artifacts


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


@router.get("/artifacts/{artifact_id}/preview/text", response_class=PlainTextResponse)
def preview_text(
    artifact_id: UUID, artifacts: Annotated[ArtifactService, Depends(service)]
) -> PlainTextResponse:
    _, text = artifacts.text_preview(str(artifact_id))
    return PlainTextResponse(
        text,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/artifacts/{artifact_id}/preview/model", response_class=HTMLResponse)
def preview_model(
    artifact_id: UUID, artifacts: Annotated[ArtifactService, Depends(service)]
) -> HTMLResponse:
    _, name = artifacts.model_preview(str(artifact_id))
    template = NETRON_PACKAGE / "index.html"
    try:
        content = template.read_text(encoding="utf-8")
    except OSError as exc:
        raise DomainError("provider_unavailable", "Netron viewer assets are unavailable") from exc

    data_url = f"/api/v1/artifacts/{artifact_id}/preview/model/data/{quote(name, safe='')}"
    viewer_date = datetime.now(UTC).date().isoformat()
    metadata = "\n".join(
        (
            '<meta name="type" content="Python">',
            '<meta name="version" content="0.0.0">',
            f'<meta name="date" content="{viewer_date}">',
            f'<meta name="file" content="{html.escape(data_url, quote=True)}">',
            f'<meta name="name" content="{html.escape(name, quote=True)}">',
            f'<meta name="identifier" content="{html.escape(name, quote=True)}">',
        )
    )
    content, replaced = re.subn(
        r'<meta name="version" content="[^"]*">', lambda _: metadata, content, count=1
    )
    if replaced != 1:
        raise DomainError("provider_unavailable", "Netron viewer template is incompatible")
    content, inserted = re.subn(
        r"<head>", '<head>\n<base href="/api/v1/netron-assets/">', content, count=1
    )
    if inserted != 1:
        raise DomainError("provider_unavailable", "Netron viewer template is incompatible")
    content = content.replace(
        "script-src 'self'; frame-src 'none'",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
        "worker-src 'self' blob:; frame-src 'none'",
        1,
    )
    return HTMLResponse(
        content,
        headers={
            "Cache-Control": "private, no-store",
            "Set-Cookie": f"consent=local; Path=/api/v1/artifacts/{artifact_id}/preview/model; SameSite=Lax",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get(
    "/artifacts/{artifact_id}/preview/model/data/{filename:path}",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
def preview_model_data(
    artifact_id: UUID,
    filename: str,
    artifacts: Annotated[ArtifactService, Depends(service)],
) -> FileResponse:
    path, name = artifacts.model_preview(str(artifact_id))
    if filename != name:
        raise DomainError("not_found", "Artifact file is unavailable")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/netron-assets/{asset_path:path}", include_in_schema=False)
def netron_asset(asset_path: str) -> FileResponse:
    try:
        path = (NETRON_PACKAGE / asset_path).resolve()
    except OSError, ValueError:
        raise DomainError("not_found", "Netron viewer asset was not found") from None
    if (
        not path.is_relative_to(NETRON_PACKAGE)
        or not path.is_file()
        or path.suffix.casefold() in {".py", ".pyc", ".pyo"}
    ):
        raise DomainError("not_found", "Netron viewer asset was not found")
    media_type, _ = mimetypes.guess_type(path.name)
    if path.suffix.casefold() in {".js", ".mjs"}:
        media_type = "text/javascript"
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
