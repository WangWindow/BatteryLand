"""Shared typed HTTP envelope and request defaults."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Envelope[T](BaseModel):
    code: Literal[0] = 0
    message: str = "ok"
    data: T


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


class ErrorField(BaseModel):
    path: str
    message: str


class ErrorData(BaseModel):
    error: str
    fields: list[ErrorField] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    code: int
    message: str
    data: ErrorData
