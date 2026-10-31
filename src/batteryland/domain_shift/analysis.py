"""Feature selection, PCA, aggregation, and distribution distance calculations."""

import numpy as np
import pandas as pd
from scipy.stats import wasserstein_distance
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler

from .features import feature_group, is_comparable

SOURCE_LABEL = "源域"
TARGET_LABEL = "目标域"
META_COLS = {"dataset", "cell_uid", "cell_id", "file", "cycle_number", "domain"}


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
            indices = np.unique(
                np.linspace(0, len(group) - 1, maximum).round().astype(int)
            )
            group = group.iloc[indices]
        parts.append(group)
    return pd.concat(parts, ignore_index=True)


def sample_per_group(frame: pd.DataFrame, column: str, maximum: int, seed: int) -> pd.DataFrame:
    parts = [
        group.sample(n=min(len(group), maximum), random_state=seed)
        for _, group in frame.groupby(column, sort=False)
    ]
    return pd.concat(parts, ignore_index=True) if parts else frame


def aggregate_cells(frame: pd.DataFrame, features: list[str]) -> pd.DataFrame:
    return (
        frame.groupby(["domain", "dataset", "cell_uid"], sort=False)[features]
        .median()
        .reset_index()
    )


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
        raise ValueError("用于拟合的样本不足 3 个")
    values = _prepare(frame, features, fit_mask)
    components = min(2, values.shape[1], int(fit_mask.sum()))
    pca = PCA(n_components=components, random_state=seed).fit(values[fit_mask])
    coordinates = pca.transform(values)
    columns = [f"PC{index + 1}" for index in range(components)]
    output = frame.drop(columns=[column for column in frame.columns if column in features]).reset_index(
        drop=True
    )
    output[columns] = coordinates
    loadings = pd.DataFrame(pca.components_.T, index=features, columns=columns)
    return output, pca.explained_variance_ratio_, loadings


def feature_shift(
    source: pd.DataFrame, target: pd.DataFrame, features: list[str]
) -> pd.DataFrame:
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
                    float(wasserstein_distance(a, b)) / standard_deviation
                    if valid
                    else np.nan
                ),
                "smd": float((b.mean() - a.mean()) / standard_deviation) if valid else np.nan,
                "n_source": len(a),
                "n_target": len(b),
            }
        )
    return pd.DataFrame(rows)


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
