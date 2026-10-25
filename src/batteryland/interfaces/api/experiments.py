from datetime import UTC, datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID

import yaml
from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from pydantic import Field, ValidationError

from batteryland.application.configurations import ConfigurationService
from batteryland.application.experiments import ExperimentService
from batteryland.application.serialization import load_config, load_json
from batteryland.bootstrap import Container
from batteryland.domain.errors import DomainError
from batteryland.interfaces.api.legacy import require_legacy_writes
from batteryland.interfaces.api.schemas import Envelope, Page, RequestModel

router = APIRouter(prefix="/api/v1", tags=["configurations"])


class VersionRef(RequestModel):
    id: UUID
    version: int = Field(ge=1)


class Bindings(RequestModel):
    split: VersionRef | None = None
    source_split: VersionRef | None = None
    target_split: VersionRef | None = None
    template: VersionRef | None = None
    checkpoint_id: UUID | None = None


class TemplateWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    native_config: dict[str, Any]


class TemplateUpdate(TemplateWrite):
    expected_revision: int = Field(ge=1)


class Template(RequestModel):
    id: str
    name: str
    revision: int
    head_version: int
    version: int
    created_at: str
    native_config: dict[str, Any] | None = None


class ExperimentWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["train", "evaluate", "transfer"] = "train"
    native_config: dict[str, Any] | None = None
    bindings: Bindings = Field(default_factory=Bindings)


class ExperimentPatch(RequestModel):
    expected_revision: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: Literal["train", "evaluate", "transfer"] | None = None
    native_config: dict[str, Any] | None = None
    bindings: Bindings | None = None


class ExecutionSummary(RequestModel):
    queued_at: str
    started_at: str | None
    finished_at: str | None
    stop_requested_at: str | None
    stop_stage: str | None
    stop_deadline: float | None
    exit_code: int | None
    error: dict[str, Any] | None


class CollectionSummary(RequestModel):
    status: str
    error: str | None


class Experiment(RequestModel):
    id: str
    name: str
    kind: str
    state: str
    revision: int
    created_at: str
    version: int | None = None
    requested_device: str | None = None
    effective_device: str | None = None
    actual_device: str | None = None
    actual_gpu_uuid: str | None = None
    execution: ExecutionSummary | None = None
    collection: CollectionSummary
    native_config: dict[str, Any] | None = None
    bindings: Bindings | None = None


class Validation(RequestModel):
    valid: bool
    errors: list[dict[str, Any]]
    warnings: list[str]


class CopyRequest(RequestModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)


def templates(request: Request) -> ConfigurationService:
    return cast(Container, request.app.state.container).configurations


def experiments(request: Request) -> ExperimentService:
    return cast(Container, request.app.state.container).experiments


def uploaded_config(file: UploadFile) -> dict[str, Any]:
    content = file.file.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise DomainError("invalid_input", "Configuration exceeds 1 MiB")
    return load_config(content)


@router.get("/templates", response_model=Envelope[Page[Template]])
def list_templates(
    service: Annotated[ConfigurationService, Depends(templates)],
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": service.list(q, page, page_size)}


@router.post(
    "/templates",
    status_code=201,
    response_model=Envelope[Template],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def create_template(
    body: TemplateWrite, service: Annotated[ConfigurationService, Depends(templates)]
) -> dict[str, Any]:
    return {"data": service.create(body.name, body.native_config)}


@router.post(
    "/templates/import",
    status_code=201,
    response_model=Envelope[Template],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def import_template(
    name: Annotated[str, Form(min_length=1)],
    file: Annotated[UploadFile, File()],
    service: Annotated[ConfigurationService, Depends(templates)],
) -> dict[str, Any]:
    return {"data": service.create(name, uploaded_config(file))}


@router.get("/templates/{template_id}", response_model=Envelope[Template])
def get_template(
    template_id: UUID,
    service: Annotated[ConfigurationService, Depends(templates)],
    version: int | None = Query(None, ge=1),
) -> dict[str, Any]:
    return {"data": service.get(str(template_id), version)}


@router.put(
    "/templates/{template_id}",
    response_model=Envelope[Template],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def update_template(
    template_id: UUID,
    body: TemplateUpdate,
    service: Annotated[ConfigurationService, Depends(templates)],
) -> dict[str, Any]:
    return {
        "data": service.update(
            str(template_id), body.name, body.native_config, body.expected_revision
        )
    }


@router.delete("/templates/{template_id}", response_model=Envelope[dict[str, bool]])
def delete_template(
    template_id: UUID, service: Annotated[ConfigurationService, Depends(templates)]
) -> dict[str, Any]:
    return {"data": service.delete(str(template_id))}


@router.get(
    "/templates/{template_id}/export",
    response_class=Response,
    responses={200: {"content": {"application/yaml": {"schema": {"type": "string"}}}}},
)
def export_template(
    template_id: UUID,
    service: Annotated[ConfigurationService, Depends(templates)],
    version: int | None = Query(None, ge=1),
) -> Response:
    value = service.get(str(template_id), version)
    return Response(
        yaml.safe_dump(value["native_config"], allow_unicode=True, sort_keys=False),
        media_type="application/yaml",
        headers={"Content-Disposition": f'attachment; filename="template-{template_id}.yaml"'},
    )


@router.get("/experiments", response_model=Envelope[Page[Experiment]])
def list_experiments(
    service: Annotated[ExperimentService, Depends(experiments)],
    q: str | None = None,
    source_id: UUID | None = None,
    split_id: UUID | None = None,
    model_type: str | None = None,
    task_type: str | None = None,
    state: str | None = None,
    requested_device: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    source_domain: str | None = None,
    target_domain: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    filters = {
        "q": q,
        "source_id": str(source_id) if source_id else None,
        "split_id": str(split_id) if split_id else None,
        "model_type": model_type,
        "task_type": task_type,
        "state": state,
        "requested_device": requested_device,
        "created_from": created_from.astimezone(UTC).isoformat() if created_from else None,
        "created_to": created_to.astimezone(UTC).isoformat() if created_to else None,
        "source_domain": source_domain,
        "target_domain": target_domain,
    }
    return {"data": service.list(filters, page, page_size)}


@router.post(
    "/experiments",
    status_code=201,
    response_model=Envelope[Experiment],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def create_experiment(
    body: ExperimentWrite, service: Annotated[ExperimentService, Depends(experiments)]
) -> dict[str, Any]:
    return {"data": service.create(body.model_dump(mode="json", exclude_none=True))}


@router.post(
    "/experiments/import",
    status_code=201,
    response_model=Envelope[Experiment],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def import_experiment(
    name: Annotated[str, Form(min_length=1)],
    file: Annotated[UploadFile, File()],
    service: Annotated[ExperimentService, Depends(experiments)],
    kind: Annotated[Literal["train", "evaluate", "transfer"], Form()] = "train",
    bindings: Annotated[str, Form()] = "{}",
) -> dict[str, Any]:
    try:
        refs = Bindings.model_validate(load_json(bindings.encode("utf-8")))
    except ValidationError as exc:
        raise DomainError(
            "invalid_input", "Bindings require valid versioned resource references"
        ) from exc
    return {
        "data": service.create(
            {
                "name": name,
                "kind": kind,
                "native_config": uploaded_config(file),
                "bindings": refs.model_dump(mode="json", exclude_none=True),
            }
        )
    }


@router.get("/experiments/{experiment_id}", response_model=Envelope[Experiment])
def get_experiment(
    experiment_id: UUID, service: Annotated[ExperimentService, Depends(experiments)]
) -> dict[str, Any]:
    return {"data": service.get(str(experiment_id))}


@router.patch(
    "/experiments/{experiment_id}",
    response_model=Envelope[Experiment],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def update_experiment(
    experiment_id: UUID,
    body: ExperimentPatch,
    service: Annotated[ExperimentService, Depends(experiments)],
) -> dict[str, Any]:
    return {
        "data": service.update(
            str(experiment_id),
            body.model_dump(mode="json", exclude_unset=True, exclude={"expected_revision"}),
            body.expected_revision,
        )
    }


@router.delete("/experiments/{experiment_id}", response_model=Envelope[dict[str, bool]])
def delete_experiment(
    experiment_id: UUID, service: Annotated[ExperimentService, Depends(experiments)]
) -> dict[str, Any]:
    return {"data": service.delete(str(experiment_id))}


@router.post(
    "/experiments/{experiment_id}/validate",
    response_model=Envelope[Validation],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def validate_experiment(
    experiment_id: UUID, service: Annotated[ExperimentService, Depends(experiments)]
) -> dict[str, Any]:
    return {"data": service.validate(str(experiment_id))}


@router.post(
    "/experiments/{experiment_id}/copy",
    status_code=201,
    response_model=Envelope[Experiment],
    dependencies=[Depends(require_legacy_writes)],
    deprecated=True,
)
def copy_experiment(
    experiment_id: UUID,
    service: Annotated[ExperimentService, Depends(experiments)],
    body: CopyRequest | None = None,
) -> dict[str, Any]:
    return {"data": service.copy(str(experiment_id), body.name if body else None)}


@router.get(
    "/experiments/{experiment_id}/export",
    response_class=Response,
    responses={200: {"content": {"application/yaml": {"schema": {"type": "string"}}}}},
)
def export_experiment(
    experiment_id: UUID, service: Annotated[ExperimentService, Depends(experiments)]
) -> Response:
    value = service.get(str(experiment_id))
    return Response(
        yaml.safe_dump(value["native_config"], allow_unicode=True, sort_keys=False),
        media_type="application/yaml",
        headers={"Content-Disposition": f'attachment; filename="experiment-{experiment_id}.yaml"'},
    )
