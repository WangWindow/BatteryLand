"""Build an incremental, read-only inventory of trusted BatteryLife files.

The source dataset is never changed. The SQLite index and report are written only
inside this Web project. Run this only on trusted .pkl/.pkl.xz files: pickle is executable.
"""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))
from ..battery_storage import cell_files, load_cell, logical_name, resolve_cell_path

DEFAULT_DATASET = PROJECT.parent.parent / "BatteryLife-main" / "dataset"
DEFAULT_DB = PROJECT / "data" / "catalog.sqlite3"
DEFAULT_REPORT = PROJECT / "docs" / "FULL_DATA_AUDIT.md"
METADATA_FIELDS = (
    "cell_id", "reference", "description", "form_factor", "cathode_material",
    "anode_material", "electrolyte_material", "nominal_capacity_in_Ah",
    "charge_protocol", "discharge_protocol", "SOC_interval",
    "depth_of_charge", "depth_of_discharge", "already_spent_cycles",
    "min_voltage_limit_in_V", "max_voltage_limit_in_V",
    "min_current_limit_in_A", "max_current_limit_in_A",
)
OVERVIEW_FIELDS = (
    "form_factor", "cathode_material", "anode_material",
    "nominal_capacity_in_Ah", "charge_protocol", "discharge_protocol", "SOC_interval",
)
SKIP_DIRECTORIES = {"Life labels", "seen_unseen_labels"}


def json_value(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if hasattr(value, "item"):
        try:
            return json_value(value.item())
        except (ValueError, TypeError):
            pass
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value[:1000]]
    if hasattr(value, "tolist"):
        return json_value(value.tolist())
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    return str(value)


def cycle_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if math.isfinite(number) and number.is_integer() else None


def load_labels(root):
    labels = {}
    conflicts = []
    for path in sorted((root / "Life labels").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for key, value in data.items():
            if key in labels and labels[key][0] != value:
                conflicts.append((key, labels[key][1], path.name))
            labels[key] = (value, path.name)
    return labels, conflicts


def label_for(source, name, labels):
    candidate = re.sub(r"--(\d+)\.pkl$", r"-#\1.pkl", name) if source == "Tongji" else name
    key = name if name in labels else candidate
    if key not in labels:
        return None, None, None
    value, label_file = labels[key]
    try:
        value = float(value)
        if not math.isfinite(value):
            value = None
    except (TypeError, ValueError):
        value = None
    return value, label_file, key


def inspect_pickle(path):
    data = load_cell(path)
    if not isinstance(data, dict) or not isinstance(data.get("cycle_data"), list):
        raise ValueError("Expected a dictionary with cycle_data list")
    cycles = data["cycle_data"]
    numbers = [cycle_number(item.get("cycle_number")) if isinstance(item, dict) else None for item in cycles]
    valid = [number for number in numbers if number is not None]
    result = {
        "metadata_json": json.dumps(
            {field: json_value(data.get(field)) for field in METADATA_FIELDS},
            ensure_ascii=False, allow_nan=False,
        ),
        "top_level_keys_json": json.dumps(sorted(str(key) for key in data), ensure_ascii=False),
        "cycle_count": len(cycles),
        "first_cycle": numbers[0] if numbers else None,
        "last_cycle": numbers[-1] if numbers else None,
        "min_cycle": min(valid) if valid else None,
        "max_cycle": max(valid) if valid else None,
        "invalid_cycle_numbers": len(numbers) - len(valid),
        "repeated_cycle_numbers": len(valid) - len(set(valid)),
        "non_increasing_steps": sum(b <= a for a, b in zip(valid, valid[1:])),
    }
    del data, cycles, numbers, valid
    gc.collect()
    return result


def same_bytes(first, second):
    if first.stat().st_size != second.stat().st_size:
        return False
    with first.open("rb") as left, second.open("rb") as right:
        while True:
            a, b = left.read(1024 * 1024), right.read(1024 * 1024)
            if a != b:
                return False
            if not a:
                return True


def initialize_database(connection):
    connection.execute("""
        CREATE TABLE IF NOT EXISTS cells (
            source TEXT NOT NULL,
            name TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            mtime_ns INTEGER NOT NULL,
            label_value REAL,
            label_file TEXT,
            label_key TEXT,
            metadata_json TEXT,
            top_level_keys_json TEXT,
            cycle_count INTEGER,
            first_cycle INTEGER,
            last_cycle INTEGER,
            min_cycle INTEGER,
            max_cycle INTEGER,
            invalid_cycle_numbers INTEGER,
            repeated_cycle_numbers INTEGER,
            non_increasing_steps INTEGER,
            duplicate_of_source TEXT,
            duplicate_of_name TEXT,
            error TEXT,
            indexed_at TEXT NOT NULL,
            PRIMARY KEY (source, name)
        )
    """)
    connection.execute("CREATE INDEX IF NOT EXISTS cells_source ON cells(source)")
    connection.execute("CREATE TABLE IF NOT EXISTS catalog_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    connection.commit()


def indexed_files(root, sources):
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or folder.name in SKIP_DIRECTORIES:
            continue
        if sources and folder.name not in sources:
            continue
        for path in cell_files(folder):
            yield folder.name, path


def inventory_fingerprint(root):
    digest = hashlib.sha256()
    for source, path in indexed_files(root, None):
        stat = path.stat()
        digest.update(f"{source}/{path.name}\0{stat.st_size}\0{stat.st_mtime_ns}\n".encode("utf-8"))
    for path in sorted((root / "Life labels").glob("*.json")):
        stat = path.stat()
        digest.update(f"Life labels/{path.name}\0{stat.st_size}\0{stat.st_mtime_ns}\n".encode("utf-8"))
    return digest.hexdigest()


def update_index(connection, root, labels, sources=None, limit=None):
    paths = list(indexed_files(root, sources))
    if limit is not None:
        paths = paths[:limit]
    existing = {
        (row["source"], row["name"]): row
        for row in connection.execute("SELECT * FROM cells")
    }
    previous_state = dict(connection.execute("SELECT key, value FROM catalog_state"))
    seen = set()
    reused = failed = 0
    started = time.monotonic()
    for position, (source, path) in enumerate(paths, 1):
        name = logical_name(path)
        key = (source, name)
        seen.add(key)
        stat = path.stat()
        label, label_file, label_key = label_for(source, name, labels)
        previous = existing.get(key)
        unchanged = (
            previous is not None and previous["size_bytes"] == stat.st_size
            and previous["mtime_ns"] == stat.st_mtime_ns
            and previous["metadata_json"] is not None and previous["error"] is None
        )
        if unchanged:
            reused += 1
            connection.execute(
                "UPDATE cells SET label_value=?, label_file=?, label_key=? WHERE source=? AND name=?",
                (label, label_file, label_key, source, name),
            )
        else:
            error = None
            details = {}
            try:
                details = inspect_pickle(path)
            except Exception as exc:
                failed += 1
                error = f"{type(exc).__name__}: {exc}"
            connection.execute("""
                INSERT INTO cells (
                    source, name, size_bytes, mtime_ns, label_value, label_file,
                    label_key, metadata_json, top_level_keys_json, cycle_count,
                    first_cycle, last_cycle, min_cycle, max_cycle,
                    invalid_cycle_numbers, repeated_cycle_numbers,
                    non_increasing_steps, duplicate_of_source, duplicate_of_name,
                    error, indexed_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(source, name) DO UPDATE SET
                    size_bytes=excluded.size_bytes, mtime_ns=excluded.mtime_ns,
                    label_value=excluded.label_value, label_file=excluded.label_file,
                    label_key=excluded.label_key, metadata_json=excluded.metadata_json,
                    top_level_keys_json=excluded.top_level_keys_json,
                    cycle_count=excluded.cycle_count, first_cycle=excluded.first_cycle,
                    last_cycle=excluded.last_cycle, min_cycle=excluded.min_cycle,
                    max_cycle=excluded.max_cycle,
                    invalid_cycle_numbers=excluded.invalid_cycle_numbers,
                    repeated_cycle_numbers=excluded.repeated_cycle_numbers,
                    non_increasing_steps=excluded.non_increasing_steps,
                    duplicate_of_source=NULL, duplicate_of_name=NULL,
                    error=excluded.error, indexed_at=excluded.indexed_at
            """, (
                source, name, stat.st_size, stat.st_mtime_ns,
                label, label_file, label_key,
                details.get("metadata_json"), details.get("top_level_keys_json"),
                details.get("cycle_count"), details.get("first_cycle"),
                details.get("last_cycle"), details.get("min_cycle"),
                details.get("max_cycle"), details.get("invalid_cycle_numbers"),
                details.get("repeated_cycle_numbers"), details.get("non_increasing_steps"),
                None, None, error, datetime.now(timezone.utc).isoformat(),
            ))
        connection.commit()
        if position % 25 == 0 or position == len(paths):
            elapsed = time.monotonic() - started
            print(f"Indexed {position}/{len(paths)} files in {elapsed:.0f}s (reused {reused}, errors {failed})", flush=True)

    full_scan = not sources and limit is None
    if full_scan:
        for source, name in set(existing) - seen:
            connection.execute("DELETE FROM cells WHERE source=? AND name=?", (source, name))
        connection.execute("UPDATE cells SET duplicate_of_source=NULL, duplicate_of_name=NULL")
        duplicate_count = 0
        for source in ("MICH", "MICH_EXP"):
            for original in cell_files(root / source):
                name = logical_name(original)
                try:
                    aggregate = resolve_cell_path(root, "total_MICH", name)
                except FileNotFoundError:
                    continue
                if same_bytes(original, aggregate):
                    connection.execute("""
                        UPDATE cells SET duplicate_of_source=?, duplicate_of_name=?
                        WHERE source='total_MICH' AND name=?
                    """, (source, name, name))
                    duplicate_count += 1
        connection.commit()
        fingerprint = inventory_fingerprint(root)
        same_snapshot = (
            reused == len(paths)
            and len(seen) == len(existing)
            and previous_state.get("dataset_root") == str(root)
            and previous_state.get("inventory_fingerprint") == fingerprint
            and bool(previous_state.get("full_scan_completed_at"))
        )
        completed_at = (previous_state["full_scan_completed_at"] if same_snapshot
                        else datetime.now(timezone.utc).isoformat())
        for state_key, value in (
            ("full_scan_completed_at", completed_at),
            ("dataset_root", str(root)),
            ("file_count", str(len(seen))),
            ("inventory_fingerprint", fingerprint),
        ):
            connection.execute("""
                INSERT INTO catalog_state(key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value
            """, (state_key, value))
        connection.commit()
        print(f"Verified byte-identical aggregate copies: {duplicate_count}", flush=True)
    return full_scan


def is_present(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip()) and value.strip() not in {"-", "—", "–"}
    if isinstance(value, list):
        return bool(value)
    return True


def render_report(connection, root, label_conflicts):
    rows = list(connection.execute("SELECT * FROM cells ORDER BY source, name"))
    count = len(rows)
    duplicates = sum(row["duplicate_of_source"] is not None for row in rows)
    labels = sum(row["label_value"] is not None for row in rows)
    unique_labels = sum(row["label_value"] is not None and row["duplicate_of_source"] is None for row in rows)
    errors = [row for row in rows if row["error"]]
    out_of_range = [row for row in rows if row["label_value"] is not None and row["max_cycle"] is not None and row["label_value"] > row["max_cycle"]]
    unique_out_of_range = sum(row["duplicate_of_source"] is None for row in out_of_range)
    invalid_numbers = [row for row in rows if (row["invalid_cycle_numbers"] or 0) > 0]
    repeated_numbers = [row for row in rows if (row["repeated_cycle_numbers"] or 0) > 0]
    non_increasing = [row for row in rows if (row["non_increasing_steps"] or 0) > 0]
    field_counts = Counter()
    field_values = defaultdict(Counter)
    by_source = defaultdict(list)
    for row in rows:
        by_source[row["source"]].append(row)
        if row["duplicate_of_source"] is not None or not row["metadata_json"]:
            continue
        metadata = json.loads(row["metadata_json"])
        for field in OVERVIEW_FIELDS:
            value = metadata.get(field)
            if is_present(value):
                field_counts[field] += 1
                if field in {"form_factor", "cathode_material", "anode_material", "nominal_capacity_in_Ah"}:
                    displayed = f"{value:.12g}" if field == "nominal_capacity_in_Ah" and isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
                    field_values[field][displayed] += 1
    unique_count = count - duplicates
    lines = [
        "# 全量数据目录审计", "",
        f"生成时间：{datetime.now().astimezone().strftime('%Y-%m-%d %H:%M %Z')}。",
        f"来源目录：`{root}`。此报告由 `scripts/build_catalog.py` 对可信本地电池文件（`.pkl` 或 `.pkl.xz`）逐个读取后生成；源目录未被写入。", "",
        "## 总览", "",
        f"- 磁盘电池文件：**{count}**；已证实重复收录：**{duplicates}**；扣除该批重复后的记录：**{unique_count}**。",
        f"- 匹配标签的文件：**{labels}**；扣除已证实重复后的匹配标签记录：**{unique_labels}**。标签匹配不代表标签为实测值。",
        f"- 解析错误：**{len(errors)}**；标签编号大于详细记录最大 cycle 编号：**{len(out_of_range)}** 个文件，扣除已证实重复后为 **{unique_out_of_range}** 块电池。该比较只能说明详细曲线覆盖范围，不能判定标签是否外推。", "",
        f"- cycle 编号缺失或无效的文件：**{len(invalid_numbers)}**；编号重复：**{len(repeated_numbers)}**；编号未严格递增：**{len(non_increasing)}**。", "",
        "| 来源 | 文件 | 标签匹配 | 已证实重复 | 解析错误 | 标签超出详细记录 |", "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for source, group in sorted(by_source.items()):
        outside = sum(row in out_of_range for row in group)
        lines.append(
            f"| {source} | {len(group)} | {sum(row['label_value'] is not None for row in group)} | "
            f"{sum(row['duplicate_of_source'] is not None for row in group)} | "
            f"{sum(bool(row['error']) for row in group)} | {outside} |"
        )
    denominator = unique_count - len([row for row in errors if row["duplicate_of_source"] is None])
    lines += ["", "## 可用于分类的字段", "",
              "以下完整率的分母是成功解析且扣除已证实重复后的记录；空白和单独的横线按缺失计算。", "",
              "| 字段 | 有值 | 完整率 |", "| --- | ---: | ---: |"]
    for field in OVERVIEW_FIELDS:
        complete = field_counts[field]
        lines.append(f"| `{field}` | {complete} | {complete / denominator:.1%} |" if denominator else f"| `{field}` | 0 | — |")
    for field in ("form_factor", "cathode_material", "anode_material", "nominal_capacity_in_Ah"):
        lines += ["", f"### `{field}` 原始取值", "", "| 原始值 | 数量 |", "| --- | ---: |"]
        for value, number in field_values[field].most_common():
            escaped_value = value.replace("|", "\\|")
            lines.append(f"| {escaped_value} | {number} |")
    lines += ["", "## 口径说明", "",
              "- 同名标签通过文件名匹配；Tongji 的 `--N.pkl` 按现有处理规则对应标签键 `-#N.pkl`。",
              "- `Life labels/*.json` 只给出寿命数字，未逐电池记录生成脚本版本或“实测／外推”状态。仓库提供的标签提取脚本在非 CALB 分支使用 80% SOH、在 CALB 分支使用另一路容量数据的 90% SOH；现有 JSON 的逐电池生成过程尚未核实，因此不能将全部标签解释为统一 80% EOL。",
              "- `total_MICH` 与 `MICH` / `MICH_EXP` 的同名文件仅在逐字节一致时才标为已证实重复。",
              "- 材料与形态字段在此保留原始写法；分类映射须单独记录，不能覆盖原值。容量数值的报告显示去除了浮点尾数，索引保留原值。", ""]
    if errors:
        lines += ["## 解析错误", ""]
        for row in errors:
            lines.append(f"- `{row['source']}/{row['name']}`：{row['error']}")
        lines.append("")
    if label_conflicts:
        lines += ["## 标签键冲突", ""]
        for key, first, second in label_conflicts:
            lines.append(f"- `{key}`：`{first}` 与 `{second}` 提供不同值。")
        lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Build BatteryLife metadata catalog")
    parser.add_argument("--data", type=Path, default=Path(os.environ.get("BATTERYLIFE_DATASET_ROOT", DEFAULT_DATASET)), help="trusted BatteryLife dataset directory")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--sources", nargs="*", help="optional source names for a partial scan")
    parser.add_argument("--limit", type=int, help="optional file limit for a partial scan")
    args = parser.parse_args()
    root = args.data.resolve()
    if not root.is_dir() or not (root / "Life labels").is_dir():
        parser.error(f"Dataset or Life labels directory not found: {root}")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    args.db.parent.mkdir(parents=True, exist_ok=True)
    labels, conflicts = load_labels(root)
    with sqlite3.connect(args.db) as connection:
        connection.row_factory = sqlite3.Row
        initialize_database(connection)
        full = update_index(connection, root, labels, args.sources, args.limit)
        if full:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(render_report(connection, root, conflicts), encoding="utf-8")
            print(f"Report: {args.report}", flush=True)
    print(f"Catalog: {args.db}", flush=True)


if __name__ == "__main__":
    main()
