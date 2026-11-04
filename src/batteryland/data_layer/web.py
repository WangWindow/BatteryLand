"""Serve the original BatteryLife browser on BatteryLand's own origin.

Only the three read-only pages and their APIs are mounted. The processed data
directory is read-only; generated catalog and audit files live under var.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from batteryland.config import Settings

from .legacy.catalog_service import read_overview
from .legacy.dataset import BatteryDataset
from .legacy.delivery_service import read_delivery_status
from .legacy.integrity_service import read_integrity
from .legacy.quality_service import read_quality
from .legacy.trajectory_service import TrajectoryCache

LOGGER = logging.getLogger(__name__)
STATIC = Path(__file__).resolve().parent / "legacy" / "static"
PAGES = {"": "index.html", "overview": "overview.html", "trends": "trends.html"}
ASSETS = {
    "styles.css", "theme.css", "site-config.js", "site-navigation.js", "app.js",
    "overview.css", "overview.js", "trajectory.js", "trends.css", "trends.js",
}


def create_data_layer_app(settings: Settings) -> FastAPI:
    """Mount a separate app so the legacy page keeps its API response format."""
    app = FastAPI(title="BatteryLife data layer", docs_url=None, redoc_url=None, openapi_url=None)
    root = settings.source_roots.get("battery_life")
    cache = settings.data_dir / "data-layer"
    index = cache / "catalog.sqlite3"
    quality = cache / "quality_flags.json"
    integrity = cache / "early_cycle_integrity.json"
    manifest_json = cache / "delivery_manifest.json"
    manifest_csv = cache / "delivery_manifest.csv"
    dataset: BatteryDataset | None = None
    trajectories: TrajectoryCache | None = None

    def current_dataset() -> BatteryDataset:
        nonlocal dataset, trajectories
        if root is None:
            raise HTTPException(503, "尚未配置 battery_life 数据目录")
        if dataset is None:
            try:
                dataset = BatteryDataset(root)
            except ValueError as exc:
                raise HTTPException(503, str(exc)) from exc
            trajectories = TrajectoryCache(dataset, index, cache / "trajectory_cache.sqlite3")
        return dataset

    @app.exception_handler(KeyError)
    async def missing_cell(_request, exc: KeyError) -> JSONResponse:
        return JSONResponse({"error": str(exc).strip("'\"")}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid_value(_request, exc: ValueError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected_error(_request, exc: Exception) -> JSONResponse:
        LOGGER.exception("BatteryLife data layer read failed", exc_info=exc)
        return JSONResponse({"error": "读取电池文件失败，请查看服务日志"}, status_code=500)

    @app.get("/")
    async def detail_page() -> FileResponse:
        return FileResponse(STATIC / PAGES[""])

    @app.get("/overview")
    async def overview_page() -> FileResponse:
        return FileResponse(STATIC / PAGES["overview"])

    @app.get("/trends")
    async def trends_page() -> FileResponse:
        return FileResponse(STATIC / PAGES["trends"])

    @app.get("/{asset_name}")
    async def asset(asset_name: str) -> FileResponse:
        if asset_name not in ASSETS:
            raise HTTPException(404, "页面不存在")
        return FileResponse(STATIC / asset_name)

    @app.get("/api/catalog")
    async def catalog() -> dict:
        return await run_in_threadpool(current_dataset().catalog)

    @app.get("/api/overview")
    async def overview() -> dict:
        return await run_in_threadpool(read_overview, index, current_dataset().root)

    @app.get("/api/trajectories")
    async def trajectory_page(after: int = 0) -> dict:
        current_dataset()
        assert trajectories is not None
        return await run_in_threadpool(trajectories.page, after)

    @app.get("/api/quality")
    async def quality_report() -> dict:
        return await run_in_threadpool(read_quality, index, quality, current_dataset().root)

    @app.get("/api/early-cycles")
    async def integrity_report() -> dict:
        return await run_in_threadpool(read_integrity, index, integrity, current_dataset().root)

    def delivery_status() -> dict:
        return read_delivery_status(
            index, quality, integrity, manifest_json, manifest_csv, current_dataset().root
        )

    @app.get("/api/delivery-status")
    async def delivery() -> dict:
        return await run_in_threadpool(delivery_status)

    @app.get("/download/delivery-manifest.csv")
    @app.get("/download/delivery-manifest.json")
    async def download_manifest(request: Request) -> FileResponse:
        status = await run_in_threadpool(delivery_status)
        if not status["ready"]:
            raise HTTPException(409, status["message"])
        # The fixed route path, not a browser-supplied filesystem path, selects the file.
        path = manifest_csv if request.url.path.endswith(".csv") else manifest_json
        return FileResponse(path, filename=path.name)

    @app.get("/api/summary")
    async def summary(source: str = "", cell: str = "") -> dict:
        return await run_in_threadpool(current_dataset().summary, source, cell)

    @app.get("/api/cycle")
    async def cycle(source: str = "", cell: str = "", index_number: int = Query(alias="index")) -> dict:
        return await run_in_threadpool(current_dataset().cycle, source, cell, index_number)

    @app.get("/api/incremental-capacity")
    async def incremental_capacity(
        source: str = "", cell: str = "", index_number: int = Query(alias="index")
    ) -> dict:
        return await run_in_threadpool(
            current_dataset().incremental_capacity, source, cell, index_number
        )

    return app
