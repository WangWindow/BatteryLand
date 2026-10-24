import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from batteryland.application.results import ResultService
from batteryland.bootstrap import Container
from batteryland.domain.errors import DomainError
from batteryland.interfaces.api.schemas import Envelope, Page, RequestModel

router = APIRouter(prefix="/api/v1/experiments", tags=["results and logs"])


class Metric(RequestModel):
    epoch: int | None
    stage: str
    name: str
    value: float | None
    unit: str
    granularity: str


class Prediction(RequestModel):
    battery_id: str
    file_name: str
    prediction: float | None
    target: float | None
    granularity: str


class ResultSource(RequestModel):
    experiment_id: str
    result_version: int
    source_artifact_id: str
    source_hash: str


class Result(RequestModel):
    available: bool
    version: int | None
    best_epoch: int | None
    reason: str | None
    metrics: list[Metric]
    predictions: list[Prediction]
    sources: list[ResultSource]
    warnings: list[str]


class LogChunk(RequestModel):
    stream: str
    text: str
    next_cursor: str
    eof: bool
    state: str


def service(request: Request) -> ResultService:
    return cast(Container, request.app.state.container).results


@router.get("/{experiment_id}/results", response_model=Envelope[Result])
def result(
    experiment_id: UUID, results: Annotated[ResultService, Depends(service)]
) -> dict[str, Any]:
    return {"data": results.get(str(experiment_id))}


@router.get("/{experiment_id}/metrics", response_model=Envelope[Page[Metric]])
def metrics(
    experiment_id: UUID,
    results: Annotated[ResultService, Depends(service)],
    stage: str | None = None,
    name: str | None = None,
    after_epoch: int | None = Query(None, ge=0),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    return {
        "data": results.metrics(
            str(experiment_id),
            {"stage": stage, "name": name, "after_epoch": after_epoch},
            page,
            page_size,
        )
    }


@router.get("/{experiment_id}/logs", response_model=Envelope[LogChunk])
def logs(
    experiment_id: UUID,
    results: Annotated[ResultService, Depends(service)],
    stream: Literal["train", "console"] = "train",
    cursor: str | None = None,
    limit_bytes: int = Query(65536, ge=1, le=65536),
) -> dict[str, Any]:
    return {"data": results.logs(str(experiment_id), stream, cursor, limit_bytes)}


@router.get(
    "/{experiment_id}/logs/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
)
async def log_stream(
    experiment_id: UUID,
    request: Request,
    results: Annotated[ResultService, Depends(service)],
    stream: Literal["train", "console"] = "train",
    cursor: str | None = None,
    last_event_id: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    identity = str(experiment_id)
    # Validate before response headers are sent; later errors become SSE error events.
    if cursor and last_event_id and cursor != last_event_id:
        await run_in_threadpool(results.logs, identity, stream, cursor, 65536)
    first = await run_in_threadpool(results.logs, identity, stream, last_event_id or cursor, 65536)

    async def events() -> AsyncIterator[str]:
        chunk = first
        previous_state = None
        while True:
            if await request.is_disconnected():
                return
            if chunk["text"]:
                yield f"id: {chunk['next_cursor']}\nevent: log\ndata: {json.dumps(chunk)}\n\n"
            if chunk["state"] != previous_state:
                yield f"event: state\ndata: {json.dumps({'state': chunk['state']})}\n\n"
                previous_state = chunk["state"]
            if chunk["eof"]:
                yield f"event: end\ndata: {json.dumps(chunk)}\n\n"
                return
            await asyncio.sleep(0.2)
            try:
                chunk = await run_in_threadpool(
                    results.logs, identity, stream, chunk["next_cursor"], 65536
                )
            except DomainError as exc:
                yield f"event: error\ndata: {json.dumps({'error': exc.symbol, 'message': exc.message})}\n\n"
                return

    return StreamingResponse(
        events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"}
    )
