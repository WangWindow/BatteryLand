"""Audit indexed BatteryLife labels and protocol metadata without reading source pickle files."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

from .build_catalog import inventory_fingerprint
from .quality_labels import FLAG_LABELS


OUTPUT = Path(os.environ.get("BATTERYLAND_DATA_LAYER_CACHE_DIR", PROJECT / "data"))
INDEX = OUTPUT / "catalog.sqlite3"
RESULT = OUTPUT / "quality_flags.json"
REPORT = OUTPUT / "DATA_QUALITY_AUDIT.md"
CONTROL_FIELDS = {
    "rate_in_C": "倍率",
    "current_in_A": "电流",
    "voltage_in_V": "电压",
    "power_in_W": "功率",
}
def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def inspect_protocol(value, direction, flags):
    result = {
        "stage_count": 0,
        "stages_with_numeric_control": 0,
        "control_kinds": [],
        "stages_without_numeric_control": [],
        "soc_outside_0_1": [],
    }
    if value is None or value == []:
        flags.append(f"{direction}_protocol_missing")
        return result
    if not isinstance(value, list) or any(not isinstance(stage, dict) for stage in value):
        flags.append(f"{direction}_protocol_invalid_shape")
        return result

    result["stage_count"] = len(value)
    controls = set()
    for index, stage in enumerate(value):
        stage_controls = {field for field in CONTROL_FIELDS if finite_number(stage.get(field))}
        controls.update(stage_controls)
        if stage_controls:
            result["stages_with_numeric_control"] += 1
        else:
            result["stages_without_numeric_control"].append(index)
        for field in ("start_soc", "end_soc"):
            soc = stage.get(field)
            if finite_number(soc) and not 0 <= soc <= 1:
                result["soc_outside_0_1"].append({"stage_index": index, "field": field, "value": soc})
    result["control_kinds"] = sorted(controls)
    if result["stages_without_numeric_control"]:
        flags.append(f"{direction}_protocol_stage_without_numeric_control")
    if result["soc_outside_0_1"]:
        flags.append(f"{direction}_protocol_soc_outside_0_1")
    return result


def inspect_cell(row):
    metadata = json.loads(row["metadata_json"])
    flags = []
    label = row["label_value"]
    if label is None:
        flags.append("label_missing")
    elif label <= 0 or not label.is_integer():
        flags.append("label_invalid_number")
    if label is not None and row["max_cycle"] is not None and label > row["max_cycle"]:
        flags.append("label_outside_detailed_cycles")

    interval = metadata.get("SOC_interval")
    if (
        not isinstance(interval, list)
        or len(interval) != 2
        or not all(finite_number(value) for value in interval)
        or not (0 <= interval[0] < interval[1] <= 1)
    ):
        flags.append("cell_soc_interval_invalid")

    protocol = {
        "charge": inspect_protocol(metadata.get("charge_protocol"), "charge", flags),
        "discharge": inspect_protocol(metadata.get("discharge_protocol"), "discharge", flags),
    }
    return {
        "source": row["source"],
        "name": row["name"],
        "label_file": row["label_file"],
        "label_value": label,
        "cycle_count": row["cycle_count"],
        "max_detailed_cycle": row["max_cycle"],
        "soc_interval": interval,
        "protocol": protocol,
        "flags": flags,
    }


def render_report(document):
    cells = document["cells"]
    grouped = defaultdict(list)
    for cell in cells:
        grouped[cell["source"]].append(cell)
    counts = Counter(flag for cell in cells for flag in cell["flags"])
    needs_protocol_review = lambda cell: any(flag.startswith(("charge_protocol_", "discharge_protocol_", "cell_soc_interval_")) for flag in cell["flags"])

    lines = [
        "# BatteryLife 数据质量核验：标签与协议", "",
        f"生成时间：{document['generated_at_local']}。索引完成时间：{document['index_completed_at']}。", "",
        f"本报告从当前项目的 SQLite 目录索引计算；电池数据文件与标签 JSON 只读。索引含 {document['index_counts']['physical_files']} 个磁盘文件、"
        f"{document['index_counts']['verified_duplicates']} 个已证实重复副本、{document['index_counts']['parse_errors']} 个解析错误。"
        "下文计数单位为去重且成功解析的电池记录。",
        "标记表示需要核对的记录或可观察到的范围差异，**不自动断定数据错误，也不自动排除样本**。全部逐电池结果见 `data/quality_flags.json`。", "",
        "## 核验结果", "",
        f"- 去重后电池：**{len(cells)}**；有数值标签：**{len(cells) - counts['label_missing']}**；无数值标签：**{counts['label_missing']}**。",
        f"- 标签编号超出详细记录最大 cycle：**{counts['label_outside_detailed_cycles']}**。这不说明标签是否实测或外推。",
        f"- 标签不是正整数：**{counts['label_invalid_number']}**；电池层 SOC 区间格式或范围待核对：**{counts['cell_soc_interval_invalid']}**。",
        f"- 充电／放电协议为空：**{counts['charge_protocol_missing']}／{counts['discharge_protocol_missing']}** 块；至少一个协议阶段没有数值控制项：**{counts['charge_protocol_stage_without_numeric_control']}／{counts['discharge_protocol_stage_without_numeric_control']}** 块。",
        f"- 协议阶段 SOC 数值超出 0–1：充电 **{counts['charge_protocol_soc_outside_0_1']}** 块，放电 **{counts['discharge_protocol_soc_outside_0_1']}** 块；需先核对是否采用百分数表示。", "",
        f"- 合并上述协议标记后，至少有一项需要核对的电池：**{sum(needs_protocol_review(cell) for cell in cells)}** 块。", "",
        "| 来源 | 电池 | 有标签 | 标签超出详细曲线 | 充电可读控制项 | 放电可读控制项 | 协议待核对 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for source, group in sorted(grouped.items()):
        count = lambda flag: sum(flag in cell["flags"] for cell in group)
        charge = sum(bool(cell["protocol"]["charge"]["control_kinds"]) for cell in group)
        discharge = sum(bool(cell["protocol"]["discharge"]["control_kinds"]) for cell in group)
        review = sum(needs_protocol_review(cell) for cell in group)
        lines.append(
            f"| {source} | {len(group)} | {len(group) - count('label_missing')} | "
            f"{count('label_outside_detailed_cycles')} | {charge} | {discharge} | {review} |"
        )

    lines += [
        "", "“可读控制项”只表示至少一个阶段的倍率、电流、电压或功率字段是有限数值；不代表各来源协议可直接比较。"
        "“协议待核对”按电池去重，包含空协议、结构不合预期、阶段无数值控制项或 SOC 数值超出 0–1。", "",
        "## 协议字段的表达方式", "",
        "以下按电池计数。同一块多阶段电池可同时出现在多个控制项中，列之间不能相加。", "",
        "| 来源 | 充电倍率 | 充电电流 | 充电电压 | 放电倍率 | 放电电流 | 放电电压 | 多阶段充电 | 多阶段放电 |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for source, group in sorted(grouped.items()):
        def kind(direction, field):
            return sum(field in cell["protocol"][direction]["control_kinds"] for cell in group)
        multi_charge = sum(cell["protocol"]["charge"]["stage_count"] > 1 for cell in group)
        multi_discharge = sum(cell["protocol"]["discharge"]["stage_count"] > 1 for cell in group)
        lines.append(
            f"| {source} | {kind('charge', 'rate_in_C')} | {kind('charge', 'current_in_A')} | "
            f"{kind('charge', 'voltage_in_V')} | {kind('discharge', 'rate_in_C')} | "
            f"{kind('discharge', 'current_in_A')} | {kind('discharge', 'voltage_in_V')} | "
            f"{multi_charge} | {multi_discharge} |"
        )

    lines += ["", "## 标签文件与生成依据", "",
              "下表中的文件名来自当前目录索引，表示编号匹配，不证明 JSON 中每个数值的生成方式。", "",
              "| 来源 | 匹配到的标签文件 |", "| --- | --- |"]
    for source, group in sorted(grouped.items()):
        files = sorted({cell["label_file"] for cell in group if cell["label_file"]})
        lines.append(f"| {source} | {', '.join(f'`{name}`' for name in files) or '无'} |")

    lines += [
        "", "仓库提供的 `process_scripts/Extract_life_labels.py` 对非 CALB 分支定义了 80% SOH："
        "末次 SOH 在 80% 至 82.5% 之间时，用最后 20 个 cycle 拟合并推算 80% 交点；末次不高于 80% 时，取首次达到阈值的记录位置；末次不低于 82.5% 的电池被跳过。"
        "RWTH 和部分 SNL 文件还使用脚本中的标称容量特例。该脚本当前把 `dataset_name` 设为 `ISU_ILCC`；要处理其他来源需另行配置。", "",
        "同一脚本的 CALB 分支使用另一份容量 CSV 和 90% SOH：有阈值交点时取首次交点；未达到 90% 但最低 SOH 低于 92.5% 时，用容量数据作线性推算。"
        "该容量 CSV 当前不在本地 BatteryLife 数据目录或仓库中，因此不能在此复算 CALB 的逐电池标签。", "",
        "脚本中的首次交点以处理后记录的位置编号计数，不能未经核对就等同于原始文件中的任意 cycle 编号。"
        "现有标签 JSON 没有逐电池保存“首次交点／线性推算／其他生成方式”，也没有记录脚本版本或运行日志。"
        "仓库中的脚本说明了可能的计算规则，不能据此证明每个现有 JSON 数值确实由该脚本生成。"
        "页面和后续实验必须保留这项不确定性。", "",
        "## 需要人工核对的记录", "",
    ]
    for flag, label in FLAG_LABELS.items():
        if not counts[flag]:
            continue
        examples = [f"`{cell['source']}/{cell['name']}`" for cell in cells if flag in cell["flags"]][:5]
        lines.append(f"- **{label}：{counts[flag]} 块。**例如：{'、'.join(examples)}。")

    lines += [
        "", "MATR 中部分充电阶段的 `start_soc` 或 `end_soc` 为 `80`，而其他记录通常使用 0–1。"
        "这提示单位或编码方式可能不同；在得到来源说明前，不将 `80` 静默改为 `0.8`。"
        "Tongji 与部分 CALB 协议阶段没有可读的数值倍率、电流、电压或功率；保留原始结构，不据文件名补写协议。", "",
        "## 下一步使用条件", "",
        "做跨来源工况图前，先取得各来源协议定义和单位，确认多阶段规则以及 MATR 的 SOC 写法。"
        "做统一 EOL 实验前，先明确目标阈值、标签生成过程和无法复核的样本处置；需要 CALB 外部容量记录或正式来源说明。"
        "本报告的标记可作为筛选线索，尚不是训练集准入规则。", "",
    ]
    return "\n".join(lines)


def main():
    if not INDEX.is_file():
        raise SystemExit("目录索引不存在，请先运行 python scripts/build_catalog.py")
    with sqlite3.connect(INDEX.as_uri() + "?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        state = {row["key"]: row["value"] for row in connection.execute("SELECT key, value FROM catalog_state")}
        if not state.get("full_scan_completed_at"):
            raise SystemExit("目录索引尚未完成全量扫描。")
        root = Path(state["dataset_root"])
        if not root.is_dir() or inventory_fingerprint(root) != state.get("inventory_fingerprint"):
            raise SystemExit("原始数据文件清单已变化，请先重新建立目录索引。")
        index_counts = dict(connection.execute("""
            SELECT COUNT(*) AS physical_files,
                   SUM(CASE WHEN duplicate_of_source IS NOT NULL THEN 1 ELSE 0 END) AS verified_duplicates,
                   SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS parse_errors
            FROM cells
        """).fetchone())
        rows = connection.execute(
            "SELECT * FROM cells WHERE duplicate_of_source IS NULL AND error IS NULL ORDER BY source, name"
        ).fetchall()
        cells = [inspect_cell(row) for row in rows]

    now = datetime.now(timezone.utc)
    document = {
        "schema_version": 1,
        "generated_at": now.isoformat(),
        "generated_at_local": now.astimezone().strftime("%Y-%m-%d %H:%M %Z"),
        "index_completed_at": state["full_scan_completed_at"],
        "dataset_root": str(root),
        "inventory_fingerprint": state["inventory_fingerprint"],
        "index_counts": index_counts,
        "cells": cells,
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT.write_text(render_report(document), encoding="utf-8")
    print(f"Audited {len(cells)} unique cells. Report: {REPORT}")
    print(f"Per-cell flags: {RESULT}")


if __name__ == "__main__":
    main()
