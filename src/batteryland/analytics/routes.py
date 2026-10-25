from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field, model_validator

from batteryland.analytics.service import AnalysisService
from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container
from batteryland.results.routes import Metric, ResultSource

router = APIRouter(prefix="/api/v1", tags=["analysis"])
type Category = Literal["source", "chemistry", "material", "temperature_c"]


class VersionRef(RequestModel):
    id: UUID
    version: int = Field(ge=1)


class ComparisonRequest(RequestModel):
    experiment_ids: list[UUID] = Field(min_length=1)
    metrics: list[str] | None = None
    battery_ids: list[str] | None = None


class ComparisonExport(ComparisonRequest):
    format: Literal["json", "csv"] = "json"


class MetricRow(Metric):
    experiment_id: str


class PredictionRow(RequestModel):
    experiment_id: str
    battery_id: str
    prediction: float | None
    target: float | None
    granularity: str


class ComparisonData(RequestModel):
    schema_version: Literal[1]
    metric_rows: list[MetricRow]
    prediction_rows: list[PredictionRow]
    warnings: list[str]
    sources: list[ResultSource]


class SetRef(RequestModel):
    label: str = Field(min_length=1)
    split: VersionRef | None = None
    source_id: UUID | None = None
    named_group: str | None = Field(default=None, min_length=1)
    partitions: list[Literal["train", "val", "test"]] = Field(
        default=["train", "val", "test"], min_length=1
    )

    @model_validator(mode="after")
    def exactly_one_reference(self) -> SetRef:
        if sum(value is not None for value in (self.split, self.source_id, self.named_group)) != 1:
            raise ValueError("Specify exactly one of split, source_id, or named_group")
        return self


class DifferenceRequest(RequestModel):
    sets: list[SetRef] = Field(min_length=1)
    analysis_kind: str
    category: Category | None = None


class DifferenceResult(RequestModel):
    schema_version: Literal[1]
    provider_id: str
    analysis_kind: str
    sets: list[dict[str, Any]]
    statistics: dict[str, Any]
    warnings: list[str]


class ChartRequest(RequestModel):
    chart_type: str
    experiment_ids: list[UUID] | None = None
    sets: list[SetRef] | None = None
    metric: str | None = None
    stage: Literal["train", "validation", "test"] | None = None
    category: Category | None = None


class Axis(RequestModel):
    label: str
    unit: str | None
    value_type: Literal["category", "number"]


class Point(RequestModel):
    x: float | str
    y: float | None
    experiment_id: str | None = None
    battery_id: str | None = None


class Series(RequestModel):
    id: str
    label: str
    points: list[Point]


class ChartSpec(RequestModel):
    id: str
    kind: Literal["bar", "line", "scatter"]
    title: str
    x_axis: Axis
    y_axis: Axis
    series: list[Series]
    warnings: list[str]


class ChartBundle(RequestModel):
    schema_version: Literal[1]
    provider_id: str
    charts: list[ChartSpec]
    warnings: list[str]


def service(request: Request) -> AnalysisService:
    return cast(Container, request.app.state.container).analysis


@router.post("/comparisons", response_model=Envelope[ComparisonData])
def compare(
    body: ComparisonRequest, analysis: Annotated[AnalysisService, Depends(service)]
) -> dict[str, Any]:
    return {"data": analysis.compare(body.model_dump(mode="json"))}


@router.post(
    "/comparisons/export",
    response_class=Response,
    responses={200: {"content": {"application/json": {}, "text/csv": {}}}},
)
def export(
    body: ComparisonExport, analysis: Annotated[AnalysisService, Depends(service)]
) -> Response:
    content, media_type, filename = analysis.export(body.model_dump(mode="json"))
    return Response(
        content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/differences", response_model=Envelope[DifferenceResult])
def differences(
    body: DifferenceRequest, analysis: Annotated[AnalysisService, Depends(service)]
) -> dict[str, Any]:
    return {"data": analysis.differences(body.model_dump(mode="json"))}


@router.post("/charts", response_model=Envelope[ChartBundle])
def charts(
    body: ChartRequest, analysis: Annotated[AnalysisService, Depends(service)]
) -> dict[str, Any]:
    return {"data": analysis.charts(body.model_dump(mode="json"))}
