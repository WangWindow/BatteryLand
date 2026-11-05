"""Expose only a delivery manifest that matches the current audited snapshot."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .catalog_service import read_overview
from .integrity_service import read_integrity
from .quality_service import read_quality


def read_delivery_status(index_path: Path, quality_path: Path, integrity_path: Path,
                         manifest_path: Path, csv_path: Path, dataset_root: Path):
    guidance = "统一数据清单尚未建立或已过期。请联系管理员更新数据层核验结果。"
    if not manifest_path.is_file() or not csv_path.is_file():
        return {"ready": False, "message": guidance}
    try:
        overview = read_overview(index_path, dataset_root)
        quality = read_quality(index_path, quality_path, dataset_root)
        integrity = read_integrity(index_path, integrity_path, dataset_root)
        if any(not report.get("ready") or report.get("needs_refresh")
               for report in (overview, quality, integrity)):
            return {"ready": False, "message": guidance}
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
        cells = document.get("cells")
        summary = document.get("summary")
        if (
            document.get("schema_version") != 1
            or document.get("purpose") != "descriptive_inventory_only"
            or document.get("window_records") != 100
            or Path(document.get("dataset_root", "")).resolve() != dataset_root.resolve()
            or document.get("inventory_fingerprint") != overview.get("inventory_fingerprint")
            or document.get("index_completed_at") != overview.get("indexed_at")
            or document.get("quality_audit_generated_at") != quality.get("generated_at")
            or document.get("early_cycle_audit_generated_at") != integrity.get("generated_at")
            or not isinstance(cells, list)
            or not isinstance(summary, dict)
            or len(cells) != overview.get("unique_cells")
            or len(cells) != summary.get("unique_cells")
            or {(cell["source"], cell["name"]) for cell in cells}
               != {(cell["source"], cell["name"]) for cell in overview["cells"]}
            or hashlib.sha256(csv_path.read_bytes()).hexdigest() != document.get("csv_sha256")
        ):
            return {"ready": False, "message": guidance}
        return {
            "ready": True,
            "generated_at": document["generated_at"],
            "inventory_fingerprint": document["inventory_fingerprint"],
            "summary": summary,
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        return {"ready": False, "message": f"统一数据清单无法读取：{exc}。{guidance}"}
