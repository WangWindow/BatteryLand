"""Audit the first 100 detailed records of each indexed BatteryLife cell.

Only trusted local pickle files are read. All outputs stay in this Web project.
The audit describes observed records; it does not decide model eligibility.
"""

from __future__ import annotations

import argparse
import gc
import json
import math
import os
import sqlite3
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

from .build_catalog import cycle_number, inventory_fingerprint
from ..battery_storage import load_cell, resolve_cell_path


OUTPUT = Path(os.environ.get("BATTERYLAND_DATA_LAYER_CACHE_DIR", PROJECT / "data"))
INDEX = OUTPUT / "catalog.sqlite3"
RESULT = OUTPUT / "early_cycle_integrity.json"
REPORT = OUTPUT / "EARLY_CYCLE_INTEGRITY.md"
WINDOW = 100
FIELDS = (
    "time_in_s", "voltage_in_V", "current_in_A", "discharge_capacity_in_Ah",
    "charge_capacity_in_Ah", "temperature_in_C",
)
CORE = ("voltage_in_V", "current_in_A", "discharge_capacity_in_Ah")
FIELD_LABELS = {
    "time_in_s": "时间", "voltage_in_V": "电压", "current_in_A": "电流",
    "discharge_capacity_in_Ah": "放电容量",
    "charge_capacity_in_Ah": "充电容量", "temperature_in_C": "温度",
}


def finite_scalar(value):
    if isinstance(value, (bool, complex)):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def series_info(value):
    if value is None:
        return {"state": "absent", "length": 0, "finite": 0}
    if isinstance(value, (str, bytes, dict)):
        return {"state": "invalid_shape", "length": 0, "finite": 0}
    try:
        array = np.asarray(value)
    except (TypeError, ValueError):
        return {"state": "invalid_shape", "length": 0, "finite": 0}
    if array.ndim != 1:
        return {"state": "invalid_shape", "length": 0, "finite": 0}
    length = len(array)
    if not length:
        return {"state": "empty", "length": 0, "finite": 0}
    if array.dtype.kind in "iuf":
        finite = int(np.count_nonzero(np.isfinite(array)))
    elif array.dtype.kind == "b":
        finite = 0
    else:
        finite = sum(finite_scalar(item) for item in array)
    return {"state": "present", "length": length, "finite": finite}


def empty_field_totals():
    return {field: {
        "absent": 0, "empty": 0, "invalid_shape": 0,
        "with_finite_values": 0, "all_values_finite": 0,
        "different_length_from_time": 0,
    } for field in FIELDS}


def inspect_data(data, window=WINDOW):
    cycles = data.get("cycle_data") if isinstance(data, dict) else None
    if not isinstance(cycles, list):
        raise ValueError("Expected dictionary with cycle_data list")
    selected = cycles[:window]
    numbers = [cycle_number(cycle.get("cycle_number")) if isinstance(cycle, dict) else None
               for cycle in selected]
    adjacent_missing = sum(max(0, right - left - 1)
                           for left, right in zip(numbers, numbers[1:])
                           if left is not None and right is not None)
    first_contiguous = 0
    for position, number in enumerate(numbers):
        if number is None or (position and number != numbers[position - 1] + 1):
            break
        first_contiguous += 1

    field_totals = empty_field_totals()
    core_with_finite = core_equal_length = core_equal_time = 0
    examples = {"number_gap": [], "core_missing_or_empty": [], "core_length_mismatch": []}
    for record_index, cycle in enumerate(selected):
        if not isinstance(cycle, dict):
            raise ValueError(f"cycle_data[{record_index}] is not a dictionary")
        number = numbers[record_index]
        display_number = number if number is not None else f"位置 {record_index + 1}"
        if record_index and numbers[record_index - 1] is not None and number is not None:
            if number != numbers[record_index - 1] + 1 and len(examples["number_gap"]) < 3:
                examples["number_gap"].append([numbers[record_index - 1], number])
        details = {field: series_info(cycle.get(field)) for field in FIELDS}
        time_info = details["time_in_s"]
        for field, info in details.items():
            totals = field_totals[field]
            if info["state"] != "present":
                totals[info["state"]] += 1
            if info["finite"] > 0:
                totals["with_finite_values"] += 1
            if info["length"] > 0 and info["finite"] == info["length"]:
                totals["all_values_finite"] += 1
            if (field != "time_in_s" and info["length"] > 0 and time_info["length"] > 0
                    and info["length"] != time_info["length"]):
                totals["different_length_from_time"] += 1

        core = [details[field] for field in CORE]
        has_core = all(info["finite"] >= 2 for info in core)
        equal_core = has_core and len({info["length"] for info in core}) == 1
        equal_time = equal_core and time_info["length"] == core[0]["length"] and time_info["finite"] >= 2
        core_with_finite += has_core
        core_equal_length += equal_core
        core_equal_time += equal_time
        if not has_core and len(examples["core_missing_or_empty"]) < 3:
            examples["core_missing_or_empty"].append(display_number)
        if has_core and not equal_core and len(examples["core_length_mismatch"]) < 3:
            examples["core_length_mismatch"].append(display_number)

    return {
        "cycle_count": len(cycles), "inspected_records": len(selected),
        "first_number": numbers[0] if numbers else None,
        "last_inspected_number": numbers[-1] if numbers else None,
        "invalid_numbers_in_window": sum(number is None for number in numbers),
        "missing_numbers_between_adjacent_records": adjacent_missing,
        "contiguous_records_from_first": first_contiguous,
        "starts_at_one": bool(numbers) and numbers[0] == 1,
        "first_window_is_1_to_n": len(selected) == window and numbers == list(range(1, window + 1)),
        "field_totals": field_totals,
        "core_with_finite_records": core_with_finite,
        "core_equal_length_records": core_equal_length,
        "core_equal_time_records": core_equal_time,
        "examples": examples,
    }


def summarize(cells, window):
    grouped = defaultdict(list)
    for cell in cells:
        grouped[cell["source"]].append(cell)
    sources = []
    for source, group in sorted(grouped.items()):
        enough = [cell for cell in group if cell["cycle_count"] >= window]
        sources.append({
            "source": source, "cells": len(group), "at_least_window": len(enough),
            "window_from_cycle_one": sum(cell["first_window_is_1_to_n"] for cell in enough),
            "window_with_core_finite": sum(cell["core_with_finite_records"] == window for cell in enough),
            "window_with_core_equal_length": sum(cell["core_equal_length_records"] == window for cell in enough),
            "cells_with_gap_in_window": sum(cell["missing_numbers_between_adjacent_records"] > 0 for cell in group),
            "cells_with_missing_temperature": sum(cell["field_totals"]["temperature_in_C"]["with_finite_values"] < cell["inspected_records"] for cell in group),
        })
    field_totals = empty_field_totals()
    for cell in cells:
        for field in FIELDS:
            for metric in field_totals[field]:
                field_totals[field][metric] += cell["field_totals"][field][metric]
    return {
        "unique_cells": len(cells),
        "at_least_window": sum(row["at_least_window"] for row in sources),
        "window_from_cycle_one": sum(row["window_from_cycle_one"] for row in sources),
        "window_with_core_finite": sum(row["window_with_core_finite"] for row in sources),
        "window_with_core_equal_length": sum(row["window_with_core_equal_length"] for row in sources),
        "inspected_records": sum(cell["inspected_records"] for cell in cells),
        "cells_with_gap_in_window": sum(row["cells_with_gap_in_window"] for row in sources),
        "sources": sources, "fields": field_totals,
    }


def render_report(document):
    summary = document["summary"]
    n = document["window_records"]
    from_one_with_label = sum(cell["first_window_is_1_to_n"] and cell["label_value"] is not None
                              for cell in document["cells"])
    at_least_window_with_label = sum(cell["cycle_count"] >= n and cell["label_value"] is not None
                                     for cell in document["cells"])
    lines = [
        "# 前 100 条详细 cycle 记录完整性核验", "",
        f"生成时间：{document['generated_at_local']}。目录索引完成时间：{document['index_completed_at']}。", "",
        "本报告只读取可信的本地 BatteryLife 电池文件，按已核对的 58 份相同副本去重。"
        f"每块电池最多检查文件顺序中的前 {n} 条详细 cycle 记录；没有的记录不补造。"
        "逐电池计数、原始文件尺寸和修改时间见 `data/early_cycle_integrity.json`。", "",
        "## 当前快照", "",
        f"- 去重电池：**{summary['unique_cells']}**；至少 {n} 条详细记录：**{summary['at_least_window']}**。",
        f"- 在前 {n} 条中，实际 cycle 编号正好为 1–{n}：**{summary['window_from_cycle_one']}** 块。"
        "这只是编号连续性，不说明每圈信号完整。",
        f"- 至少 {n} 条记录且有数值标签：**{at_least_window_with_label}** 块；"
        f"同时要求前 {n} 条编号正好为 1–{n} 且有数值标签：**{from_one_with_label}** 块。"
        "两者差别来自观察窗口定义；标签生成口径仍未统一，二者都不是训练集规模。",
        f"- 前 {n} 条中每条电压、电流、放电容量都至少有 2 个有限数值点：**{summary['window_with_core_finite']}** 块；"
        f"三种序列在每圈长度相同：**{summary['window_with_core_equal_length']}** 块。"
        "这里没有要求时间与温度字段存在，也没有检查物理合理性。",
        f"- 检查的详细记录总数：**{summary['inspected_records']}**；"
        f"前 {n} 条记录内相邻编号之间有跳号的电池：**{summary['cells_with_gap_in_window']}** 块。"
        "跳号可能来自源数据的采样或预处理策略，尚不等于错误。", "",
        "| 来源 | 电池 | 至少 100 条 | 前 100 编号为 1–100 | 前 100 三信号有数值 | 前 100 三信号等长 | 前 100 有跳号 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in summary["sources"]:
        lines.append(f"| {row['source']} | {row['cells']} | {row['at_least_window']} | "
                     f"{row['window_from_cycle_one']} | {row['window_with_core_finite']} | "
                     f"{row['window_with_core_equal_length']} | {row['cells_with_gap_in_window']} |")
    lines += ["", "## 单项采样信号", "",
              "下表按前 100 条内实际检查的 cycle 记录计数，同一记录可以同时出现在多项中。"
              "“有有限数值”至少有一个可显示数字；“全部有限”要求序列非空且每个值有限。"
              "“字段存在但无有限值”区别于未提供，可能包含 NaN 等占位值。"
              "温度或充电容量缺失会单独列出，不自动作为问题。", "",
              "| 信号 | 未提供 | 空序列 | 形状不符 | 存在但无有限值 | 有有限数值 | 全部有限 | 与时间长度不同 |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for field in FIELDS:
        item = summary["fields"][field]
        without_finite = (summary["inspected_records"] - item["absent"] - item["empty"]
                          - item["invalid_shape"] - item["with_finite_values"])
        lines.append(f"| {FIELD_LABELS[field]} | {item['absent']} | {item['empty']} | "
                     f"{item['invalid_shape']} | {without_finite} | {item['with_finite_values']} | "
                     f"{item['all_values_finite']} | {item['different_length_from_time']} |")
    lines += ["", "## 温度采样的来源差异", "",
              "按已检查的详细 cycle 记录计数。“存在但无有限值”说明字段在文件中存在，"
              "但本次不能从该记录显示温度数值。CALB 的温度可能是预处理脚本写入的分组常数，"
              "即使有有限值也不代表实时测温。", "",
              "| 来源 | 已检查记录 | 温度未提供 | 温度存在但无有限值 | 温度有有限值 |",
              "| --- | ---: | ---: | ---: | ---: |"]
    grouped_cells = defaultdict(list)
    for cell in document["cells"]:
        grouped_cells[cell["source"]].append(cell)
    for source, group in sorted(grouped_cells.items()):
        inspected = sum(cell["inspected_records"] for cell in group)
        temp = {metric: sum(cell["field_totals"]["temperature_in_C"][metric] for cell in group)
                for metric in ("absent", "empty", "invalid_shape", "with_finite_values")}
        without_finite = inspected - sum(temp.values())
        lines.append(f"| {source} | {inspected} | {temp['absent']} | "
                     f"{without_finite} | {temp['with_finite_values']} |")
    charge = summary["fields"]["charge_capacity_in_Ah"]
    partial_charge = charge["with_finite_values"] - charge["all_values_finite"]
    lines += ["", f"充电容量序列另有 **{partial_charge}** 条记录包含有限数值，但并非每个采样值都有限。"
              "这项计数只说明数值状态，不判断曲线是否可用于特征计算。"]
    examples = [cell for cell in document["cells"] if cell["examples"]["number_gap"]][:8]
    lines += ["", "## 编号跳跃示例", ""]
    if examples:
        for cell in examples:
            pair = cell["examples"]["number_gap"][0]
            lines.append(f"- `{cell['source']}/{cell['name']}`：相邻两条记录的实际编号为 {pair[0]}、{pair[1]}。")
    else:
        lines.append("本次检查的前 100 条记录中，没有发现相邻编号跳跃。")
    lines += ["", "## 使用边界", "",
              "该盘点只看文件顺序中的前 100 条。实际记录可能从其他编号开始；编号跳跃可能是数据采样策略。"
              "“三信号等长”只核对每条记录的电压、电流、放电容量数组长度及有限数值，"
              "不证明时间轴、单位、传感器校准、曲线物理合理性或寿命标签可靠。", "",
              "本报告不定义训练样本，不自动排除电池。若要做衍生特征或模型实验，"
              "下一步需按来源确认信号含义和缺失机制，并记录实际采用的样本准入规则。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="核查去重电池的前 100 条详细 cycle 记录")
    parser.add_argument("--no-write", action="store_true", help="只打印汇总，不更新报告")
    parser.add_argument("--report-only", action="store_true", help="仅从已核对的逐电池结果重建文字报告")
    args = parser.parse_args()
    if not INDEX.is_file():
        raise SystemExit("目录索引不存在，请先运行 python scripts/build_catalog.py")
    with sqlite3.connect(INDEX.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        state = dict(connection.execute("SELECT key, value FROM catalog_state"))
        if not state.get("full_scan_completed_at"):
            raise SystemExit("目录索引尚未完成全量扫描。")
        root = Path(state["dataset_root"])
        fingerprint = state.get("inventory_fingerprint")
        if not root.is_dir() or inventory_fingerprint(root) != fingerprint:
            raise SystemExit("原始文件清单与索引不一致，请重新建立目录索引。")
        rows = connection.execute("""
            SELECT source, name, size_bytes, mtime_ns, label_value, cycle_count
            FROM cells WHERE duplicate_of_source IS NULL AND error IS NULL
            ORDER BY source, name
        """).fetchall()

    if args.report_only:
        if not RESULT.is_file():
            raise SystemExit("逐电池核验结果不存在，请先完成全量核验。")
        document = json.loads(RESULT.read_text(encoding="utf-8"))
        expected_keys = {(row["source"], row["name"]) for row in rows}
        actual_keys = {(cell["source"], cell["name"]) for cell in document.get("cells", [])}
        if (document.get("schema_version") != 1 or document.get("window_records") != WINDOW
                or document.get("dataset_root") != str(root)
                or document.get("index_completed_at") != state["full_scan_completed_at"]
                or document.get("inventory_fingerprint") != fingerprint
                or actual_keys != expected_keys):
            raise SystemExit("逐电池核验结果与当前索引不一致，请重新完成全量核验。")
        REPORT.write_text(render_report(document), encoding="utf-8")
        print(f"已从现有逐电池结果重建报告：{REPORT}")
        return

    previous = {}
    if RESULT.is_file():
        try:
            old = json.loads(RESULT.read_text(encoding="utf-8"))
            if (old.get("schema_version") == 1 and old.get("window_records") == WINDOW
                    and old.get("dataset_root") == str(root)):
                previous = {(cell["source"], cell["name"]): cell for cell in old["cells"]}
        except (OSError, ValueError, KeyError, TypeError):
            pass
    started = time.monotonic()
    cells = []
    reused = 0
    for index, row in enumerate(rows, 1):
        path = resolve_cell_path(root, row["source"], row["name"])
        stat = path.stat()
        if stat.st_size != row["size_bytes"] or stat.st_mtime_ns != row["mtime_ns"]:
            raise SystemExit(f"文件与索引不一致：{row['source']}/{row['name']}")
        cached = previous.get((row["source"], row["name"]))
        if cached and cached.get("size_bytes") == stat.st_size and cached.get("mtime_ns") == stat.st_mtime_ns:
            inspected = {key: value for key, value in cached.items()
                         if key not in {"source", "name", "size_bytes", "mtime_ns", "label_value"}}
            reused += 1
        else:
            data = load_cell(path)
            inspected = inspect_data(data)
            del data
        if inspected["cycle_count"] != row["cycle_count"]:
            raise SystemExit(f"详细记录数与索引不一致：{row['source']}/{row['name']}")
        cells.append({"source": row["source"], "name": row["name"],
                      "size_bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns,
                      "label_value": row["label_value"], **inspected})
        if index % 50 == 0 or index == len(rows):
            print(f"已核对 {index}/{len(rows)} 块；复用 {reused} 块；用时 {time.monotonic() - started:.1f} 秒。", flush=True)
        if index % 25 == 0:
            gc.collect()
    if inventory_fingerprint(root) != fingerprint:
        raise SystemExit("核查期间原始文件清单发生变化，本次结果未写入。")
    now = datetime.now(timezone.utc)
    document = {
        "schema_version": 1, "window_records": WINDOW,
        "generated_at": now.isoformat(),
        "generated_at_local": now.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "index_completed_at": state["full_scan_completed_at"],
        "dataset_root": str(root), "inventory_fingerprint": fingerprint,
        "summary": summarize(cells, WINDOW), "cells": cells,
    }
    if args.no_write:
        print(json.dumps(document["summary"], ensure_ascii=False, indent=2))
        return
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(render_report(document), encoding="utf-8")
    print(f"完整性结果：{RESULT}\n汇总报告：{REPORT}")


if __name__ == "__main__":
    main()
