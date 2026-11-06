import io
import json
import pickle
import sys
import time
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient

from batteryland.common.errors import DomainError
from batteryland.common.storage import ManagedArtifacts
from batteryland.db.models import ArtifactRow, ExperimentRow, ValidatedInputRow
from batteryland.domain_shift.model_features import ModelFeatureExtractor


def _battery(path: Path, cell_id: str, voltage_offset: float) -> None:
    cycles = []
    for number in range(1, 7):
        cycles.append(
            {
                "cycle_number": number,
                "current_in_A": [1.0, 1.0, 0.0, -1.0, -1.0],
                "voltage_in_V": [
                    3.0 + voltage_offset,
                    4.1 + voltage_offset + number * 0.001,
                    4.0 + voltage_offset,
                    3.8 + voltage_offset,
                    3.0 + voltage_offset,
                ],
                "charge_capacity_in_Ah": [0.0, 1.8, 1.8, 0.0, 0.0],
                "discharge_capacity_in_Ah": [0.0, 0.0, 0.0, 0.9, 1.7],
                "time_in_s": [0.0, 100.0, 110.0, 210.0, 310.0],
                "temperature_in_C": [25.0, 25.2, 25.3, 25.6, 25.8],
                "internal_resistance_in_ohm": [0.04 + number * 0.0001],
            }
        )
    with path.open("wb") as stream:
        pickle.dump(
            {
                "cell_id": cell_id,
                "nominal_capacity_in_Ah": 2.0,
                "cycle_data": cycles,
            },
            stream,
        )


def test_domain_shift_native_api(client: TestClient, settings) -> None:
    for name, offset in (("source", 0.0), ("target", 0.15)):
        folder = settings.source_roots["demo"] / name
        folder.mkdir()
        _battery(folder / f"{name}-1.pkl", f"{name}-1", offset)
        _battery(folder / f"{name}-2.pkl", f"{name}-2", offset + 0.01)

    client.app.state.container.catalog_indexer.index()
    source_response = client.get("/api/v1/data-sources?page_size=20")
    assert source_response.status_code == 200
    by_name = {item["name"]: item["id"] for item in source_response.json()["data"]["items"]}
    source_id, target_id = by_name["source"], by_name["target"]

    status = client.post(
        "/api/v1/domain-shift/cache/status",
        json={"source_ids": [source_id, target_id], "stride": 1},
    )
    assert status.status_code == 200
    assert status.json()["data"]["missing_files"] == 4

    build = client.post(
        "/api/v1/domain-shift/jobs",
        json={"source_ids": [source_id, target_id], "stride": 1, "workers": 1},
    )
    assert build.status_code == 200
    job_id = build.json()["data"]["id"]
    for _ in range(100):
        job = client.get(f"/api/v1/domain-shift/jobs/{job_id}")
        assert job.status_code == 200
        if job.json()["data"]["state"] not in {"queued", "running"}:
            break
        time.sleep(0.02)
    assert job.json()["data"]["state"] == "completed"

    request = {
        "source_ids": [source_id],
        "target_ids": [target_id],
        "stride": 1,
        "max_cycles": 200,
        "minimum_coverage": 0.5,
        "level": "cycle",
        "feature_groups": [],
        "excluded_features": [],
        "seed": 42,
        "points_per_dataset": 200,
        "pca_fit": "all",
    }
    result = client.post("/api/v1/domain-shift/analysis", json=request)
    assert result.status_code == 200, result.text
    payload = result.json()["data"]
    assert payload["summary"]["source_count"] == 1
    assert payload["summary"]["target_count"] == 1
    assert payload["pca"]["points"]
    assert payload["shift"]

    distribution = client.post(
        "/api/v1/domain-shift/distribution",
        json=request
        | {
            "feature": payload["features"][0]["name"],
            "group_by": "dataset",
            "bins": 20,
            "clip": True,
        },
    )
    assert distribution.status_code == 200, distribution.text
    assert len(distribution.json()["data"]["series"]) == 2


def _model_source(tmp_path):
    root = tmp_path / "batterylife"
    (root / "models").mkdir(parents=True)
    (root / "data_provider").mkdir()
    (root / "models/__init__.py").write_text("", encoding="utf-8")
    (root / "models/TestEncoder.py").write_text(
        "import torch\n"
        "class Model(torch.nn.Module):\n"
        "    def __init__(self, configs):\n"
        "        super().__init__()\n"
        "        self.linear = torch.nn.Linear(configs.early_cycle_threshold * 3 * configs.charge_discharge_length, 3, bias=False)\n"
        "    def forward(self, curves, mask, return_embedding=False):\n"
        "        embedding = self.linear(curves.flatten(1))\n"
        "        prediction = embedding.sum(dim=1)\n"
        "        return (prediction, embedding) if return_embedding else prediction\n",
        encoding="utf-8",
    )
    (root / "data_provider/data_loader.py").write_text(
        "class Dataset_original:\n"
        "    def get_charge_discharge_curves(self, file_name, frame, early, nominal):\n"
        "        curves = np.zeros((early, 3, self.charge_discharge_len))\n"
        "        for i, group in frame.groupby('cycle_number'):\n"
        "            curves[int(i)-1] = group['voltage_in_V'].mean() / nominal\n"
        "        return curves\n"
        "    def resample_charge_discharge_curves(self, *values):\n"
        "        return values\n",
        encoding="utf-8",
    )
    parameters = {"seq_len": 2, "early_cycle_threshold": 6, "charge_discharge_length": 4}
    (root / "run.py").write_text(
        "# Parsed as source only; this entry point must never be executed.\n"
        "raise RuntimeError('training entry point executed')\n"
        "parser.add_argument('--seq_len', default=2)\n"
        "parser.add_argument('--early_cycle_threshold', default=6)\n"
        "parser.add_argument('--charge_discharge_len', default=4)\n",
        encoding="utf-8",
    )
    return root, parameters


def _model_fixture(client, settings, tmp_path, weight_format="pt"):
    torch = pytest.importorskip("torch")
    root, parameters = _model_source(tmp_path)
    config = {"model": {"type": "TestEncoder", "params": {}}, "datafactory": {"params": parameters}}
    identity = str(uuid4())
    container = client.app.state.container
    with container.database.unit_of_work() as unit:
        document = unit.documents.publish(
            "experiment_draft", identity, 1, {"native_config": config}
        )
        unit.experiments.add(
            identity,
            {"name": "模型特征测试"},
            document.id,
            {
                "split_document_id": None,
                "source_split_document_id": None,
                "target_split_document_id": None,
                "checkpoint_id": None,
            },
            {
                "source_id": None,
                "split_id": None,
                "model_type": "TestEncoder",
                "task_type": None,
                "requested_device": "cpu",
                "source_domain": None,
                "target_domain": None,
            },
        )
        unit.experiments.session.get(ExperimentRow, identity).state = "succeeded"
        unit.validated_inputs.add(
            identity,
            1,
            {
                "config": config,
                "config_text": json.dumps(config),
                "split_text": "{}",
                "split": {"train": [], "val": [], "test": []},
                "config_sha256": "a" * 64,
                "split_sha256": "b" * 64,
                "split_id": None,
                "split_version": None,
                "receipt": {},
                "provider_commit": "test",
            },
        )
    weights = []
    for scale in (1.0, 2.0):
        linear = torch.nn.Linear(72, 3, bias=False)
        with torch.no_grad():
            linear.weight.copy_(torch.arange(216).reshape(3, 72).float() * scale / 216)
        stream = io.BytesIO()
        if weight_format == "safetensors":
            safetensors = pytest.importorskip("safetensors.torch")
            stream.write(safetensors.save({"linear.weight": linear.weight.detach()}))
        else:
            torch.save({"linear.weight": linear.weight.detach()}, stream)
        stream.seek(0)
        value = ManagedArtifacts(settings.data_dir).save(
            stream, f"weights-{scale}.{weight_format}", 100000
        )
        with container.database.unit_of_work() as unit:
            artifact = unit.artifacts.add(
                value
                | {
                    "experiment_id": identity,
                    "component_id": None,
                    "kind": "checkpoint",
                    "origin": "test",
                }
            )
        weights.append(artifact)
    extraction_settings = replace(
        settings, batterylife_root=root, training_python=Path(sys.executable)
    )
    extractor = ModelFeatureExtractor(extraction_settings, container.database.unit_of_work)
    container.domain_shift.model_features = extractor
    return extractor, identity, weights


def _wait_job(client, job_id):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/domain-shift/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()["data"]
        if job["state"] not in {"queued", "running"}:
            return job
        time.sleep(0.05)
    pytest.fail("模型提取任务未在 30 秒内结束")


def test_checkpoint_discovery_uses_experiment_and_run_ids(client, settings, tmp_path):
    extractor, experiment_id, weights = _model_fixture(client, settings, tmp_path)
    run_id = f"{experiment_id}_20261106_170954_818407_4155310"
    checkpoint = settings.data_dir / "experiments" / experiment_id / "runs" / run_id / "checkpoint"
    checkpoint.mkdir(parents=True)
    known = checkpoint / "registered.pt"
    known.write_bytes(extractor.artifacts.resolve(weights[0]["relative_key"]).read_bytes())
    with extractor.units() as unit:
        unit.artifacts.session.get(ArtifactRow, weights[0]["id"]).relative_key = known.relative_to(
            settings.data_dir
        ).as_posix()
    recovered = checkpoint / "model.pt"
    recovered.write_bytes(extractor.artifacts.resolve(weights[1]["relative_key"]).read_bytes())
    (checkpoint / "args.json").write_text("{}")
    (checkpoint / "label_scaler").write_text("not a weight")
    other = settings.data_dir / "experiments" / str(uuid4()) / "runs" / "other" / "checkpoint"
    other.mkdir(parents=True)
    (other / "unrelated.pt").write_bytes(recovered.read_bytes())

    def options():
        response = client.get("/api/v1/domain-shift/models")
        assert response.status_code == 200, response.text
        return response.json()["data"][0]

    checkpoints = options()["checkpoints"]
    by_name = {row["name"]: row for row in checkpoints}
    assert by_name[weights[0]["name"]]["id"] == weights[0]["id"]
    assert by_name[weights[0]["name"]]["relative_key"].endswith("checkpoint/registered.pt")
    row = by_name["model.pt"]
    assert row["run_id"] == run_id
    assert row["relative_key"] == f"experiments/{experiment_id}/runs/{run_id}/checkpoint/model.pt"
    assert row["relative_path"].endswith(row["relative_key"])
    assert row["supported"]
    assert len(checkpoints) == 3
    assert {item["id"] for item in options()["checkpoints"]} == {item["id"] for item in checkpoints}
    assert extractor.resolve({"experiment_id": experiment_id, "checkpoint_id": row["id"]})[
        "checkpoint_path"
    ] == str(recovered)

    # Missing source code must not hide the experiment type or the recovered path.
    extractor.settings = replace(extractor.settings, batterylife_root=tmp_path / "missing-source")
    with extractor.units() as unit:
        unit.experiments.session.get(ExperimentRow, experiment_id).model_type = None
    missing = options()
    assert missing["model_type"] == "TestEncoder"
    assert all(
        not item["supported"] and "未找到模型源码" in item["reason"]
        for item in missing["checkpoints"]
    )


def test_in_project_cpmlp_checkpoint_extracts_without_external_batterylife_root(
    client, settings, tmp_path, monkeypatch
):
    torch = pytest.importorskip("torch")
    safetensors = pytest.importorskip("safetensors.torch")
    from batteryland.training import feature_worker

    _, experiment_id, _ = _model_fixture(client, settings, tmp_path)
    provider = Path(__file__).resolve().parents[1] / "src/deeplatform"
    monkeypatch.syspath_prepend(str(provider))
    parameters = {
        "d_ff": 16,
        "d_model": 8,
        "charge_discharge_length": 4,
        "early_cycle_threshold": 6,
        "dropout": 0.0,
        "e_layers": 1,
        "d_layers": 1,
    }
    config = {
        "model": {"type": "cpmlp", "params": parameters},
        "datafactory": {"params": {"seq_len": 2, "charge_discharge_len": 4}},
    }
    extractor = ModelFeatureExtractor(
        replace(
            settings,
            batterylife_root=None,
            provider_root=provider,
            training_python=Path(sys.executable),
        ),
        client.app.state.container.database.unit_of_work,
    )
    client.app.state.container.domain_shift.model_features = extractor
    with extractor.units() as unit:
        unit.validated_inputs.session.get(ValidatedInputRow, (experiment_id, 1)).config = config
    model = feature_worker.build_model("CPMLP", parameters, "components.models.CPMLP").eval()
    run_id = f"{experiment_id}_20261106_170954_818407_4155310"
    checkpoint = settings.data_dir / "experiments" / experiment_id / "runs" / run_id / "checkpoint"
    checkpoint.mkdir(parents=True)
    safetensors.save_file(model.state_dict(), str(checkpoint / "model.safetensors"))
    row = next(
        item for item in extractor.models()[0]["checkpoints"] if item["name"] == "model.safetensors"
    )
    assert row["supported"], row["reason"]
    specification = extractor.resolve({"experiment_id": experiment_id, "checkpoint_id": row["id"]})
    assert specification["model_module"] == "components.models.CPMLP"
    assert specification["root"] == str(provider)
    assert specification["parameters"]["seq_len"] == 2
    file = tmp_path / "XJTU_cell.pkl"
    _battery(file, "cell", 0.1)
    result = extractor.build(
        specification, {"xjtu": [file]}, ["xjtu"], 1, 2, "cpu", lambda *_: None
    )
    assert result == {"built": 1, "failed": [], "total": 1}
    frame = extractor.load(specification, {"xjtu": [file]}, ["xjtu"], 1)
    cached_files = list(extractor.cache_dir(specification).rglob("*.npz"))
    assert len(cached_files) == 1
    with np.load(cached_files[0], allow_pickle=False) as archive:
        assert all(archive[key].dtype.kind != "O" for key in archive.files)
    columns = [f"embedding_{index:04d}" for index in range(8)]
    assert len(frame) == 5
    reader = feature_worker.curve_reader(provider, 4)
    curves, *_ = feature_worker.input_curves(file, reader, 6)
    masks = np.arange(6)[None, :] < np.arange(2, 7)[:, None]
    inputs = np.repeat(curves[None, ...], 5, axis=0) * masks[:, :, None, None]
    with torch.inference_mode():
        _, expected = model(
            torch.from_numpy(inputs),
            torch.from_numpy(masks.astype(np.float32)),
            return_embedding=True,
        )
    np.testing.assert_allclose(frame[columns].to_numpy(), expected.numpy(), atol=1e-6)


@pytest.mark.parametrize("weight_format", ["pt", "safetensors"])
def test_model_embeddings_flow_and_cache_isolation(client, settings, tmp_path, weight_format):
    extractor, experiment_id, weights = _model_fixture(client, settings, tmp_path, weight_format)
    for name, offset in (("source", 0.0), ("target", 0.2)):
        folder = settings.source_roots["demo"] / name
        folder.mkdir()
        _battery(folder / f"{name}.pkl", name, offset)
    client.app.state.container.catalog_indexer.index()
    by_name = {
        item["name"]: item["id"]
        for item in client.get("/api/v1/data-sources?page_size=20").json()["data"]["items"]
    }
    source_id, target_id = by_name["source"], by_name["target"]
    selection = {
        "experiment_id": experiment_id,
        "checkpoint_id": weights[0]["id"],
        "layer": "embedding",
    }
    context = {"feature_space": "model", "model": selection, "stride": 1}
    cache_request = context | {"source_ids": [source_id, target_id]}
    options = client.get("/api/v1/domain-shift/models").json()["data"]
    assert options[0]["checkpoints"][0]["supported"]
    assert (
        client.post("/api/v1/domain-shift/cache/status", json=cache_request).json()["data"][
            "missing_files"
        ]
        == 2
    )
    build = client.post(
        "/api/v1/domain-shift/jobs", json=cache_request | {"batch_size": 2, "device": "cpu"}
    )
    assert build.status_code == 200, build.text
    job = _wait_job(client, build.json()["data"]["id"])
    assert job["state"] == "completed", job["failed"] or job.get("error")
    assert (
        client.post("/api/v1/domain-shift/cache/status", json=cache_request).json()["data"][
            "missing_files"
        ]
        == 0
    )
    # Original physical caches and a second checkpoint remain unbuilt.
    assert (
        client.post(
            "/api/v1/domain-shift/cache/status", json={"source_ids": [source_id, target_id]}
        ).json()["data"]["missing_files"]
        == 2
    )
    second_selection = selection | {"checkpoint_id": weights[1]["id"]}
    second_context = context | {"model": second_selection}
    assert (
        client.post(
            "/api/v1/domain-shift/cache/status", json=cache_request | second_context
        ).json()["data"]["missing_files"]
        == 2
    )
    assert (
        extractor.resolve(selection)["cache_key"]
        != extractor.resolve(second_selection)["cache_key"]
    )
    request = context | {
        "source_ids": [source_id],
        "target_ids": [target_id],
        "points_per_dataset": 200,
    }
    response = client.post("/api/v1/domain-shift/analysis", json=request)
    assert response.status_code == 200, response.text
    result = response.json()["data"]
    assert result["summary"]["sample_unit"] == "窗口"
    assert result["summary"]["sample_count"] == 10
    assert all(row["name"].startswith("embedding_") for row in result["features"])
    assert result["representation"]["weight_sha256"] == weights[0]["sha256"]
    assert len(result["model_analysis"]["points"]) == 10
    assert result["model_analysis"]["method"] == "tsne"
    assert result["shift"] == []
    distribution = client.post(
        "/api/v1/domain-shift/distribution", json=request | {"feature": "embedding_0000"}
    )
    assert distribution.status_code == 200, distribution.text
    assert len(distribution.json()["data"]["series"]) == 2
    # Verify the first window uses only the first two cycles, with later cycles zeroed.
    datasets, _ = client.app.state.container.domain_shift._datasets([source_id])
    frame = extractor.load(extractor.resolve(selection), datasets, [source_id], 1)
    expected = sum(
        (3.58 + (i + 1) * 0.0002) / 2 * np.arange(i * 12, (i + 1) * 12).sum() / 216
        for i in range(2)
    )
    assert frame.iloc[0]["embedding_0000"] == pytest.approx(expected, rel=1e-5)


def test_model_request_validation(client):
    identity = str(uuid4())
    for endpoint in ("cache/status", "jobs", "analysis", "distribution"):
        body = {"source_ids": [identity], "feature_space": "model"}
        if endpoint in {"analysis", "distribution"}:
            body["target_ids"] = [str(uuid4())]
        if endpoint == "distribution":
            body["feature"] = "embedding_0000"
        response = client.post(f"/api/v1/domain-shift/{endpoint}", json=body)
        assert response.status_code == 422
        assert any("模型模式" in field["message"] for field in response.json()["data"]["fields"])


def test_model_selection_rejects_other_experiment_and_changed_weights(client, settings, tmp_path):
    extractor, experiment_id, weights = _model_fixture(client, settings, tmp_path)
    selection = {"experiment_id": experiment_id, "checkpoint_id": weights[0]["id"]}
    path = ManagedArtifacts(settings.data_dir).resolve(weights[0]["relative_key"])
    path.write_bytes(b"changed")
    with pytest.raises(DomainError, match="摘要"):
        extractor.resolve(selection)
    with client.app.state.container.database.unit_of_work() as unit:
        unit.artifacts.session.get(ArtifactRow, weights[1]["id"]).experiment_id = None
    with pytest.raises(DomainError, match="该实验"):
        extractor.resolve(selection | {"checkpoint_id": weights[1]["id"]})


def test_architectures_without_experiments(client, settings, tmp_path):
    root, parameters = _model_source(tmp_path)
    (root / "models/Unsupported.py").write_text(
        "class Model:\n    def forward(self, curves, mask):\n        return curves\n",
        encoding="utf-8",
    )
    extractor = ModelFeatureExtractor(
        replace(settings, batterylife_root=root), client.app.state.container.database.unit_of_work
    )
    client.app.state.container.domain_shift.model_features = extractor
    assert client.get("/api/v1/domain-shift/models").json()["data"] == []
    response = client.get("/api/v1/domain-shift/architectures")
    assert response.status_code == 200, response.text
    options = {item["model_type"]: item for item in response.json()["data"]}
    assert options["TestEncoder"]["parameters"] == parameters
    assert options["TestEncoder"]["supported"]
    assert not options["Unsupported"]["supported"]
    assert "return_embedding" in options["Unsupported"]["reason"]
    selection = {"model_type": "TestEncoder", "parameters": parameters, "initialization_seed": 42}
    spec = extractor.resolve(selection)
    assert spec["weight_source"] == "random"
    assert "checkpoint_path" not in spec
    assert spec["cache_key"] == extractor.resolve(selection)["cache_key"]
    assert (
        spec["cache_key"] != extractor.resolve(selection | {"initialization_seed": 43})["cache_key"]
    )
    assert (
        spec["cache_key"]
        != extractor.resolve(selection | {"parameters": parameters | {"seq_len": 3}})["cache_key"]
    )
    with pytest.raises(DomainError, match="源码中未找到"):
        extractor.resolve(selection | {"model_type": "../../other"})


def test_random_model_embeddings_without_experiment(client, settings, tmp_path):
    torch = pytest.importorskip("torch")
    root, parameters = _model_source(tmp_path)
    container = client.app.state.container
    extractor = ModelFeatureExtractor(
        replace(settings, batterylife_root=root, training_python=Path(sys.executable)),
        container.database.unit_of_work,
    )
    container.domain_shift.model_features = extractor
    for name, offset in (("source", 0.0), ("target", 0.2)):
        folder = settings.source_roots["demo"] / name
        folder.mkdir()
        _battery(folder / f"{name}.pkl", name, offset)
    container.catalog_indexer.index()
    by_name = {
        item["name"]: item["id"]
        for item in client.get("/api/v1/data-sources?page_size=20").json()["data"]["items"]
    }
    source_id, target_id = by_name["source"], by_name["target"]
    selection = {
        "model_type": "TestEncoder",
        "parameters": parameters,
        "initialization_seed": 42,
        "layer": "embedding",
    }
    context = {"feature_space": "model", "model": selection, "stride": 1}
    cache_request = context | {"source_ids": [source_id, target_id]}
    build = client.post("/api/v1/domain-shift/jobs", json=cache_request | {"batch_size": 2})
    assert build.status_code == 200, build.text
    job = _wait_job(client, build.json()["data"]["id"])
    assert job["state"] == "completed", job["failed"] or job.get("error")
    assert client.get("/api/v1/domain-shift/models").json()["data"] == []
    assert (
        client.post("/api/v1/domain-shift/cache/status", json=cache_request).json()["data"][
            "missing_files"
        ]
        == 0
    )
    request = context | {
        "source_ids": [source_id],
        "target_ids": [target_id],
        "points_per_dataset": 200,
    }
    response = client.post("/api/v1/domain-shift/analysis", json=request)
    assert response.status_code == 200, response.text
    representation = response.json()["data"]["representation"]
    assert representation["weight_source"] == "random"
    assert representation["initialization_seed"] == 42
    assert representation["weight_sha256"] is None
    assert response.json()["data"]["summary"]["sample_count"] == 10
    assert (
        client.post(
            "/api/v1/domain-shift/distribution", json=request | {"feature": "embedding_0000"}
        ).status_code
        == 200
    )
    # Both domains must use the same seeded initialization, even across batches.
    torch.manual_seed(42)
    linear = torch.nn.Linear(72, 3, bias=False)
    datasets, _ = container.domain_shift._datasets([source_id, target_id])
    first = extractor.load(extractor.resolve(selection), datasets, [source_id, target_id], 1)
    for dataset, offset in ((source_id, 0.0), (target_id, 0.2)):
        inputs = torch.zeros(72)
        for i in range(2):
            inputs[i * 12 : (i + 1) * 12] = (3.58 + offset + (i + 1) * 0.0002) / 2
        expected = linear(inputs).detach().numpy()
        actual = first[first.dataset == dataset].iloc[0]
        np.testing.assert_allclose(
            [actual[f"embedding_{i:04d}"] for i in range(3)], expected, atol=1e-6
        )
    # Rebuilding with a different batch size reproduces the same features.
    spec = extractor.resolve(selection)
    for path in extractor.cache_dir(spec).rglob("*.npz"):
        path.unlink()
    rebuild = client.post("/api/v1/domain-shift/jobs", json=cache_request | {"batch_size": 3})
    assert _wait_job(client, rebuild.json()["data"]["id"])["state"] == "completed"
    second = extractor.load(spec, datasets, [source_id, target_id], 1)
    np.testing.assert_allclose(
        first.filter(like="embedding_").values, second.filter(like="embedding_").values, atol=1e-6
    )
    other_context = context | {"model": selection | {"initialization_seed": 43}}
    assert (
        client.post("/api/v1/domain-shift/cache/status", json=cache_request | other_context).json()[
            "data"
        ]["missing_files"]
        == 2
    )


def test_direct_model_request_rejects_mixed_selection_and_invalid_seed(client):
    base = {"source_ids": [str(uuid4())], "feature_space": "model"}
    selection = {"model_type": "TestEncoder", "parameters": {}}
    for invalid in (
        selection | {"initialization_seed": -1},
        selection | {"experiment_id": str(uuid4()), "checkpoint_id": str(uuid4())},
        selection | {"layer": "unsupported"},
    ):
        response = client.post("/api/v1/domain-shift/jobs", json=base | {"model": invalid})
        assert response.status_code == 422


def _cpmlp_source(tmp_path):
    root, parameters = _model_source(tmp_path)
    (root / "models/CPMLP.py").write_text(
        "import torch\n"
        "class Model(torch.nn.Module):\n"
        "    def __init__(self, configs):\n"
        "        super().__init__()\n"
        "        self.input = torch.nn.Linear(configs.early_cycle_threshold * 3 * configs.charge_discharge_length, configs.d_model)\n"
        "        self.layers = torch.nn.ModuleList([torch.nn.Sequential(torch.nn.Linear(configs.d_model, configs.d_ff), torch.nn.ReLU(), torch.nn.Dropout(configs.dropout), torch.nn.Linear(configs.d_ff, configs.d_model)) for _ in range(configs.e_layers + configs.d_layers)])\n"
        "    def forward(self, curves, mask, return_embedding=False):\n"
        "        embedding = self.input(curves.flatten(1))\n"
        "        for layer in self.layers:\n"
        "            embedding = embedding + layer(embedding)\n"
        "        prediction = embedding.sum(dim=1)\n"
        "        return (prediction, embedding) if return_embedding else prediction\n",
        encoding="utf-8",
    )
    return root, parameters


def test_cpmlp_defaults_and_parameter_validation(client, settings, tmp_path):
    root, inputs = _cpmlp_source(tmp_path)
    extractor = ModelFeatureExtractor(
        replace(settings, batterylife_root=root),
        client.app.state.container.database.unit_of_work,
    )
    client.app.state.container.domain_shift.model_features = extractor
    options = client.get("/api/v1/domain-shift/architectures").json()["data"]
    option = next(item for item in options if item["model_type"] == "CPMLP")
    defaults = inputs | {"d_model": 128, "d_ff": 256, "e_layers": 4, "d_layers": 2, "dropout": 0.0}
    assert option["parameters"] == defaults
    assert set(option["required_parameters"]) == set(defaults)
    selection = {"model_type": "CPMLP", "parameters": inputs}
    resolved = extractor.resolve(selection)["parameters"]
    assert all(resolved[key] == value for key, value in defaults.items())
    empty = {key: None for key in ("d_ff", "d_model", "dropout", "e_layers", "d_layers")}
    with pytest.raises(DomainError) as error:
        extractor.resolve(selection | {"parameters": inputs | empty})
    assert error.value.symbol == "invalid_input"
    assert all(key in error.value.message for key in empty)
    for key, value in (
        ("d_model", "128"),
        ("d_ff", 128.0),
        ("d_model", 0),
        ("e_layers", True),
        ("d_layers", -1),
        ("dropout", "0.1"),
        ("dropout", 1.1),
    ):
        with pytest.raises(DomainError, match=key):
            extractor.resolve(selection | {"parameters": defaults | {key: value}})
    assert extractor.resolve(selection | {"parameters": defaults | {"dropout": 0.1, "e_layers": 0}})


def test_run_main_defaults_and_optional_null_parameters(client, settings, tmp_path):
    root, inputs = _model_source(tmp_path)
    path = root / "models/TestEncoder.py"
    source = path.read_text(encoding="utf-8")
    source = source.replace("3, bias=False)", "configs.d_model, bias=False)")
    source = source.replace(
        "        super().__init__()\n",
        "        super().__init__()\n        self.optional = configs.optional\n",
    )
    path.write_text(source, encoding="utf-8")
    (root / "run_main.py").write_text(
        "raise RuntimeError('must not import training entry point')\n"
        "parser.add_argument('--hidden-width', dest='d_model', type=int, default=17)\n"
        "parser.add_argument('--optional', default=None)\n",
        encoding="utf-8",
    )
    extractor = ModelFeatureExtractor(
        replace(settings, batterylife_root=root), client.app.state.container.database.unit_of_work
    )
    option = next(item for item in extractor.architectures() if item["model_type"] == "TestEncoder")
    assert option["parameters"] == inputs | {"d_model": 17, "optional": None}
    assert "optional" not in option["required_parameters"]
    specification = extractor.resolve(
        {"model_type": "TestEncoder", "parameters": option["parameters"]}
    )
    assert specification["parameters"]["optional"] is None


def test_cpmlp_default_parameters_support_real_inference(client, settings, tmp_path):
    pytest.importorskip("torch")
    root, _ = _cpmlp_source(tmp_path)
    container = client.app.state.container
    extractor = ModelFeatureExtractor(
        replace(settings, batterylife_root=root, training_python=Path(sys.executable)),
        container.database.unit_of_work,
    )
    container.domain_shift.model_features = extractor
    folder = settings.source_roots["demo"] / "source"
    folder.mkdir()
    _battery(folder / "source.pkl", "source", 0.0)
    container.catalog_indexer.index()
    source_id = next(
        item["id"]
        for item in client.get("/api/v1/data-sources?page_size=20").json()["data"]["items"]
        if item["name"] == "source"
    )
    option = next(
        item
        for item in client.get("/api/v1/domain-shift/architectures").json()["data"]
        if item["model_type"] == "CPMLP"
    )
    selection = {"model_type": "CPMLP", "parameters": option["parameters"]}
    request = {"source_ids": [source_id], "feature_space": "model", "model": selection}
    invalid = selection | {"parameters": option["parameters"] | {"d_model": None}}
    response = client.post("/api/v1/domain-shift/jobs", json=request | {"model": invalid})
    assert response.status_code == 422
    assert "d_model" in response.json()["message"]
    build = client.post("/api/v1/domain-shift/jobs", json=request)
    assert build.status_code == 200, build.text
    job = _wait_job(client, build.json()["data"]["id"])
    assert job["state"] == "completed", job["failed"] or job.get("error")
    datasets, _ = container.domain_shift._datasets([source_id])
    frame = extractor.load(extractor.resolve(selection), datasets, [source_id], 1)
    assert frame.filter(like="embedding_").shape == (5, 128)
    assert np.isfinite(frame.filter(like="embedding_").values).all()
