"""Read the fixed first-100-record audit after matching it to the local index."""

from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

from .scripts.build_catalog import inventory_fingerprint


def read_integrity(index_path: Path, report_path: Path, dataset_root: Path):
    guidance = "逐圈核验结果尚未建立或已过期。请联系管理员更新数据层核验结果。"
    if not index_path.is_file() or not report_path.is_file():
        return {"ready": False, "message": guidance}
    try:
        with closing(sqlite3.connect(index_path.resolve().as_uri() + "?mode=ro", uri=True)) as connection:
            state = dict(connection.execute("SELECT key, value FROM catalog_state"))
            keys = set(connection.execute("""
                SELECT source, name FROM cells
                WHERE duplicate_of_source IS NULL AND error IS NULL
            """).fetchall())
        report = json.loads(report_path.read_text(encoding="utf-8"))
        cells = report.get("cells")
        if (
            report.get("schema_version") != 1
            or report.get("window_records") != 100
            or report.get("index_completed_at") != state.get("full_scan_completed_at")
            or report.get("inventory_fingerprint") != state.get("inventory_fingerprint")
            or Path(report.get("dataset_root", "")).resolve() != dataset_root.resolve()
            or Path(state.get("dataset_root", "")).resolve() != dataset_root.resolve()
            or not isinstance(cells, list)
            or not isinstance(report.get("summary"), dict)
            or {(cell["source"], cell["name"]) for cell in cells} != keys
            or len(cells) != len(keys)
        ):
            return {"ready": False, "message": guidance}
        return {
            "ready": True,
            "generated_at": report["generated_at"],
            "index_completed_at": report["index_completed_at"],
            "inventory_fingerprint": report["inventory_fingerprint"],
            "needs_refresh": inventory_fingerprint(dataset_root) != state.get("inventory_fingerprint"),
            "window_records": 100,
            "summary": report["summary"],
            "cells": cells,
        }
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, json.JSONDecodeError) as exc:
        return {"ready": False, "message": f"逐圈核验结果无法读取：{exc}。{guidance}"}
