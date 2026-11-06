"""FastAPI routes for native BatteryLand domain shift analysis."""

from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import Field, model_validator

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container

from .service import DomainShiftService

router = APIRouter(prefix="/api/v1/domain-shift", tags=["domain-shift"])


class ModelSelection(RequestModel):
    experiment_id: UUID
    checkpoint_id: UUID
    layer: Literal["embedding"] = "embedding"


class DirectModelSelection(RequestModel):
    model_type: str = Field(min_length=1, max_length=100)
    parameters: dict[str, Any]
    initialization_seed: int = Field(default=42, ge=0, le=99999)
    layer: Literal["embedding"] = "embedding"


class FeatureContext(RequestModel):
    feature_space: Literal["physical", "model"] = "physical"
    model: ModelSelection | DirectModelSelection | None = None

    @model_validator(mode="after")
    def validate_feature_source(self) -> FeatureContext:
        if (self.feature_space == "model") != (self.model is not None):
            raise ValueError("模型模式必须选择模型或实验权重；物理模式不接受模型配置")
        return self

    def selected_model(self) -> dict[str, Any] | None:
        return self.model.model_dump(mode="json") if self.model else None


class CacheRequest(FeatureContext):
    source_ids: list[UUID] = Field(min_length=1)
    stride: int = Field(default=1, ge=1, le=100)


class BuildRequest(CacheRequest):
    workers: int = Field(default=4, ge=1, le=32)
    batch_size: int = Field(default=32, ge=1, le=512)
    device: str = Field(default="cpu", pattern=r"^(cpu|cuda:\d+)$")


class AnalysisRequest(CacheRequest):
    target_ids: list[UUID] = Field(min_length=1)
    max_cycles: int = Field(default=200, ge=0, le=10000)
    minimum_coverage: float = Field(default=0.5, ge=0, le=1)
    level: Literal["cycle", "cell"] = "cycle"
    feature_groups: list[str] = Field(default_factory=list)
    excluded_features: list[str] = Field(default_factory=list)
    seed: int = Field(default=42, ge=0, le=99999)
    points_per_dataset: int = Field(default=3000, ge=200, le=50000)
    pca_fit: Literal["all", "source"] = "all"
    projection_method: Literal["tsne", "pca"] = "tsne"
    pool_dim: int = Field(default=64, ge=0, le=4096)
    pca_dim: int = Field(default=50, ge=2, le=256)
    tsne_perplexity: float = Field(default=30.0, ge=1, le=100)
    tsne_iterations: int = Field(default=1000, ge=250, le=5000)

    @model_validator(mode="after")
    def validate_pool_dimensions(self) -> AnalysisRequest:
        if self.pool_dim == 1:
            raise ValueError("池化维度须为 0（保留原维度）或至少 2，单维余弦距离无法区分模型表示")
        return self

    def values(self) -> dict[str, Any]:
        value = self.model_dump(mode="json")
        value["source_ids"] = [str(item) for item in self.source_ids]
        value["target_ids"] = [str(item) for item in self.target_ids]
        return value


class DistributionRequest(AnalysisRequest):
    feature: str = Field(min_length=1, max_length=200)
    group_by: Literal["dataset", "domain"] = "dataset"
    bins: int = Field(default=40, ge=10, le=100)
    clip: bool = True


def service(request: Request) -> DomainShiftService:
    return cast(Container, request.app.state.container).domain_shift


class ModelCheckpoint(RequestModel):
    id: str
    name: str
    supported: bool
    reason: str | None
    run_id: str | None
    relative_key: str
    relative_path: str


class ModelOption(RequestModel):
    experiment_id: str
    name: str
    model_type: str
    checkpoints: list[ModelCheckpoint]


class ModelArchitecture(RequestModel):
    model_type: str
    parameters: dict[str, Any]
    required_parameters: list[str]
    supported: bool
    reason: str | None


@router.get("/architectures", response_model=Envelope[list[ModelArchitecture]])
def architectures(domain_shift: Annotated[DomainShiftService, Depends(service)]) -> dict[str, Any]:
    return {"data": domain_shift.model_features.architectures()}


@router.get("/models", response_model=Envelope[list[ModelOption]])
def models(domain_shift: Annotated[DomainShiftService, Depends(service)]) -> dict[str, Any]:
    return {"data": domain_shift.model_features.models()}


@router.post("/cache/status", response_model=Envelope[dict[str, Any]])
def cache_status(
    body: CacheRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": domain_shift.cache_status(
            [str(item) for item in body.source_ids], body.stride, body.selected_model()
        )
    }


@router.post("/jobs", response_model=Envelope[dict[str, Any]])
def build_features(
    body: BuildRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": domain_shift.start_build(
            [str(item) for item in body.source_ids],
            body.stride,
            body.workers,
            body.selected_model(),
            body.batch_size,
            body.device,
        )
    }


@router.get("/jobs/{job_id}", response_model=Envelope[dict[str, Any]])
def get_job(
    job_id: UUID, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {"data": domain_shift.get_job(str(job_id))}


@router.post("/analysis", response_model=Envelope[dict[str, Any]])
def run_analysis(
    body: AnalysisRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {"data": domain_shift.analyze(body.values())}


@router.post("/distribution", response_model=Envelope[dict[str, Any]])
def distribution(
    body: DistributionRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {"data": domain_shift.distribution(body.values())}
