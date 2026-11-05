"""Read the generated inventory for the Web overview without changing source data."""

from __future__ import annotations

import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path

from .scripts.build_catalog import inventory_fingerprint


FORM_FACTOR = {
    "cylindrical_18650": "圆柱 18650",
    "502030-size Li-polymer": "502030 型锂聚合物",
    "pouch": "软包",
    "Prismatic": "方形",
    "prismatic": "方形",
}
CATHODE = {
    "NMC": "NMC / NCM",
    "NMC111": "NMC / NCM",
    "Li0.84(Ni0.83Co0.11Mn 0.07)O2 (NCM)": "NMC / NCM",
    "LiNi0.5Mn0.3Co0.2O2": "NMC / NCM",
    "LiNi0.5Co0.2Mn0.3O2": "NMC / NCM",
    "LiFePO4": "LFP",
    "LFP": "LFP",
    "NCA": "NCA",
    "Li0.86Ni0.86Co0.11Al0.03 O2 (NCA)": "NCA",
    "LiNi0.8Co0.15Al0.05O2": "NCA",
    "LiCoO2": "LCO",
    "LiCoO2+LiNi0.4Co0.4Mn0.2O2": "LCO + NMC 混合",
    "42 wt.% Li(NiCoMn)O2 blended with 58 wt.% Li(NiCoAl)O2 (NCM+NCA)": "NMC + NCA 混合",
}
ANODE = {
    "graphite": "石墨",
    "Graphite": "石墨",
    "Graphite/Si": "石墨 / 硅",
}

PROTOCOL_CONTROL_FIELDS = {
    "rate_in_C": "倍率",
    "current_in_A": "电流",
    "voltage_in_V": "电压",
    "power_in_W": "功率",
}


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def capacity_band(value):
    """Group the recorded nominal capacity in Ah without changing its raw value."""
    if value is None or value == "":
        return "未提供"
    try:
        capacity = float(value) if not isinstance(value, bool) else math.nan
    except (TypeError, ValueError):
        return "其他/待核对"
    if not math.isfinite(capacity) or capacity <= 0:
        return "其他/待核对"
    if capacity < 0.5:
        return "<0.5 Ah"
    if capacity < 1.5:
        return "0.5～<1.5 Ah"
    if capacity < 3:
        return "1.5～<3 Ah"
    if capacity < 10:
        return "3～<10 Ah"
    return "≥10 Ah"


def protocol_categories(value):
    """Return a stage-count label and numeric control category for one protocol."""
    if value is None or value == []:
        return "未提供", "未提供"
    if not isinstance(value, list) or any(not isinstance(stage, dict) for stage in value):
        return "其他/待核对", "其他/待核对"
    controls = {
        label
        for stage in value
        for field, label in PROTOCOL_CONTROL_FIELDS.items()
        if finite_number(stage.get(field))
    }
    if len(controls) > 1:
        control_kind = "混合控制"
    elif controls:
        control_kind = next(iter(controls))
    else:
        control_kind = "未识别数值控制"
    return f"{len(value)} 阶段", control_kind


def soc_interval_group(value):
    """Classify a cell-level SOC interval; ambiguous percentage notation stays unverified."""
    if value is None or value == []:
        return "未提供"
    if not isinstance(value, list) or len(value) != 2 or not all(finite_number(item) for item in value):
        return "其他/待核对"
    low, high = value
    if 0 <= low < high <= 1:
        if math.isclose(low, 0, abs_tol=1e-8) and math.isclose(high, 1, abs_tol=1e-8):
            return "0～100%"
        if math.isclose(low, 0.2, abs_tol=1e-8) and math.isclose(high, 0.8, abs_tol=1e-8):
            return "20～80%"
        return "其他固定区间"
    if 0 <= low < high <= 100 and float(low).is_integer() and float(high).is_integer():
        return "百分制待核对"
    return "其他/待核对"


def category(raw, mapping):
    if raw is None:
        return "未知"
    return mapping.get(str(raw).strip(), "未分类")


def read_overview(index_path: Path, dataset_root: Path):
    if not index_path.is_file():
        return {"ready": False, "message": "数据目录索引尚未建立。"}
    try:
        with closing(sqlite3.connect(index_path.as_uri() + "?mode=ro", uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            state = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM catalog_state")}
            if "full_scan_completed_at" not in state:
                return {"ready": False, "message": "数据目录仍在扫描，请稍后刷新。"}
            if Path(state.get("dataset_root", "")).resolve() != dataset_root.resolve():
                return {"ready": False, "message": "索引对应另一份数据目录，请重新建立索引。"}
            rows = list(connection.execute("""
                SELECT source, name, label_value, label_file, cycle_count,
                       min_cycle, max_cycle, metadata_json, error,
                       duplicate_of_source, duplicate_of_name
                FROM cells ORDER BY source, name
            """))
    except (sqlite3.Error, OSError, ValueError) as exc:
        return {"ready": False, "message": f"数据目录索引无法读取：{exc}"}

    cells = []
    duplicates = 0
    errors = 0
    for row in rows:
        if row["duplicate_of_source"] is not None:
            duplicates += 1
            continue
        if row["error"] or not row["metadata_json"]:
            errors += 1
            continue
        metadata = json.loads(row["metadata_json"])
        form_raw = metadata.get("form_factor")
        cathode_raw = metadata.get("cathode_material")
        anode_raw = metadata.get("anode_material")
        nominal_capacity = metadata.get("nominal_capacity_in_Ah")
        charge_protocol = metadata.get("charge_protocol")
        discharge_protocol = metadata.get("discharge_protocol")
        soc_interval = metadata.get("SOC_interval")
        charge_stage_count, charge_control_kind = protocol_categories(charge_protocol)
        discharge_stage_count, _ = protocol_categories(discharge_protocol)
        label = row["label_value"]
        last = row["max_cycle"]
        cells.append({
            "source": row["source"],
            "name": row["name"],
            "cathode": category(cathode_raw, CATHODE),
            "cathode_raw": cathode_raw,
            "anode": category(anode_raw, ANODE),
            "anode_raw": anode_raw,
            "form_factor": category(form_raw, FORM_FACTOR),
            "form_factor_raw": form_raw,
            "nominal_capacity_ah": nominal_capacity,
            "capacity_band": capacity_band(nominal_capacity),
            "charge_protocol": charge_protocol,
            "charge_stage_count": charge_stage_count,
            "charge_control_kind": charge_control_kind,
            "discharge_protocol": discharge_protocol,
            "discharge_stage_count": discharge_stage_count,
            "soc_interval": soc_interval,
            "soc_interval_group": soc_interval_group(soc_interval),
            "cycle_count": row["cycle_count"],
            "first_cycle": row["min_cycle"],
            "last_cycle": last,
            "label": label,
            "label_file": row["label_file"],
            "label_beyond_detail": label is not None and last is not None and label > last,
        })

    current_fingerprint = inventory_fingerprint(dataset_root)
    return {
        "ready": True,
        "indexed_at": state["full_scan_completed_at"],
        "inventory_fingerprint": state.get("inventory_fingerprint"),
        "needs_refresh": current_fingerprint != state.get("inventory_fingerprint"),
        "physical_files": len(rows),
        "duplicate_files": duplicates,
        "unique_cells": len(cells),
        "errors": errors,
        "cells": cells,
    }
