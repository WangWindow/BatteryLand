"""FastAPI routes for native BatteryLand domain shift analysis."""

from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from batteryland.api.schemas import Envelope, RequestModel
from batteryland.container import Container

from .service import DomainShiftService

router = APIRouter(prefix="/api/v1/domain-shift", tags=["domain-shift"])


class CacheRequest(RequestModel):
    source_ids: list[UUID] = Field(min_length=1)
    stride: int = Field(default=1, ge=1, le=100)


class BuildRequest(CacheRequest):
    workers: int = Field(default=4, ge=1, le=32)


class AnalysisRequest(RequestModel):
    source_ids: list[UUID] = Field(min_length=1)
    target_ids: list[UUID] = Field(min_length=1)
    stride: int = Field(default=1, ge=1, le=100)
    max_cycles: int = Field(default=200, ge=0, le=10000)
    minimum_coverage: float = Field(default=0.5, ge=0, le=1)
    level: Literal["cycle", "cell"] = "cycle"
    feature_groups: list[str] = Field(default_factory=list)
    excluded_features: list[str] = Field(default_factory=list)
    seed: int = Field(default=42, ge=0, le=99999)
    points_per_dataset: int = Field(default=3000, ge=200, le=50000)
    pca_fit: Literal["all", "source"] = "all"

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


@router.post("/cache/status", response_model=Envelope[dict[str, Any]])
def cache_status(
    body: CacheRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": domain_shift.cache_status([str(item) for item in body.source_ids], body.stride)
    }


@router.post("/jobs", response_model=Envelope[dict[str, Any]])
def build_features(
    body: BuildRequest, domain_shift: Annotated[DomainShiftService, Depends(service)]
) -> dict[str, Any]:
    return {
        "data": domain_shift.start_build(
            [str(item) for item in body.source_ids], body.stride, body.workers
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
