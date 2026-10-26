import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from batteryland.analytics.routes import router as analysis_router
from batteryland.api.schemas import Envelope, ErrorData, ErrorEnvelope, ErrorField
from batteryland.common.errors import DomainError
from batteryland.components.routes import router as components_router
from batteryland.config import Settings
from batteryland.container import Container
from batteryland.datasets.catalog_status_routes import router as catalog_status_router
from batteryland.datasets.logical_routes import router as logical_datasets_router
from batteryland.datasets.routes import router as resources_router
from batteryland.datasets.split_routes import router as splits_router
from batteryland.experiments.validated_routes import router as validated_experiments_router
from batteryland.results.routes import router as results_router
from batteryland.scheduler.routes import router as scheduler_router
from batteryland.scheduler.service import LocalScheduler
from batteryland.training.routes import router as training_router

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
    "unauthorized": (1014, 401),
}


def create_app(
    settings: Settings | None = None,
    *,
    start_monitor: bool = False,
) -> FastAPI:
    """Build the API without importing or launching the training framework."""
    configuration = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        container = Container(configuration)
        app.state.container = container
        app.state.scheduler = None
        stopped = asyncio.Event()

        async def schedule_local(scheduler: LocalScheduler) -> None:
            while not stopped.is_set():
                try:
                    await run_in_threadpool(scheduler.tick)
                except Exception:
                    logging.getLogger(__name__).exception("Local scheduler tick failed")
                try:
                    await asyncio.wait_for(stopped.wait(), timeout=5)
                except TimeoutError:
                    pass

        async def synchronize_catalog() -> None:
            while not stopped.is_set():
                try:
                    await run_in_threadpool(container.catalog_indexer.index)
                except Exception:
                    logging.getLogger(__name__).exception("Asset catalog synchronization failed")
                try:
                    await asyncio.wait_for(
                        stopped.wait(), timeout=configuration.catalog_scan_interval_seconds
                    )
                except TimeoutError:
                    pass

        tasks: list[asyncio.Task[None]] = []
        try:
            if configuration.auto_index_catalog:
                tasks.append(asyncio.create_task(synchronize_catalog()))
            if start_monitor:
                scheduler = LocalScheduler(
                    container.scheduler_state,
                    container.validated_experiments,
                    container.training_runs,
                    container.results,
                    container.artifacts,
                    configuration.data_dir,
                )
                app.state.scheduler = scheduler
                tasks.append(asyncio.create_task(schedule_local(scheduler)))
            yield
        finally:
            stopped.set()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            container.close()

    app = FastAPI(
        title="BatteryLand Backend",
        version="1.0.0",
        lifespan=lifespan,
        responses={status: {"model": ErrorEnvelope} for _, status in ERRORS.values()},
    )
    app.state.settings = configuration
    app.include_router(resources_router)
    app.include_router(catalog_status_router)
    app.include_router(logical_datasets_router)
    app.include_router(splits_router)
    app.include_router(scheduler_router)
    app.include_router(components_router)
    app.include_router(results_router)
    app.include_router(analysis_router)
    app.include_router(validated_experiments_router)
    app.include_router(training_router)

    @app.get("/api/v1/health", response_model=Envelope[dict[str, str]], tags=["service"])
    def health() -> dict[str, object]:
        return {"data": {"service": "data", "status": "ready"}}

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
