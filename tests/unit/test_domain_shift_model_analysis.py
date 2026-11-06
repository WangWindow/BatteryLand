"""Model geometry is evaluated in embeddings, independently of physical feature ranking."""

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from batteryland.common.errors import DomainError
from batteryland.domain_shift import analysis, data
from batteryland.domain_shift.routes import AnalysisRequest
from batteryland.domain_shift.service import DomainShiftService


def frame_for(vectors, datasets=None, cells=None):
    datasets = datasets or ["source", "source", "target", "target"]
    cells = cells or [f"{dataset}/{index}" for index, dataset in enumerate(datasets)]
    return pd.DataFrame(
        {
            "dataset": datasets,
            "domain": [
                analysis.SOURCE_LABEL if dataset == "source" else analysis.TARGET_LABEL
                for dataset in datasets
            ],
            "cell_uid": cells,
            "cycle_number": np.arange(1, len(vectors) + 1),
            **{
                f"embedding_{index:04d}": np.asarray(vectors)[:, index]
                for index in range(len(vectors[0]))
            },
        }
    )


def model_result(frame, **options):
    features = [column for column in frame if column.startswith("embedding_")]
    names = {str(dataset): str(dataset) for dataset in frame["dataset"].unique()}
    request = {
        "projection_method": "pca",
        "pool_dim": 64,
        "seed": 42,
        "points_per_dataset": 200,
        **options,
    }
    return analysis.model_embedding_analysis(frame, features, names, request)


def test_pooling_matches_script_and_keeps_incompatible_dimensions():
    values = np.arange(32).reshape(4, 8)
    np.testing.assert_allclose(
        analysis.pool_embeddings(values, 2), values.reshape(4, 4, 2).mean(axis=1)
    )
    for dimension in (0, 3, 8, 16):
        np.testing.assert_array_equal(analysis.pool_embeddings(values, dimension), values)
    with pytest.raises(DomainError, match="池化维度"):
        analysis.pool_embeddings(values, 1)


def test_target_distance_distinguishes_overlap_from_novel_vectors():
    frame = frame_for([[1, 0], [1, 0.02], [1, 0.001], [0, 1]])
    result = model_result(frame)
    matches = {row["cell_uid"]: row for row in result["matches"]}
    assert matches["target/2"]["cosine_distance"] < result["reference_threshold"]
    assert matches["target/2"]["outside_source"] is False
    assert matches["target/3"]["cosine_distance"] > 0.95
    assert matches["target/3"]["outside_source"] is True
    assert result["similarities"][0]["outside_source_fraction"] == 0.5
    assert {point["domain"] for point in result["points"]} == {
        analysis.SOURCE_LABEL,
        analysis.TARGET_LABEL,
    }


def test_reference_threshold_uses_distinct_batteries_instead_of_same_battery_windows():
    frame = frame_for(
        [[1, 0], [1, 0], [0, 1], [0, 1], [1, 0.2]],
        ["source", "source", "source", "source", "target"],
        ["source/a", "source/a", "source/b", "source/b", "target/a"],
    )
    result = model_result(frame)
    assert result["reference_threshold"] == pytest.approx(1)
    assert len(result["matches"]) == 1
    assert result["similarities"][0]["samples"] == 1


def test_mean_aggregation_preserves_script_battery_representation():
    frame = frame_for([[0, 0], [0, 0], [3, 3]], ["source"] * 3, ["source/a"] * 3)
    columns = ["embedding_0000", "embedding_0001"]
    assert analysis.aggregate_cells(frame, columns, "mean").iloc[0][columns].tolist() == [1, 1]
    assert analysis.aggregate_cells(frame, columns).iloc[0][columns].tolist() == [0, 0]


def test_zero_vectors_and_single_source_report_unavailable_reference():
    frame = frame_for([[0, 0], [1, 0], [1, 0.1], [0, 0]])
    result = model_result(frame)
    assert result["reference_threshold"] is None
    assert result["similarities"][0]["outside_source_fraction"] is None
    assert len(result["matches"]) == 1
    assert result["matches"][0]["outside_source"] is None
    assert any("零向量" in warning for warning in result["warnings"])
    assert any("少于 2" in warning for warning in result["warnings"])


def test_tsne_is_joint_deterministic_and_adapts_small_sample_perplexity():
    frame = frame_for([[1, 0, 2, 0], [1, 0.02, 2, 0.02], [1, 0.001, 1, 0.001], [0, 1, 0, 2]])
    first = model_result(frame, projection_method="tsne", pool_dim=2, tsne_iterations=300)
    second = model_result(frame, projection_method="tsne", pool_dim=2, tsne_iterations=300)
    assert first["method"] == "tsne"
    assert first["input_dimensions"] == 4
    assert first["pooled_dimensions"] == 2
    assert 0 < first["perplexity"] < len(frame)
    assert len(first["points"]) == 4
    np.testing.assert_allclose(
        [[point["x"], point["y"]] for point in first["points"]],
        [[point["x"], point["y"]] for point in second["points"]],
    )


def test_two_samples_fall_back_to_pca_and_degenerate_vectors_are_rejected():
    frame = frame_for([[1, 0], [0, 1]], ["source", "target"])
    result = model_result(frame, projection_method="tsne")
    assert result["method"] == "pca"
    assert len(result["points"]) == 2
    assert all(np.isfinite([point["x"], point["y"]]).all() for point in result["points"])
    assert any("少于 3" in warning for warning in result["warnings"])
    with pytest.raises(DomainError, match="所有样本"):
        model_result(frame_for([[1, 0], [1, 0]], ["source", "target"]))
    with pytest.raises(DomainError, match="源域和目标域"):
        model_result(frame_for([[1, 0], [0, 1]], ["source", "source"]))


def test_projection_sampling_bounds_points_and_retains_all_datasets():
    frame = frame_for(np.tile([[1, 0]], (8000, 1)), ["source"] * 4000 + ["target"] * 4000)
    sampled = analysis._projection_sample(frame, 50000, 42)
    assert len(sampled) == 6000
    assert sampled.groupby("dataset").size().to_dict() == {"source": 3000, "target": 3000}


def test_model_preparation_retains_constant_coordinates_and_uses_mean(tmp_path, monkeypatch):
    frame = frame_for(
        [[0, 7, 1], [0, 7, 1], [3, 7, 1], [2, 7, 1]],
        ["source", "source", "source", "target"],
        ["source/a", "source/a", "source/a", "target/a"],
    )
    extractor = SimpleNamespace(resolve=lambda _: {}, cache_dir=lambda _: tmp_path)
    service = DomainShiftService(SimpleNamespace(data_dir=tmp_path), None, extractor)
    monkeypatch.setattr(
        service,
        "_datasets",
        lambda _: ({"source": [], "target": []}, {"source": "Source", "target": "Target"}),
    )
    monkeypatch.setattr(data, "cache_status", lambda *_: {"source": (1, 1), "target": (1, 1)})
    monkeypatch.setattr(data, "load_features", lambda *_: frame)
    try:
        prepared, features, dropped, _, _ = service._prepared(
            ["source"], ["target"], 1, 0, 0.5, "cell", [], [], {"experiment_id": "x"}
        )
    finally:
        service.close()
    assert features == ["embedding_0000", "embedding_0001", "embedding_0002"]
    assert dropped.empty
    assert prepared.loc[prepared["dataset"] == "source", "embedding_0000"].item() == 1


def test_projection_request_validates_parameters():
    from uuid import uuid4

    request = {"source_ids": [uuid4()], "target_ids": [uuid4()]}
    for extra in (
        {"pool_dim": -1},
        {"pool_dim": 1},
        {"pca_dim": 1},
        {"projection_method": "bad"},
        {"tsne_perplexity": 0},
        {"tsne_iterations": 100},
    ):
        with pytest.raises(ValueError):
            AnalysisRequest.model_validate(request | extra)
