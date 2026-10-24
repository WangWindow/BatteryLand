import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from batteryland.application.ports.training import TrainingGateway
from batteryland.bootstrap import Container
from batteryland.config import Settings
from batteryland.domain.errors import DomainError
from batteryland.interfaces.api.analysis import router as analysis_router
from batteryland.interfaces.api.components import router as components_router
from batteryland.interfaces.api.execution import router as execution_router
from batteryland.interfaces.api.experiments import router as experiments_router
from batteryland.interfaces.api.resources import router as resources_router
from batteryland.interfaces.api.results import router as results_router
from batteryland.interfaces.api.schemas import ErrorData, ErrorEnvelope, ErrorField
from batteryland.interfaces.api.splits import router as splits_router

ERRORS = {
    "invalid_input": (1001, 422),
    "not_found": (1002, 404),
    "conflict": (1003, 409),
    "resource_in_use": (1004, 409),
    "unsupported_device": (1005, 422),
    "unsupported_capability": (1006, 501),
    "provider_unavailable": (1007, 503),
    "integration_precondition_failed": (1008, 409),
    "cursor_invalid": (1009, 409),
    "storage_corrupt": (1010, 500),
    "storage_busy": (1011, 503),
    "no_ground_truth": (1012, 422),
    "needs_reconciliation": (1013, 409),
}


def create_app(
    settings: Settings | None = None,
    *,
    training: TrainingGateway | None = None,
    start_monitor: bool = True,
) -> FastAPI:
    """Build the API without importing or launching the training framework."""
    configuration = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        container = Container(configuration, training=training)
        app.state.container = container
        stopped = asyncio.Event()

        async def coordinate() -> None:
            while not stopped.is_set():
                try:
                    await run_in_threadpool(container.execution.tick)
                except Exception:
                    logging.getLogger(__name__).exception("Coordinator tick failed")
                try:
                    await asyncio.wait_for(stopped.wait(), timeout=configuration.poll_interval)
                except TimeoutError:
                    pass

        task = None
        try:
            await run_in_threadpool(container.execution.recover)
            task = asyncio.create_task(coordinate()) if start_monitor else None
            yield
        finally:
            stopped.set()
            if task:
                await task
            container.close()

    app = FastAPI(
        title="BatteryLand Backend",
        version="1.0.0",
        lifespan=lifespan,
        responses={status: {"model": ErrorEnvelope} for _, status in ERRORS.values()},
    )
    app.state.settings = configuration
    app.include_router(resources_router)
    app.include_router(splits_router)
    app.include_router(experiments_router)
    app.include_router(execution_router)
    app.include_router(components_router)
    app.include_router(results_router)
    app.include_router(analysis_router)

    @app.exception_handler(DomainError)
    async def business_error(request: Request, exc: DomainError) -> JSONResponse:
        code, status = ERRORS.get(exc.symbol, (1010, 500))
        body = ErrorEnvelope(
            code=code,
            message=exc.message,
            data=ErrorData(error=exc.symbol, details=exc.details),
        )
        return JSONResponse(status_code=status, content=body.model_dump(mode="json"))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [
            ErrorField(path=".".join(str(part) for part in item["loc"]), message=item["msg"])
            for item in exc.errors()
        ]
        body = ErrorEnvelope(
            code=1001,
            message="Request validation failed",
            data=ErrorData(error="invalid_input", fields=fields),
        )
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        symbol = "not_found" if exc.status_code == 404 else "invalid_input"
        body = ErrorEnvelope(
            code=ERRORS[symbol][0], message=str(exc.detail), data=ErrorData(error=symbol)
        )
        return JSONResponse(
            status_code=exc.status_code, content=body.model_dump(mode="json"), headers=exc.headers
        )

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception) -> JSONResponse:
        logging.getLogger(__name__).error("Unhandled backend failure", exc_info=exc)
        body = ErrorEnvelope(
            code=1010, message="Backend operation failed", data=ErrorData(error="storage_corrupt")
        )
        return JSONResponse(status_code=500, content=body.model_dump(mode="json"))

    return app
