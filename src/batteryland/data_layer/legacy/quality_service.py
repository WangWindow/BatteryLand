"""Serve audited findings only when they match the current local catalog."""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path

from .scripts.build_catalog import inventory_fingerprint
from .scripts.quality_labels import FLAG_LABELS


def read_quality(index_path: Path, report_path: Path, dataset_root: Path):
    if not index_path.is_file() or not report_path.is_file():
        return {"ready": False, "message": "数据质量核验尚未建立，请联系管理员更新数据层核验结果。"}
    try:
        with closing(sqlite3.connect(index_path.as_uri() + "?mode=ro", uri=True)) as connection:
            state = dict(connection.execute("SELECT key, value FROM catalog_state"))
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if (
            report.get("schema_version") != 1
            or report.get("index_completed_at") != state.get("full_scan_completed_at")
            or report.get("inventory_fingerprint") != state.get("inventory_fingerprint")
            or Path(report.get("dataset_root", "")).resolve() != dataset_root.resolve()
            or Path(state.get("dataset_root", "")).resolve() != dataset_root.resolve()
            or not isinstance(report.get("cells"), list)
        ):
            return {"ready": False, "message": "核验结果与当前目录索引不一致，请联系管理员更新数据层核验结果。"}
        cells = report["cells"]
        flags = Counter(flag for cell in cells for flag in cell["flags"])
        protocol_count = sum(any(flag.startswith(("charge_protocol_", "discharge_protocol_", "cell_soc_interval_"))
                                 for flag in cell["flags"]) for cell in cells)
        return {
            "ready": True,
            "generated_at": report["generated_at"],
            "inventory_fingerprint": state["inventory_fingerprint"],
            "needs_refresh": inventory_fingerprint(dataset_root) != state.get("inventory_fingerprint"),
            "unique_cells": len(cells),
            "protocol_review_cells": protocol_count,
            "flag_counts": dict(flags),
            "flag_labels": FLAG_LABELS,
            "cells": cells,
        }
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, json.JSONDecodeError) as exc:
        return {"ready": False, "message": f"数据质量核验无法读取：{exc}"}
