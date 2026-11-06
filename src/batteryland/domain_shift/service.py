"""Application service for safe, cached source/target domain analysis."""

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import numpy as np
import pandas as pd

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.db.contracts import Record, UnitOfWorkFactory

from . import analysis, data
from .features import feature_group
from .model_features import ModelFeatureExtractor


def _finite(value: object) -> Any:
    """Convert numpy/pandas values into strict JSON-compatible values."""
    if isinstance(value, dict):
        return {str(key): _finite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class DomainShiftService:
    def __init__(
        self, settings: Settings, units: UnitOfWorkFactory, model_features: ModelFeatureExtractor
    ) -> None:
        self.settings = settings
        self.units = units
        self.model_features = model_features
        self.cache_dir = settings.data_dir / "domain-shift" / "features"
        self._jobs: dict[str, Record] = {}
        self._job_keys: dict[tuple[tuple[str, ...], int, str], str] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="domain-shift")

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _source(self, identity: str) -> Record:
        with self.units() as unit:
            source = unit.resources.get_source(identity)
        if source["availability"] != "available":
            raise DomainError("integration_precondition_failed", "所选数据集当前不可用")
        alias = source["root_alias"]
        root = self.settings.source_roots.get(alias)
        if root is None:
            raise DomainError("integration_precondition_failed", "数据集根目录未配置")
        root = root.resolve()
        prefix = source.get("group_prefix", "")
        folder = (root / prefix).resolve() if prefix else root
        if not folder.is_relative_to(root) or not folder.is_dir():
            raise DomainError("integration_precondition_failed", "数据集目录不存在或越界")
        files = []
        for path in sorted(folder.rglob("*.pkl")):
            try:
                resolved = path.resolve(strict=True)
            except OSError:
                continue
            if resolved.is_relative_to(folder) and resolved.is_file():
                files.append(resolved)
        return source | {"path": folder, "files": files}

    def _datasets(self, identities: list[str]) -> tuple[dict[str, list[Path]], dict[str, str]]:
        datasets: dict[str, list[Path]] = {}
        names: dict[str, str] = {}
        for identity in dict.fromkeys(identities):
            source = self._source(identity)
            datasets[identity] = source["files"]
            names[identity] = source["name"]
        return datasets, names

    def cache_status(
        self, source_ids: list[str], stride: int, model: Record | None = None
    ) -> Record:
        datasets, names = self._datasets(source_ids)
        specification = self.model_features.resolve(model) if model else None
        cache_dir = (
            self.model_features.cache_dir(specification) if specification else self.cache_dir
        )
        status = data.cache_status(datasets, source_ids, stride, cache_dir)
        items: list[Record] = [
            {
                "source_id": source_id,
                "name": names[source_id],
                "cached_files": status[source_id][0],
                "total_files": status[source_id][1],
                "missing_files": status[source_id][1] - status[source_id][0],
            }
            for source_id in source_ids
        ]
        return {
            "items": items,
            "missing_files": sum(int(item["missing_files"]) for item in items),
        }

    def start_build(
        self,
        source_ids: list[str],
        stride: int,
        workers: int,
        model: Record | None = None,
        batch_size: int = 32,
        device: str = "cpu",
    ) -> Record:
        source_ids = list(dict.fromkeys(source_ids))
        datasets, names = self._datasets(source_ids)
        specification = self.model_features.resolve(model) if model else None
        key = (
            tuple(sorted(source_ids)),
            stride,
            specification["cache_key"] if specification else "physical",
        )
        with self._lock:
            existing_id = self._job_keys.get(key)
            if existing_id and self._jobs[existing_id]["state"] in {"queued", "running"}:
                return dict(self._jobs[existing_id])
            identity = str(uuid4())
            now = datetime.now(UTC).isoformat()
            job: Record = {
                "id": identity,
                "state": "queued",
                "source_ids": source_ids,
                "source_names": names,
                "stride": stride,
                "workers": workers,
                "feature_space": "model" if model else "physical",
                "model": model,
                "done": 0,
                "total": 0,
                "current_file": None,
                "built": 0,
                "failed": [],
                "error": None,
                "created_at": now,
                "updated_at": now,
            }
            self._jobs[identity] = job
            self._job_keys[key] = identity
        self._executor.submit(
            self._run_build,
            identity,
            datasets,
            source_ids,
            stride,
            workers,
            specification,
            batch_size,
            device,
        )
        return dict(job)

    def _run_build(
        self,
        identity: str,
        datasets: dict[str, list[Path]],
        source_ids: list[str],
        stride: int,
        workers: int,
        specification: Record | None = None,
        batch_size: int = 32,
        device: str = "cpu",
    ) -> None:
        def update(done: int, total: int, current: str) -> None:
            with self._lock:
                self._jobs[identity].update(
                    done=done,
                    total=total,
                    current_file=current,
                    updated_at=datetime.now(UTC).isoformat(),
                )

        with self._lock:
            self._jobs[identity].update(state="running", updated_at=datetime.now(UTC).isoformat())
        try:
            result = (
                self.model_features.build(
                    specification, datasets, source_ids, stride, batch_size, device, update
                )
                if specification
                else data.build_features(
                    datasets,
                    source_ids,
                    stride,
                    self.cache_dir,
                    workers=workers,
                    progress=update,
                )
            )
            with self._lock:
                self._jobs[identity].update(
                    state="completed" if not result["failed"] else "completed_with_errors",
                    built=result["built"],
                    total=result["total"],
                    done=result["total"],
                    failed=result["failed"],
                    current_file=None,
                    updated_at=datetime.now(UTC).isoformat(),
                )
        except Exception as exc:  # noqa: BLE001 -- report background failures through the job
            with self._lock:
                self._jobs[identity].update(
                    state="failed",
                    error=f"{type(exc).__name__}: {exc}",
                    current_file=None,
                    updated_at=datetime.now(UTC).isoformat(),
                )

    def get_job(self, identity: str) -> Record:
        with self._lock:
            job = self._jobs.get(identity)
            if job is None:
                raise DomainError("not_found", "特征提取任务不存在")
            return dict(job)

    def _prepared(
        self,
        source_ids: list[str],
        target_ids: list[str],
        stride: int,
        max_cycles: int,
        minimum_coverage: float,
        level: str,
        feature_groups: list[str],
        excluded_features: list[str],
        model: Record | None = None,
    ) -> tuple[pd.DataFrame, list[str], pd.DataFrame, dict[str, str], dict[str, int]]:
        selected = list(dict.fromkeys(source_ids + target_ids))
        if set(source_ids) & set(target_ids):
            raise DomainError("invalid_input", "同一数据集不能同时属于源域和目标域")
        datasets, names = self._datasets(selected)
        specification = self.model_features.resolve(model) if model else None
        cache_dir = (
            self.model_features.cache_dir(specification) if specification else self.cache_dir
        )
        status = data.cache_status(datasets, selected, stride, cache_dir)
        missing = sum(total - done for done, total in status.values())
        if missing:
            raise DomainError(
                "integration_precondition_failed",
                f"仍有 {missing} 个电池文件需要提取或重建特征缓存",
                details={"missing_files": missing},
            )
        raw = data.load_features(datasets, selected, stride, cache_dir)
        if raw.empty:
            raise DomainError("integration_precondition_failed", "没有可用的特征缓存")
        raw_counts = raw.groupby("dataset").size().astype(int).to_dict()
        frame = analysis.add_domain(raw, source_ids, target_ids)
        frame = analysis.cap_cycles_per_cell(frame, max_cycles)
        if model:
            # Constant embedding coordinates still belong to the vector geometry and pooling layout.
            features = [column for column in frame.columns if column.startswith("embedding_")]
            dropped = pd.DataFrame(columns=["feature", "reason"])
            absent = set(selected) - set(frame["dataset"])
            if absent:
                raise DomainError(
                    "invalid_input",
                    "以下数据集没有有效模型样本：" + "、".join(names[item] for item in absent),
                )
        else:
            features, dropped = analysis.select_features(
                frame, analysis.comparable_columns(frame), minimum_coverage
            )
        if feature_groups:
            features = [feature for feature in features if feature_group(feature) in feature_groups]
        excluded = set(excluded_features)
        features = [feature for feature in features if feature not in excluded]
        if len(features) < 2:
            raise DomainError("invalid_input", "可用特征少于 2 个，请放宽筛选条件")
        if level == "cell":
            frame = analysis.aggregate_cells(frame, features, "mean" if model else "median")
        return frame, features, dropped, names, raw_counts

    def analyze(self, request: Record) -> Record:
        specification = (
            self.model_features.resolve(request["model"]) if request.get("model") else None
        )
        frame, features, dropped, names, raw_counts = self._prepared(
            request["source_ids"],
            request["target_ids"],
            request["stride"],
            request["max_cycles"],
            request["minimum_coverage"],
            request["level"],
            request["feature_groups"],
            request["excluded_features"],
            request.get("model"),
        )
        summaries = []
        for raw_dataset, group in frame.groupby("dataset", sort=False):
            dataset = str(raw_dataset)
            nominal = group.get("nominal_capacity_Ah", pd.Series(dtype=float)).dropna()
            summaries.append(
                {
                    "source_id": dataset,
                    "name": names[dataset],
                    "domain": group["domain"].iloc[0],
                    "cells": int(group["cell_uid"].nunique()),
                    "samples": len(group),
                    "extracted_cycles": raw_counts.get(dataset, 0),
                    "nominal_capacity_range": (
                        f"{nominal.min():.2f} – {nominal.max():.2f}" if len(nominal) else "未知"
                    ),
                    "temperature_coverage": (
                        float(group["temperature_available"].mean())
                        if "temperature_available" in group
                        else None
                    ),
                }
            )

        if specification:
            return _finite(
                {
                    "summary": {
                        "source_count": len(request["source_ids"]),
                        "target_count": len(request["target_ids"]),
                        "feature_count": len(features),
                        "sample_count": len(frame),
                        "sample_unit": "电池" if request["level"] == "cell" else "窗口",
                    },
                    "representation": {
                        "feature_space": "model",
                        "model": request.get("model"),
                        **{
                            key: specification[key]
                            for key in (
                                "model_type",
                                "checkpoint_name",
                                "weight_sha256",
                                "weight_source",
                                "initialization_seed",
                            )
                        },
                    },
                    "datasets": summaries,
                    "features": [
                        {"name": feature, "group": feature_group(feature)} for feature in features
                    ],
                    "dropped_features": [],
                    "model_analysis": analysis.model_embedding_analysis(
                        frame, features, names, request
                    ),
                    "pca": {"points": [], "explained_variance": [], "loadings": {}},
                    "shift": [],
                    "pairwise": [],
                }
            )

        points = analysis.sample_per_group(
            frame, "dataset", request["points_per_dataset"], request["seed"]
        )
        embedded, variance, loadings = analysis.embed_pca(
            points, features, request["pca_fit"], request["seed"]
        )
        pca_points = []
        for row in embedded[["dataset", "domain", "cell_uid", "PC1", "PC2"]].to_dict(
            orient="records"
        ):
            dataset = str(row["dataset"])
            pca_points.append(
                {
                    "dataset": dataset,
                    "dataset_name": names[dataset],
                    "domain": row["domain"],
                    "cell_uid": row["cell_uid"],
                    "pc1": row["PC1"],
                    "pc2": row["PC2"],
                }
            )
        loading_payload = {}
        for component in loadings.columns:
            top = loadings[component].abs().nlargest(10).index
            loading_payload[component] = [
                {"feature": feature, "loading": loadings.at[feature, component]} for feature in top
            ]

        shift = analysis.domain_shift(frame, features).sort_values("wd_norm", ascending=False)
        pairwise = analysis.pairwise_shift(
            frame, features, request["source_ids"], request["target_ids"]
        )
        pair_summary = []
        if not pairwise.empty:
            grouped = pairwise.groupby(["source", "target"], as_index=False)["wd_norm"].mean()
            pair_summary = [
                {
                    "source_id": row.source,
                    "source_name": names[row.source],
                    "target_id": row.target,
                    "target_name": names[row.target],
                    "mean_distance": row.wd_norm,
                }
                for row in grouped.itertuples()
            ]

        return _finite(
            {
                "summary": {
                    "source_count": len(request["source_ids"]),
                    "target_count": len(request["target_ids"]),
                    "feature_count": len(features),
                    "sample_count": len(frame),
                    "sample_unit": "电池"
                    if request["level"] == "cell"
                    else "窗口"
                    if request.get("model")
                    else "循环",
                },
                "representation": {
                    "feature_space": request.get("feature_space", "physical"),
                    "model": request.get("model"),
                    **(
                        {
                            key: specification[key]
                            for key in (
                                "model_type",
                                "checkpoint_name",
                                "weight_sha256",
                                "weight_source",
                                "initialization_seed",
                            )
                        }
                        if specification
                        else {}
                    ),
                },
                "datasets": summaries,
                "features": [
                    {"name": feature, "group": feature_group(feature)} for feature in features
                ],
                "dropped_features": dropped.to_dict(orient="records"),
                "pca": {
                    "points": pca_points,
                    "explained_variance": variance.tolist(),
                    "loadings": loading_payload,
                },
                "shift": shift.to_dict(orient="records"),
                "pairwise": pair_summary,
            }
        )

    def distribution(self, request: Record) -> Record:
        frame, features, _, names, _ = self._prepared(
            request["source_ids"],
            request["target_ids"],
            request["stride"],
            request["max_cycles"],
            request["minimum_coverage"],
            request["level"],
            request["feature_groups"],
            request["excluded_features"],
            request.get("model"),
        )
        feature = request["feature"]
        if feature not in features:
            raise DomainError("invalid_input", "所选特征当前不可用")
        columns = ["dataset", "domain", feature]
        if "cycle_number" in frame.columns:
            columns.insert(2, "cycle_number")
        clean = frame[columns].replace([np.inf, -np.inf], np.nan)
        clean = clean.dropna(subset=[feature])
        if request["clip"] and not clean.empty:
            lower, upper = clean[feature].quantile([0.005, 0.995])
            clean = clean[clean[feature].between(lower, upper)]
        if clean.empty:
            raise DomainError("invalid_input", "所选特征没有有效样本")
        edges = np.histogram_bin_edges(clean[feature].to_numpy(), bins=request["bins"])
        series = []
        group_column = "dataset" if request["group_by"] == "dataset" else "domain"
        for group_name, group in clean.groupby(group_column, sort=False):
            counts, _ = np.histogram(group[feature].to_numpy(), bins=edges)
            centers = ((edges[:-1] + edges[1:]) / 2).tolist()
            series.append(
                {
                    "key": str(group_name),
                    "label": names.get(str(group_name), str(group_name)),
                    "points": [
                        {"x": center, "y": int(count)}
                        for center, count in zip(centers, counts, strict=True)
                    ],
                }
            )
        statistics = []
        for dataset, group in clean.groupby("dataset", sort=False):
            values = group[feature]
            statistics.append(
                {
                    "source_id": dataset,
                    "name": names[dataset],
                    "count": len(values),
                    "mean": values.mean(),
                    "std": values.std(),
                    "min": values.min(),
                    "q1": values.quantile(0.25),
                    "median": values.median(),
                    "q3": values.quantile(0.75),
                    "max": values.max(),
                }
            )
        box_statistics = []
        for group_name, group in clean.groupby(group_column, sort=False):
            values = group[feature]
            box_statistics.append(
                {
                    "key": str(group_name),
                    "label": names.get(str(group_name), str(group_name)),
                    "min": values.min(),
                    "q1": values.quantile(0.25),
                    "median": values.median(),
                    "q3": values.quantile(0.75),
                    "max": values.max(),
                }
            )
        trend_series = []
        if "cycle_number" in clean.columns:
            trend = analysis.sample_per_group(
                clean,
                "dataset",
                request["points_per_dataset"],
                request["seed"],
            ).sort_values("cycle_number")
            for group_name, group in trend.groupby(group_column, sort=False):
                trend_series.append(
                    {
                        "key": str(group_name),
                        "label": names.get(str(group_name), str(group_name)),
                        "points": [
                            {"x": row.cycle_number, "y": getattr(row, feature)}
                            for row in group[["cycle_number", feature]].itertuples(index=False)
                        ],
                    }
                )
        return _finite(
            {
                "feature": feature,
                "series": series,
                "trend_series": trend_series,
                "box_statistics": box_statistics,
                "statistics": statistics,
            }
        )
