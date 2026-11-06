"""Feature selection, PCA, aggregation, and distribution distance calculations."""

import numpy as np
import pandas as pd
from scipy.stats import wasserstein_distance
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.manifold import TSNE
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record

from .features import feature_group, is_comparable

SOURCE_LABEL = "源域"
TARGET_LABEL = "目标域"
META_COLS = {
    "dataset",
    "cell_uid",
    "cell_id",
    "file",
    "cycle_number",
    "domain",
    "sample_uid",
    "window_start",
    "window_end",
}


def add_domain(frame: pd.DataFrame, sources: list[str], targets: list[str]) -> pd.DataFrame:
    result = frame[frame["dataset"].isin(sources + targets)].copy()
    result["domain"] = np.where(result["dataset"].isin(sources), SOURCE_LABEL, TARGET_LABEL)
    return result


def cap_cycles_per_cell(frame: pd.DataFrame, maximum: int) -> pd.DataFrame:
    if not maximum or frame.empty:
        return frame
    parts: list[pd.DataFrame] = []
    for _, group in frame.groupby("cell_uid", sort=False):
        if len(group) > maximum:
            group = group.sort_values("cycle_number")
            indices = np.unique(np.linspace(0, len(group) - 1, maximum).round().astype(int))
            group = group.iloc[indices]
        parts.append(group)
    return pd.concat(parts, ignore_index=True)


def sample_per_group(frame: pd.DataFrame, column: str, maximum: int, seed: int) -> pd.DataFrame:
    parts = [
        group.sample(n=min(len(group), maximum), random_state=seed)
        for _, group in frame.groupby(column, sort=False)
    ]
    return pd.concat(parts, ignore_index=True) if parts else frame


def aggregate_cells(
    frame: pd.DataFrame, features: list[str], method: str = "median"
) -> pd.DataFrame:
    metadata = [name for name in ("nominal_capacity_Ah", "temperature_available") if name in frame]
    return (
        frame.groupby(["domain", "dataset", "cell_uid"], sort=False)[features + metadata]
        .agg(method)
        .reset_index()
    )


def pool_embeddings(values: np.ndarray, pool_dim: int) -> np.ndarray:
    """Use the supplied script's token mean pooling without changing feature scales."""
    if pool_dim == 1:
        raise DomainError("invalid_input", "池化维度必须为 0 或至少 2")
    values = np.asarray(values, dtype=np.float64).reshape(len(values), -1)
    dimensions = values.shape[1]
    if pool_dim <= 0 or pool_dim >= dimensions or dimensions % pool_dim:
        return values
    return values.reshape(len(values), -1, pool_dim).mean(axis=1)


def _projection_sample(frame: pd.DataFrame, maximum: int, seed: int) -> pd.DataFrame:
    """Bound quadratic t-SNE work, retaining samples from every selected dataset."""
    groups = list(frame.groupby("dataset", sort=False))
    per_group = min(maximum, max(1, 6000 // max(1, len(groups))))
    return sample_per_group(frame, "dataset", per_group, seed)


def _unit_vectors(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    norms = np.linalg.norm(values, axis=1)
    valid = np.isfinite(values).all(axis=1) & (norms > 1e-12)
    return values[valid] / norms[valid, None], valid


def _model_similarities(
    frame: pd.DataFrame, features: list[str], pool_dim: int, names: dict[str, str]
) -> Record:
    """Compare full pooled vectors; each battery contributes exactly one mean vector."""
    cells = aggregate_cells(frame, features, "mean")
    values = pool_embeddings(cells[features].to_numpy(dtype=float), pool_dim)
    unit_values, valid = _unit_vectors(values)
    cells = cells.loc[valid].reset_index(drop=True)
    values = values[valid]
    warnings = []
    if not valid.all():
        warnings.append(f"{int((~valid).sum())} 块电池的 embedding 为零向量，未参与余弦距离计算。")
    source_mask = (cells["domain"] == SOURCE_LABEL).to_numpy()
    source = cells.loc[source_mask].reset_index(drop=True)
    source_values = unit_values[source_mask]
    threshold = None
    nearest = None
    centroid = None
    if len(source):
        nearest = NearestNeighbors(metric="cosine", algorithm="brute", n_jobs=1).fit(source_values)
        centroid = values[source_mask].mean(axis=0)
        centroid_norm = np.linalg.norm(centroid)
        centroid = centroid / centroid_norm if centroid_norm > 1e-12 else None
        if len(source) >= 2:
            distances, indices = nearest.kneighbors(source_values, n_neighbors=2)
            distances[indices == np.arange(len(source))[:, None]] = np.inf
            threshold = float(np.quantile(np.clip(distances.min(axis=1), 0, 2), 0.95))
        else:
            warnings.append("源域有效电池少于 2 块，无法估计源域内部距离参考阈值。")
    else:
        warnings.append("源域没有有效的非零 embedding，无法计算余弦距离。")

    similarities, matches = [], []
    # Include a target even when all its vectors are invalid, reporting missing metrics.
    for target_id, all_target in frame[frame["domain"] == TARGET_LABEL].groupby(
        "dataset", sort=False
    ):
        target_id = str(target_id)
        target_mask = (cells["dataset"] == target_id).to_numpy()
        target = cells.loc[target_mask].reset_index(drop=True)
        total_cells = int(all_target["cell_uid"].nunique())
        if len(target) < total_cells:
            warnings.append(
                f"目标域 {names[target_id]}：{len(target)}/{total_cells} 块电池参与距离计算，其余零向量被排除。"
            )
        mean_distance = outside_fraction = centroid_distance = None
        if len(target) and nearest is not None:
            distances, indices = nearest.kneighbors(unit_values[target_mask], n_neighbors=1)
            distances = np.clip(distances[:, 0], 0, 2)
            mean_distance = float(distances.mean())
            outside = distances > threshold + 1e-12 if threshold is not None else None
            outside_fraction = float(outside.mean()) if outside is not None else None
            target_centroid = values[target_mask].mean(axis=0)
            target_norm = np.linalg.norm(target_centroid)
            if centroid is not None and target_norm > 1e-12:
                centroid_distance = float(
                    np.clip(1 - np.dot(centroid, target_centroid / target_norm), 0, 2)
                )
            for index, row in target.iterrows():
                source_row = source.iloc[indices[index, 0]]
                matches.append(
                    {
                        "target_id": target_id,
                        "target_name": names[target_id],
                        "cell_uid": row["cell_uid"],
                        "nearest_source_id": str(source_row["dataset"]),
                        "nearest_source_name": names[str(source_row["dataset"])],
                        "nearest_source_cell_uid": source_row["cell_uid"],
                        "cosine_distance": float(distances[index]),
                        "outside_source": bool(outside[index]) if outside is not None else None,
                    }
                )
        similarities.append(
            {
                "target_id": target_id,
                "target_name": names[target_id],
                "samples": total_cells,
                "centroid_cosine_distance": centroid_distance,
                "mean_nearest_source_distance": mean_distance,
                "outside_source_fraction": outside_fraction,
            }
        )
    matches.sort(key=lambda row: row["cosine_distance"], reverse=True)
    return {
        "similarities": similarities,
        "matches": matches,
        "reference_threshold": threshold,
        "warnings": warnings,
    }


def model_embedding_analysis(
    frame: pd.DataFrame, features: list[str], names: dict[str, str], request: Record
) -> Record:
    """Fit one PCA/t-SNE to all domains, preserving the supplied script's geometry."""
    if len(frame) < 2:
        raise DomainError("invalid_input", "模型特征可视化至少需要 2 个样本")
    if not {SOURCE_LABEL, TARGET_LABEL}.issubset(set(frame["domain"])):
        raise DomainError("invalid_input", "源域和目标域都必须包含有效模型特征")
    all_values = frame[features].to_numpy(dtype=float)
    if not np.isfinite(all_values).all():
        raise DomainError("invalid_input", "模型 embedding 包含缺失值或无穷值，请重新提取特征")
    pool_dim = request.get("pool_dim", 64)
    seed = request["seed"]
    sampled = _projection_sample(frame, request["points_per_dataset"], seed)
    values = pool_embeddings(sampled[features].to_numpy(dtype=float), pool_dim)
    centered = values - values.mean(axis=0, keepdims=True)
    warnings = [
        "二维投影用于观察特征结构；相近程度请结合未降维 embedding 的余弦距离，t-SNE 的簇间距离不代表原空间距离。"
    ]
    if len(sampled) < len(frame):
        warnings.append(
            f"绘图按数据集均匀抽样，共展示 {len(sampled)}/{len(frame)} 个样本；距离指标仍使用全部电池。"
        )
    if (
        values.shape[1] == len(features)
        and 0 < pool_dim < len(features)
        and len(features) % pool_dim
    ):
        warnings.append("embedding 维度不能整除所选池化维度，按脚本规则保留原始维度。")
    components = min(request.get("pca_dim", 50), len(values) - 1, values.shape[1])
    if np.linalg.norm(centered) <= 1e-12:
        raise DomainError("invalid_input", "所有样本的模型表示相同，无法进行有意义的降维分析")
    pca = PCA(n_components=components, random_state=seed)
    reduced = pca.fit_transform(centered)
    method = request.get("projection_method", "tsne")
    perplexity = None
    if method == "tsne" and len(reduced) < 3:
        method = "pca"
        warnings.append("总样本少于 3 个，使用 PCA 显示，无法可靠观察 t-SNE 结构。")
    if method == "pca" and reduced.shape[1] < 2:
        warnings.append("样本量仅支持一个 PCA 分量，第二坐标轴补零。")
    if method == "tsne":
        perplexity = float(
            min(request.get("tsne_perplexity", 30.0), max(1.0, (len(reduced) - 1) / 3))
        )
        if perplexity != request.get("tsne_perplexity", 30.0):
            warnings.append(f"样本量较小，t-SNE perplexity 自动调整为 {perplexity:.2f}。")
        coordinates = TSNE(
            n_components=2,
            perplexity=perplexity,
            init="pca" if reduced.shape[1] >= 2 else "random",
            learning_rate="auto",
            random_state=seed,
            max_iter=request.get("tsne_iterations", 1000),
        ).fit_transform(reduced)
    else:
        coordinates = np.zeros((len(values), 2))
        coordinates[:, : min(2, reduced.shape[1])] = reduced[:, :2]
    points = []
    for index, row in enumerate(sampled.to_dict(orient="records")):
        dataset = str(row["dataset"])
        points.append(
            {
                "dataset": dataset,
                "dataset_name": names[dataset],
                "domain": row["domain"],
                "cell_uid": row["cell_uid"],
                "cycle_number": row.get("cycle_number"),
                "x": float(coordinates[index, 0]),
                "y": float(coordinates[index, 1]),
            }
        )
    similarities = _model_similarities(frame, features, pool_dim, names)
    return {
        "method": method,
        "points": points,
        "input_dimensions": len(features),
        "pooled_dimensions": values.shape[1],
        "pca_dimensions": components,
        "perplexity": perplexity,
        "explained_variance": pca.explained_variance_ratio_.tolist(),
        **similarities,
        "warnings": warnings + similarities["warnings"],
    }


def comparable_columns(frame: pd.DataFrame) -> list[str]:
    return [
        column
        for column in frame.columns
        if column not in META_COLS
        and is_comparable(column)
        and pd.api.types.is_numeric_dtype(frame[column])
    ]


def select_features(
    frame: pd.DataFrame, features: list[str], minimum_coverage: float
) -> tuple[list[str], pd.DataFrame]:
    clean = frame[features].replace([np.inf, -np.inf], np.nan)
    coverage = clean.notna().groupby(frame["dataset"].to_numpy()).mean()
    kept: list[str] = []
    dropped: list[tuple[str, str]] = []
    for feature in features:
        worst = coverage[feature].min()
        values = frame[feature].replace([np.inf, -np.inf], np.nan)
        if worst < minimum_coverage:
            dataset = coverage[feature].idxmin()
            dropped.append((feature, f"覆盖率不足：{dataset} 仅 {worst:.0%}"))
        elif values.nunique(dropna=True) <= 1:
            dropped.append((feature, "常数特征"))
        else:
            kept.append(feature)
    return kept, pd.DataFrame(dropped, columns=["feature", "reason"])


def _prepare(frame: pd.DataFrame, features: list[str], fit_mask: np.ndarray) -> np.ndarray:
    values = frame[features].replace([np.inf, -np.inf], np.nan).to_numpy(dtype=float)
    imputer = SimpleImputer(strategy="median", keep_empty_features=True).fit(values[fit_mask])
    scaler = StandardScaler().fit(imputer.transform(values[fit_mask]))
    return scaler.transform(imputer.transform(values))


def embed_pca(
    frame: pd.DataFrame, features: list[str], fit_on: str, seed: int
) -> tuple[pd.DataFrame, np.ndarray, pd.DataFrame]:
    fit_mask = (
        (frame["domain"] == SOURCE_LABEL).to_numpy()
        if fit_on == "source"
        else np.ones(len(frame), dtype=bool)
    )
    if fit_mask.sum() < 3:
        raise DomainError("invalid_input", "用于拟合 PCA 的样本不足 3 个")
    values = _prepare(frame, features, fit_mask)
    components = min(2, values.shape[1], int(fit_mask.sum()))
    pca = PCA(n_components=components, random_state=seed).fit(values[fit_mask])
    coordinates = pca.transform(values)
    columns = [f"PC{index + 1}" for index in range(components)]
    output = frame.drop(
        columns=[column for column in frame.columns if column in features]
    ).reset_index(drop=True)
    output[columns] = coordinates
    loadings = pd.DataFrame(pca.components_.T, index=features, columns=columns)
    return output, pca.explained_variance_ratio_, loadings


def feature_shift(source: pd.DataFrame, target: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    for feature in features:
        a = source[feature].to_numpy(dtype=float)
        b = target[feature].to_numpy(dtype=float)
        a, b = a[np.isfinite(a)], b[np.isfinite(b)]
        if len(a) < 2 or len(b) < 2:
            continue
        standard_deviation = float(np.std(np.concatenate([a, b])))
        valid = standard_deviation > 1e-12
        rows.append(
            {
                "feature": feature,
                "group": feature_group(feature),
                "source_mean": float(a.mean()),
                "target_mean": float(b.mean()),
                "source_std": float(a.std()),
                "target_std": float(b.std()),
                "wd_norm": (
                    float(wasserstein_distance(a, b)) / standard_deviation if valid else np.nan
                ),
                "smd": float((b.mean() - a.mean()) / standard_deviation) if valid else np.nan,
                "n_source": len(a),
                "n_target": len(b),
            }
        )
    return pd.DataFrame(
        rows,
        columns=[
            "feature",
            "group",
            "source_mean",
            "target_mean",
            "source_std",
            "target_std",
            "wd_norm",
            "smd",
            "n_source",
            "n_target",
        ],
    )


def domain_shift(frame: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    return feature_shift(
        frame[frame["domain"] == SOURCE_LABEL],
        frame[frame["domain"] == TARGET_LABEL],
        features,
    )


def pairwise_shift(
    frame: pd.DataFrame, features: list[str], sources: list[str], targets: list[str]
) -> pd.DataFrame:
    parts: list[pd.DataFrame] = []
    for source_id in sources:
        source = frame[frame["dataset"] == source_id]
        for target_id in targets:
            target = frame[frame["dataset"] == target_id]
            if source.empty or target.empty:
                continue
            result = feature_shift(source, target, features)
            result.insert(0, "target", target_id)
            result.insert(0, "source", source_id)
            parts.append(result)
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
