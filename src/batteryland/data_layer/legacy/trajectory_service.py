"""Resumable, read-only-source capacity trajectories for the overview page."""

from __future__ import annotations

import json
import math
import sqlite3
import threading
from contextlib import closing, contextmanager
from pathlib import Path

from .catalog_service import read_overview


MAX_POINTS = 600
CACHE_VERSION = "1"


def _thin_segment(segment, budget):
    if len(segment) <= budget:
        return segment
    if budget <= 2:
        return [segment[0], segment[-1]]
    if budget == 3:
        return [segment[0], segment[len(segment) // 2], segment[-1]]
    buckets = (budget - 2) // 2
    result = [segment[0]]
    for bucket in range(buckets):
        start = 1 + (bucket * (len(segment) - 2)) // buckets
        end = 1 + ((bucket + 1) * (len(segment) - 2)) // buckets
        part = segment[start:end]
        low = min(range(len(part)), key=lambda i: part[i][1])
        high = max(range(len(part)), key=lambda i: part[i][1])
        for index in sorted({low, high}):
            result.append(part[index])
    result.append(segment[-1])
    return result


def trajectory_points(summary):
    """Return sampled relative discharge capacity, preserving missing-cycle gaps."""
    baseline = summary.get("first_discharge_ah")
    if not isinstance(baseline, (int, float)) or not math.isfinite(baseline) or baseline <= 0:
        return None, "缺少有效的首个放电容量"
    segments, segment = [], []
    for row in summary["cycles"]:
        cycle, capacity = row[:2]
        valid = (isinstance(cycle, (int, float)) and math.isfinite(cycle) and
                 isinstance(capacity, (int, float)) and math.isfinite(capacity) and capacity >= 0)
        if valid:
            segment.append([int(cycle), round(capacity / baseline * 100, 4)])
        elif segment:
            segments.append(segment)
            segment = []
    if segment:
        segments.append(segment)
    valid_count = sum(map(len, segments))
    if valid_count < 2:
        return None, "有效放电容量点少于两个"
    separators = max(0, len(segments) - 1)
    available = max(2, MAX_POINTS - separators)
    if sum(min(2, len(part)) for part in segments) > available:
        return None, "容量记录断点过多，无法在展示上限内保留全部记录段"
    if valid_count > available:
        minimum = [min(2, len(part)) for part in segments]
        extra = max(0, available - sum(minimum))
        remaining = [len(part) - floor for part, floor in zip(segments, minimum)]
        total_remaining = sum(remaining)
        budgets = [floor + (extra * rest // total_remaining if total_remaining else 0)
                   for floor, rest in zip(minimum, remaining)]
        while sum(budgets) < available:
            candidate = max((i for i in range(len(segments)) if budgets[i] < len(segments[i])),
                            key=lambda i: len(segments[i]) - budgets[i], default=None)
            if candidate is None:
                break
            budgets[candidate] += 1
        segments = [_thin_segment(part, budget) for part, budget in zip(segments, budgets)]
    points = []
    for part in segments:
        if points:
            points.append(None)
        points.extend(part)
    return points, None


class TrajectoryCache:
    def __init__(self, dataset, index_path: Path, cache_path: Path):
        self.dataset = dataset
        self.index_path = index_path
        self.cache_path = cache_path
        self.lock = threading.RLock()
        self.initialized = False
        self.message = ""
        self.revision = ""
        self.entries = []
        self.running = False
        self.next_seq = 0

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.cache_path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self):
        if self.initialized:
            return
        overview = read_overview(self.index_path, self.dataset.root)
        if not overview["ready"] or overview.get("needs_refresh"):
            self.message = (overview.get("message") or
                            "目录已变化，请联系管理员刷新目录索引，再查看退化轨迹。")
            return
        self.revision = overview["inventory_fingerprint"]
        with closing(sqlite3.connect(self.index_path.as_uri() + "?mode=ro", uri=True)) as index:
            signatures = {(row[0], row[1]): (row[2], row[3]) for row in index.execute(
                "SELECT source,name,size_bytes,mtime_ns FROM cells "
                "WHERE duplicate_of_source IS NULL AND error IS NULL")}
        self.entries = [(cell["source"], cell["name"], *signatures[(cell["source"], cell["name"])])
                        for cell in overview["cells"]]
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            connection.execute("""CREATE TABLE IF NOT EXISTS trajectories (
                source TEXT NOT NULL,name TEXT NOT NULL,size_bytes INTEGER NOT NULL,mtime_ns INTEGER NOT NULL,
                status TEXT NOT NULL,reason TEXT,points_json TEXT,seq INTEGER NOT NULL,
                PRIMARY KEY(source,name))""")
            meta = dict(connection.execute("SELECT key,value FROM meta"))
            if meta.get("version") != CACHE_VERSION or meta.get("root") != str(self.dataset.root):
                connection.execute("DELETE FROM trajectories")
            connection.execute("INSERT OR REPLACE INTO meta VALUES ('version',?)", (CACHE_VERSION,))
            connection.execute("INSERT OR REPLACE INTO meta VALUES ('root',?)", (str(self.dataset.root),))
            valid = {(source, name): (size, mtime) for source, name, size, mtime in self.entries}
            for row in connection.execute("SELECT source,name,size_bytes,mtime_ns FROM trajectories").fetchall():
                if valid.get((row["source"], row["name"])) != (row["size_bytes"], row["mtime_ns"]):
                    connection.execute("DELETE FROM trajectories WHERE source=? AND name=?",
                                       (row["source"], row["name"]))
            self.next_seq = connection.execute("SELECT COALESCE(MAX(seq),0) FROM trajectories").fetchone()[0]
        self.initialized = True

    def _build(self, pending):
        try:
            for source, name, size, mtime in pending:
                try:
                    points, reason = trajectory_points(self.dataset.summary(source, name))
                    status = "drawable" if points else "skipped"
                except Exception as exc:
                    points, reason, status = None, f"读取失败：{type(exc).__name__}: {exc}", "failed"
                with self.lock:
                    self.next_seq += 1
                    with self._connect() as connection:
                        connection.execute("""INSERT OR REPLACE INTO trajectories
                            (source,name,size_bytes,mtime_ns,status,reason,points_json,seq)
                            VALUES (?,?,?,?,?,?,?,?)""", (source, name, size, mtime, status, reason,
                                               json.dumps(points, separators=(",", ":")) if points else None,
                                               self.next_seq))
        finally:
            with self.lock:
                self.running = False

    def page(self, after: int):
        if after < 0:
            raise ValueError("轨迹游标必须是非负整数")
        with self.lock:
            self._initialize()
            if not self.initialized:
                return {"ready": False, "message": self.message}
            with self._connect() as connection:
                done = {(row["source"], row["name"]) for row in connection.execute(
                    "SELECT source,name FROM trajectories")}
                pending = [entry for entry in self.entries if entry[:2] not in done]
                if pending and not self.running:
                    self.running = True
                    threading.Thread(target=self._build, args=(pending,), daemon=True,
                                     name="trajectory-cache").start()
                counts = {row["status"]: row["count"] for row in connection.execute(
                    "SELECT status,COUNT(*) count FROM trajectories GROUP BY status")}
                rows = connection.execute("SELECT source,name,status,reason,points_json,seq "
                                          "FROM trajectories WHERE seq>? ORDER BY seq LIMIT 50", (after,)).fetchall()
                more = bool(rows) and connection.execute("SELECT 1 FROM trajectories WHERE seq>? LIMIT 1",
                                                         (rows[-1]["seq"],)).fetchone() is not None
            items = [{"source": row["source"], "name": row["name"], "status": row["status"],
                      "reason": row["reason"],
                      "points": json.loads(row["points_json"]) if row["points_json"] else None}
                     for row in rows]
            return {"ready": True, "revision": self.revision, "total": len(self.entries),
                    "processed": sum(counts.values()), "drawable": counts.get("drawable", 0),
                    "skipped": counts.get("skipped", 0), "failed": counts.get("failed", 0),
                    "running": self.running, "next": rows[-1]["seq"] if rows else after,
                    "more": more, "items": items}
