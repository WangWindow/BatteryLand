"""Combine matching catalog and audit snapshots into a descriptive data manifest.

All source data is read-only. Outputs stay in this Web project. The manifest
describes observed records and does not decide training eligibility.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sys
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

from ..catalog_service import read_overview  # noqa: E402
from ..integrity_service import read_integrity  # noqa: E402
from ..quality_service import read_quality  # noqa: E402


OUTPUT = Path(os.environ.get("BATTERYLAND_DATA_LAYER_CACHE_DIR", PROJECT / "data"))
INDEX = OUTPUT / "catalog.sqlite3"
QUALITY = OUTPUT / "quality_flags.json"
INTEGRITY = OUTPUT / "early_cycle_integrity.json"
JSON_OUTPUT = OUTPUT / "delivery_manifest.json"
CSV_OUTPUT = OUTPUT / "delivery_manifest.csv"
REPORT = OUTPUT / "DATA_DELIVERY_MANIFEST.md"
CSV_COLUMNS = (
    "source", "name", "label_value", "label_file", "cycle_count", "first_record_cycle", "min_cycle",
    "max_cycle", "label_beyond_detail", "nominal_capacity_ah", "cathode_raw",
    "anode_raw", "form_factor_raw", "soc_interval", "charge_stage_count",
    "charge_numeric_controls", "discharge_stage_count", "discharge_numeric_controls",
    "quality_flags", "inspected_records", "first_window_is_1_to_100",
    "number_gaps_in_first_100", "core_with_finite_records",
    "core_equal_length_records", "temperature_absent_records",
    "temperature_no_finite_records", "size_bytes", "mtime_ns",
    "inventory_fingerprint", "index_completed_at",
)


def keyed(rows):
    result = {(row["source"], row["name"]): row for row in rows}
    if len(result) != len(rows):
        raise ValueError("报告中存在重复的来源与电池编号。")
    return result


def build_document(overview, quality, integrity, dataset_root: Path, now=None):
    for name, report in (("目录", overview), ("质量核验", quality), ("逐圈核验", integrity)):
        if not report.get("ready"):
            raise ValueError(f"{name}不可用：{report.get('message', '无详细说明')}")
        if report.get("needs_refresh"):
            raise ValueError(f"{name}对应的原始文件清单已变化，请重新完成全量核验。")
    if (
        not overview.get("inventory_fingerprint")
        or overview["inventory_fingerprint"] != quality.get("inventory_fingerprint")
        or overview["inventory_fingerprint"] != integrity.get("inventory_fingerprint")
        or overview["indexed_at"] != integrity.get("index_completed_at")
        or integrity.get("window_records") != 100
    ):
        raise ValueError("目录、质量核验和逐圈核验不属于同一份数据快照。")
    catalog = keyed(overview["cells"])
    flags = keyed(quality["cells"])
    cycles = keyed(integrity["cells"])
    if not catalog or catalog.keys() != flags.keys() or catalog.keys() != cycles.keys():
        raise ValueError("三份结果的去重电池集合不一致。")
    if len(catalog) != overview["unique_cells"] or len(flags) != quality["unique_cells"]:
        raise ValueError("报告电池计数与逐电池记录不一致。")

    cells = []
    for key in sorted(catalog):
        source, name = key
        base, review, audit = catalog[key], flags[key], cycles[key]
        if (base["label"] != review["label_value"] or base["label"] != audit["label_value"]
                or base["cycle_count"] != review["cycle_count"]
                or base["cycle_count"] != audit["cycle_count"]):
            raise ValueError(f"标签或详细记录数不一致：{source}/{name}")
        temperature = audit["field_totals"]["temperature_in_C"]
        no_finite = (audit["inspected_records"] - temperature["absent"] - temperature["empty"]
                     - temperature["invalid_shape"] - temperature["with_finite_values"])
        if no_finite < 0:
            raise ValueError(f"温度记录计数不一致：{source}/{name}")
        cells.append({
            "source": source, "name": name,
            "label_value": base["label"], "label_file": base["label_file"],
            "cycle_count": base["cycle_count"],
            "first_record_cycle": audit["first_number"], "min_cycle": base["first_cycle"],
            "max_cycle": base["last_cycle"], "label_beyond_detail": base["label_beyond_detail"],
            "nominal_capacity_ah": base["nominal_capacity_ah"],
            "cathode_raw": base["cathode_raw"], "anode_raw": base["anode_raw"],
            "form_factor_raw": base["form_factor_raw"], "soc_interval": base["soc_interval"],
            "charge_stage_count": review["protocol"]["charge"]["stage_count"],
            "charge_numeric_controls": review["protocol"]["charge"]["control_kinds"],
            "discharge_stage_count": review["protocol"]["discharge"]["stage_count"],
            "discharge_numeric_controls": review["protocol"]["discharge"]["control_kinds"],
            "quality_flags": review["flags"],
            "inspected_records": audit["inspected_records"],
            "first_window_is_1_to_100": audit["inspected_records"] == 100 and audit["first_window_is_1_to_n"],
            "number_gaps_in_first_100": audit["missing_numbers_between_adjacent_records"],
            "core_with_finite_records": audit["core_with_finite_records"],
            "core_equal_length_records": audit["core_equal_length_records"],
            "temperature_absent_records": temperature["absent"],
            "temperature_no_finite_records": no_finite,
            "size_bytes": audit["size_bytes"], "mtime_ns": audit["mtime_ns"],
        })
    grouped = defaultdict(list)
    for cell in cells:
        grouped[cell["source"]].append(cell)
    source_rows = []
    for source, group in sorted(grouped.items()):
        source_rows.append({
            "source": source, "cells": len(group),
            "with_label": sum(cell["label_value"] is not None for cell in group),
            "at_least_100_records": sum(cell["inspected_records"] == 100 for cell in group),
            "numbered_1_to_100": sum(cell["first_window_is_1_to_100"] for cell in group),
            "label_beyond_detail": sum(cell["label_beyond_detail"] for cell in group),
            "with_quality_flags": sum(bool(cell["quality_flags"]) for cell in group),
        })
    summary = {
        "unique_cells": len(cells),
        "with_label": sum(row["with_label"] for row in source_rows),
        "at_least_100_records": sum(row["at_least_100_records"] for row in source_rows),
        "numbered_1_to_100": sum(row["numbered_1_to_100"] for row in source_rows),
        "label_beyond_detail": sum(row["label_beyond_detail"] for row in source_rows),
        "with_quality_flags": sum(row["with_quality_flags"] for row in source_rows),
        "sources": source_rows,
    }
    timestamp = now or datetime.now(timezone.utc)
    return {
        "schema_version": 1, "purpose": "descriptive_inventory_only",
        "generated_at": timestamp.isoformat(),
        "dataset_root": str(dataset_root.resolve()),
        "inventory_fingerprint": overview["inventory_fingerprint"],
        "index_completed_at": overview["indexed_at"],
        "quality_audit_generated_at": quality["generated_at"],
        "early_cycle_audit_generated_at": integrity["generated_at"],
        "window_records": 100,
        "summary": summary, "cells": cells,
    }


def csv_safe(value):
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    elif isinstance(value, bool):
        value = "是" if value else "否"
    else:
        value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def render_csv(document):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for cell in document["cells"]:
        writer.writerow([csv_safe(cell.get(column) if column not in {"inventory_fingerprint", "index_completed_at"}
                                  else document[column]) for column in CSV_COLUMNS])
    return "\ufeff" + stream.getvalue()


def render_report(document):
    summary = document["summary"]
    lines = [
        "# 数据交付清单说明", "",
        f"生成时间：{datetime.fromisoformat(document['generated_at']).astimezone().strftime('%Y-%m-%d %H:%M %Z')}。"
        f"目录索引时间：{document['index_completed_at']}。", "",
        "本清单合并同一数据快照的目录索引、标签与协议核验、前 100 条详细记录核验。"
        "逐电池机器可读版本见 `data/delivery_manifest.json`，表格版本见 `data/delivery_manifest.csv`。"
        "原始 BatteryLife 数据目录只读。", "",
        f"- 去重电池：**{summary['unique_cells']}**；有数值标签：**{summary['with_label']}**。",
        f"- 至少 100 条详细记录：**{summary['at_least_100_records']}**；前 100 条实际编号恰好为 1–100：**{summary['numbered_1_to_100']}**。",
        f"- 标签超出详细曲线：**{summary['label_beyond_detail']}**；至少一项质量标记：**{summary['with_quality_flags']}**。质量标记可重叠。", "",
        f"数据清单指纹：`{document['inventory_fingerprint']}`。",
        "指纹由原始文件的路径、大小、修改时间组成，用于检查清单快照，不是文件内容哈希。", "",
        "| 来源 | 去重电池 | 有标签 | ≥100 条 | 编号 1–100 | 标签超详细曲线 | 有质量标记 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary["sources"]:
        lines.append(f"| {row['source']} | {row['cells']} | {row['with_label']} | "
                     f"{row['at_least_100_records']} | {row['numbered_1_to_100']} | "
                     f"{row['label_beyond_detail']} | {row['with_quality_flags']} |")
    lines += [
        "", "## 使用边界", "",
        "这是一份描述性数据清单，不给出可训练样本、统一 EOL 阈值、实测／外推标签状态或协议可比性的结论。"
        "`first_window_is_1_to_100` 仅描述文件顺序中前 100 条实际编号；核心信号计数仅描述有限数值和长度。",
        "温度字段的未提供记录与字段存在但无有限值的记录分别计数。"
        "需要查看具体编号跳跃和字段状态时，以前 100 条核验报告和网页逐电池依据为准。", "",
        "添加或修改电池文件后，在 BatteryLand 项目根目录运行 `.venv/bin/python -m batteryland.data_layer.prepare` 更新本清单。"
        "只有目录、质量和逐圈核验报告属于同一快照时才写出结果。", "",
    ]
    return "\n".join(lines)


def atomic_text(path: Path, value: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="") as stream:
        stream.write(value)
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description="合并当前 BatteryLife 数据层的描述性交付清单")
    parser.add_argument("--check", action="store_true", help="只检查并打印汇总，不写入文件")
    args = parser.parse_args()
    if not INDEX.is_file():
        raise SystemExit("目录索引不存在，请先运行 python -m batteryland.data_layer.prepare。")
    import sqlite3
    with closing(sqlite3.connect(INDEX.as_uri() + "?mode=ro", uri=True)) as connection:
        state = dict(connection.execute("SELECT key, value FROM catalog_state"))
    root = Path(state["dataset_root"])
    try:
        document = build_document(
            read_overview(INDEX, root), read_quality(INDEX, QUALITY, root),
            read_integrity(INDEX, INTEGRITY, root), root,
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise SystemExit(f"无法生成数据交付清单：{exc}") from exc
    if args.check:
        print(json.dumps(document["summary"], ensure_ascii=False, indent=2))
        return
    csv_content = render_csv(document)
    document["csv_sha256"] = hashlib.sha256(csv_content.encode("utf-8")).hexdigest()
    atomic_text(JSON_OUTPUT, json.dumps(document, ensure_ascii=False, allow_nan=False, indent=2) + "\n")
    atomic_text(CSV_OUTPUT, csv_content)
    atomic_text(REPORT, render_report(document))
    print(f"已合并 {len(document['cells'])} 块去重电池：{JSON_OUTPUT}")
    print(f"CSV 清单：{CSV_OUTPUT}")
    print(f"口径说明：{REPORT}")


if __name__ == "__main__":
    main()
