from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import Field, StrictBool, StrictFloat, StrictInt, StrictStr, model_validator

from batteryland.api.schemas import Envelope, Page, RequestModel
from batteryland.common.errors import DomainError
from batteryland.container import Container
from batteryland.datasets.routes import Battery
from batteryland.datasets.splits import SplitService

router = APIRouter(prefix="/api/v1/splits", tags=["splits"])


class Partitions(RequestModel):
    train: list[UUID] = Field(default_factory=list)
    val: list[UUID] = Field(default_factory=list)
    test: list[UUID] = Field(default_factory=list)


class Ratios(RequestModel):
    train: float = Field(ge=0, le=1)
    val: float = Field(ge=0, le=1)
    test: float = Field(ge=0, le=1)


class SplitSourceSelection(RequestModel):
    source_id: UUID
    expected_revision: int = Field(ge=1)
    include_all: bool = False
    battery_ids: list[UUID] = Field(default_factory=list)
    excluded_battery_ids: list[UUID] = Field(default_factory=list)


class SplitWrite(RequestModel):
    name: str = Field(min_length=1, max_length=200)
    source_selections: list[SplitSourceSelection] = Field(default_factory=list)
    logical_dataset_id: UUID | None = None
    method: Literal["manual", "random", "hybrid"]
    partitions: Partitions | None = None
    ratios: Ratios | None = None
    seed: int | None = Field(default=None, ge=0, lt=2**32)

    @model_validator(mode="after")
    def one_dataset_reference(self) -> SplitWrite:
        if bool(self.source_selections) == (self.logical_dataset_id is not None):
            raise ValueError("Specify source selections or a logical dataset")
        return self


class SplitUpdate(SplitWrite):
    expected_revision: int = Field(ge=1)


class SplitPreviewCounts(RequestModel):
    all: int = Field(ge=0)
    train: int = Field(ge=0)
    val: int = Field(ge=0)
    test: int = Field(ge=0)


class SplitPreviewResponse(RequestModel):
    source_revisions: dict[str, int]
    counts: SplitPreviewCounts


class StatisticCategory(RequestModel):
    value_type: Literal["boolean", "integer", "number", "string"]
    value: StrictBool | StrictInt | StrictFloat | StrictStr
    count: int = Field(ge=0)


class AttributeStatistics(RequestModel):
    kind: Literal["numeric", "categorical"]
    valid_count: int = Field(ge=0)
    missing_count: int = Field(ge=0)
    unsupported_count: int = Field(ge=0)
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    categories: list[StatisticCategory] | None = None


class StatisticsScope(RequestModel):
    sample_count: int = Field(ge=0)
    attributes: dict[str, AttributeStatistics]


class StatisticsScopes(RequestModel):
    all: StatisticsScope
    train: StatisticsScope
    val: StatisticsScope
    test: StatisticsScope


class DatasetStatistics(RequestModel):
    schema_version: Literal[1]
    scopes: StatisticsScopes


class Split(RequestModel):
    id: str
    name: str
    sources: list[dict[str, Any]]
    logical_dataset_id: str | None = None
    revision: int
    head_version: int
    version: int
    counts: dict[str, int]
    payload: dict[str, Any] | None = None
    statistics: DatasetStatistics | None = None
    created_at: str


def service(request: Request) -> SplitService:
    return cast(Container, request.app.state.container).splits


@router.get("", response_model=Envelope[Page[Split]])
def list_splits(
    splits: Annotated[SplitService, Depends(service)],
    source_ids: Annotated[list[UUID] | None, Query()] = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {
        "data": splits.list(
            [str(source_id) for source_id in source_ids] if source_ids is not None else None,
            q,
            page,
            page_size,
        )
    }


@router.post(
    "",
    status_code=201,
    response_model=Envelope[Split],
)
def create_split(
    body: SplitWrite, splits: Annotated[SplitService, Depends(service)]
) -> dict[str, Any]:
    return {"data": splits.create(body.model_dump(mode="json", exclude_none=True))}


@router.post(
    "/preview",
    response_model=Envelope[SplitPreviewResponse],
)
def preview_split(
    body: SplitWrite, splits: Annotated[SplitService, Depends(service)]
) -> dict[str, Any]:
    return {"data": splits.preview(body.model_dump(mode="json", exclude_none=True))}


@router.post(
    "/import",
    status_code=201,
    response_model=Envelope[Split],
)
def import_split(
    source_ids: Annotated[list[UUID], Form()],
    file: Annotated[UploadFile, File()],
    splits: Annotated[SplitService, Depends(service)],
) -> dict[str, Any]:
    content = file.file.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise DomainError("invalid_input", "Split document exceeds 1 MiB")
    return {"data": splits.import_document([str(source_id) for source_id in source_ids], content)}


@router.get("/{split_id}", response_model=Envelope[Split])
def get_split(
    split_id: UUID,
    splits: Annotated[SplitService, Depends(service)],
    version: int | None = Query(None, ge=1),
) -> dict[str, Any]:
    return {"data": splits.get(str(split_id), version)}


@router.put(
    "/{split_id}",
    response_model=Envelope[Split],
)
def update_split(
    split_id: UUID, body: SplitUpdate, splits: Annotated[SplitService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": splits.update(
            str(split_id),
            body.model_dump(mode="json", exclude_none=True, exclude={"expected_revision"}),
            body.expected_revision,
        )
    }


@router.delete(
    "/{split_id}",
    response_model=Envelope[dict[str, bool]],
)
def delete_split(
    split_id: UUID, splits: Annotated[SplitService, Depends(service)]
) -> dict[str, Any]:
    return {"data": splits.delete(str(split_id))}


@router.get("/{split_id}/members", response_model=Envelope[Page[Battery]])
def members(
    split_id: UUID,
    splits: Annotated[SplitService, Depends(service)],
    version: int | None = Query(None, ge=1),
    partition: Literal["train", "val", "test"] | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {"data": splits.members(str(split_id), version, partition, page, page_size)}


class ProviderSplit(RequestModel):
    dataset: str
    train: list[str]
    val: list[str]
    test: list[str]


@router.get("/{split_id}/export", response_model=ProviderSplit)
def export(
    split_id: UUID,
    splits: Annotated[SplitService, Depends(service)],
    version: int | None = Query(None, ge=1),
) -> JSONResponse:
    return JSONResponse(
        splits.export(str(split_id), version),
        headers={"Content-Disposition": f'attachment; filename="split-{split_id}.json"'},
    )
