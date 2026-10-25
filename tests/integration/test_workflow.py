import json
import math
import time

from fastapi.testclient import TestClient
from tests.integration.test_scheduler import ControlledTraining, advance
from tests.integration.test_splits_api import setup_batteries

from batteryland.application.bundled import BundledImportService
from batteryland.config import Settings
from batteryland.infrastructure.bundled import load_bundled
from batteryland.interfaces.api.app import create_app


def test_resource_to_frozen_execution_and_result_traceability(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        source, ids = setup_batteries(client)
        split_body = {
            "name": "workflow",
            "source_id": source,
            "expected_source_revision": client.get("/api/v1/data-sources").json()["data"]["items"][
                0
            ]["revision"],
            "battery_ids": ids,
            "method": "manual",
            "partitions": {"train": ids[:2], "val": ids[2:3], "test": ids[3:]},
        }
        split = client.post("/api/v1/splits", json=split_body).json()["data"]
        config = {"mate": {"device": "cpu", "seed": 42}, "task": {"type": "MyTask"}}
        template = client.post(
            "/api/v1/templates", json={"name": "workflow", "native_config": config}
        ).json()["data"]
        bindings = {
            "split": {"id": split["id"], "version": 1},
            "template": {"id": template["id"], "version": 1},
        }
        experiment = client.post(
            "/api/v1/experiments", json={"name": "workflow", "bindings": bindings}
        ).json()["data"]
        identity = experiment["id"]
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [identity]}
        ).raise_for_status()
        changed = split_body | {
            "expected_revision": 1,
            "partitions": {"train": ids[:1], "val": ids[1:3], "test": ids[3:]},
        }
        client.put(f"/api/v1/splits/{split['id']}", json=changed).raise_for_status()
        client.put(
            f"/api/v1/templates/{template['id']}",
            json={"name": "workflow", "native_config": {"changed": True}, "expected_revision": 1},
        ).raise_for_status()
        assert (
            client.get(f"/api/v1/experiments/{identity}").json()["data"]["native_config"] == config
        )
        assert advance(app.state.container, client, [identity]) == ["succeeded"]
        directory = settings.data_dir / "runs" / identity
        (directory / "best_result.json").write_text(
            json.dumps(
                {
                    "epoch": 1,
                    "test": {"ABC": 0.5},
                    "test_predictions": [{"file_name": "d.pkl", "prediction": 5, "target": 6}],
                }
            )
        )
        (directory / "metrics.jsonl").write_text('{"epoch":1,"test":{"ABC":0.5}}\n')
        app.state.container.results.collect(identity)
        result = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
        assert result["predictions"][0]["battery_id"] == ids[-1]
        assert result["sources"][0]["result_version"] == 1
        assert client.get(f"/api/v1/splits/{split['id']}/export", params={"version": 1}).json()[
            "train"
        ] == ["a.pkl", "b.pkl"]
        for kind in ("metric_bar", "epoch_line", "prediction_scatter"):
            response = client.post(
                "/api/v1/charts",
                json={
                    "chart_type": kind,
                    "experiment_ids": [identity],
                    "metric": "ABC",
                    "stage": "test",
                },
            )
            assert response.status_code == 200 and response.json()["data"]["charts"]
        artifacts = client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
        assert any(item["kind"] == "input_manifest" for item in artifacts)
        assert client.delete(f"/api/v1/splits/{split['id']}").status_code == 409


def test_common_queries_benchmark_and_no_document_scans(settings: Settings, monkeypatch):
    app = create_app(settings, start_monitor=False)
    with TestClient(app) as client:
        container = app.state.container
        source = container.resources.create_source("benchmark", "demo")
        summary = BundledImportService(
            container.resources, container.splits, container.configurations
        ).import_catalog(
            source["id"], load_bundled(settings.provider_root, settings.source_roots["demo"])
        )
        assert summary["batteries"]["imported"] == 1001 and summary["splits"]["imported"] == 23
        for index in range(100):
            container.experiments.create(
                {
                    "name": f"benchmark-{index}",
                    "native_config": {
                        "mate": {"device": "cpu"},
                        "model": {"type": "cpmlp"},
                        "task": {"type": "BatteryLifeRun"},
                    },
                }
            )

        def no_scan(*args, **kwargs):
            raise AssertionError("A common query scanned document or artifact content")

        monkeypatch.setattr(container.documents, "read", no_scan)
        monkeypatch.setattr(container.results.files, "scan", no_scan)
        queries = [
            ("/api/v1/batteries", {"source_id": source["id"], "page_size": 50}),
            (
                "/api/v1/experiments",
                {"model_type": "cpmlp", "state": "draft", "requested_device": "cpu"},
            ),
        ]
        for endpoint, params in queries:
            assert client.get(endpoint, params=params).status_code == 200
        timings = []
        for index in range(100):
            endpoint, params = queries[index % len(queries)]
            start = time.perf_counter()
            response = client.get(endpoint, params=params)
            timings.append(time.perf_counter() - start)
            assert response.status_code == 200
            assert response.json()["data"]["total"] == (1001 if index % 2 == 0 else 100)
        p95 = sorted(timings)[math.ceil(len(timings) * 0.95) - 1]
        print(
            f"\n1001 batteries / 23 splits / 100 experiments / 100 common queries: p95={p95:.6f}s"
        )
        assert p95 <= 2
