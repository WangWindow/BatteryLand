import base64
import json

from fastapi.testclient import TestClient
from test_scheduler import ControlledTraining, advance, draft

from batteryland.config import Settings
from batteryland.interfaces.api.app import create_app


def prepare_completed(client, container):
    entry = draft(client, "results")
    client.post(
        "/api/v1/queue/submissions", json={"experiment_ids": [entry["id"]]}
    ).raise_for_status()
    assert advance(container, client, [entry["id"]]) == ["succeeded"]
    return entry["id"]


def test_incremental_metrics_wait_for_complete_lines_and_do_not_duplicate(settings: Settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        path = settings.data_dir / "runs" / identity / "metrics.jsonl"
        path.write_bytes(b'{"epoch":1,"train":{"loss":0.5},"test":{"mape":0.1')
        endpoint = f"/api/v1/experiments/{identity}/metrics"
        assert client.get(endpoint).status_code == 200
        app.state.container.results.collect(identity)
        assert client.get(endpoint).json()["data"]["total"] == 0
        with path.open("ab") as stream:
            stream.write(b"}}\n")
        app.state.container.results.collect(identity)
        app.state.container.results.collect(identity)
        assert client.get(endpoint).json()["data"]["total"] == 2
        path.write_text('{"epoch":2,"train":{"loss":0.25}}\n')
        app.state.container.results.collect(identity)
        assert client.get(endpoint).json()["data"]["total"] == 1
        assert client.get(endpoint).json()["data"]["items"][0]["epoch"] == 2


def test_result_versions_preserve_units_granularity_and_provenance(settings: Settings):
    training = ControlledTraining(settings)
    app = create_app(settings, training=training, start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        directory = settings.data_dir / "runs" / identity
        value = {
            "epoch": 2,
            "test": {"mape": 0.1, "ABC": None},
            "units": {"mape": "ratio", "ABC": "unknown"},
            "metric_granularity": "window",
            "test_predictions_aggregation": "mean_by_battery",
            "test_predictions": [{"file_name": "a.pkl", "prediction": 100, "target": None}],
        }
        (directory / "best_result.json").write_text(json.dumps(value))
        app.state.container.results.collect(identity)
        result = client.get(f"/api/v1/experiments/{identity}/results")
        assert result.status_code == 200
        first = result.json()["data"]
        assert first["available"] and first["version"] == 1
        assert first["metrics"][0]["value"] == 0.1
        assert first["metrics"][0]["unit"] == "ratio"
        assert first["metrics"][0]["granularity"] == "window"
        assert first["predictions"][0]["target"] is None
        assert first["sources"][0]["source_hash"]
        app.state.container.results.collect(identity)
        assert client.get(f"/api/v1/experiments/{identity}/results").json()["data"]["version"] == 1
        (directory / "best_result.json").write_text('{"test":{"bad":NaN}}')
        app.state.container.results.collect(identity)
        preserved = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
        assert preserved["available"] and preserved["version"] == 1
        assert client.get(f"/api/v1/experiments/{identity}").json()["data"]["state"] == "succeeded"
        assert client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]


def test_log_cursors_validate_identity_and_stream_ends(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        app.state.container.results.collect(identity)
        endpoint = f"/api/v1/experiments/{identity}/logs"
        first = client.get(endpoint, params={"stream": "console", "limit_bytes": 4})
        assert first.status_code == 200
        cursor = first.json()["data"]["next_cursor"]
        second = client.get(endpoint, params={"stream": "console", "cursor": cursor})
        assert first.json()["data"]["text"] + second.json()["data"]["text"] == "started\ndone\n"
        assert second.json()["data"]["eof"] is True
        stream = client.get(endpoint + "/stream", params={"stream": "console"})
        assert "event: log" in stream.text and "event: end" in stream.text
        path = settings.data_dir / "runs" / identity / "console.log"
        path.write_text("replaced")
        assert (
            client.get(endpoint, params={"stream": "console", "cursor": cursor}).status_code == 409
        )


def test_optional_result_sections_and_failed_metrics_replacement(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        directory = settings.data_dir / "runs" / identity
        collector = app.state.container.results
        (directory / "best_result.json").write_text(
            json.dumps({"test_predictions": [{"file_name": "only.pkl", "prediction": 7}]})
        )
        collector.collect(identity)
        first = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
        assert first["metrics"] == [] and first["predictions"][0]["target"] is None
        artifact_id = first["sources"][0]["source_artifact_id"]
        evidence = client.get(f"/api/v1/artifacts/{artifact_id}/download").content
        assert json.loads(evidence)["test_predictions"][0]["prediction"] == 7
        (directory / "metrics.jsonl").write_text('{"epoch":1,"train":{"loss":1}}\n')
        collector.collect(identity)
        (directory / "metrics.jsonl").write_text('{"epoch":2,"train":{"loss":NaN}}\n')
        collector.collect(identity)
        metrics = client.get(f"/api/v1/experiments/{identity}/metrics").json()["data"]
        assert metrics["total"] == 1 and metrics["items"][0]["epoch"] == 1
        (directory / "best_result.json").write_text('{"test":{"ABC":null}}')
        (directory / "metrics.jsonl").unlink()
        collector.collect(identity)
        second = client.get(f"/api/v1/experiments/{identity}/results").json()["data"]
        assert second["version"] == 2 and second["metrics"][0]["value"] is None
        assert client.get(f"/api/v1/artifacts/{artifact_id}/download").content == evidence


def test_utf8_log_chunks_and_empty_stream_cursor(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        endpoint = f"/api/v1/experiments/{identity}/logs"
        empty = client.get(endpoint).json()["data"]
        assert empty["text"] == "" and empty["eof"]
        assert client.get(endpoint, params={"cursor": empty["next_cursor"]}).status_code == 200
        path = settings.data_dir / "runs" / identity / "console.log"
        path.write_text("训练进行中\n")
        cursor = None
        text = ""
        for _ in range(20):
            chunk = client.get(
                endpoint,
                params={
                    "stream": "console",
                    "limit_bytes": 1,
                    **({"cursor": cursor} if cursor else {}),
                },
            ).json()["data"]
            text += chunk["text"]
            cursor = chunk["next_cursor"]
            if chunk["eof"]:
                break
        assert text == "训练进行中\n"


def test_invalid_final_result_does_not_block_valid_epoch_metrics(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        directory = settings.data_dir / "runs" / identity
        (directory / "best_result.json").write_text('{"test":{"bad":NaN}}')
        (directory / "metrics.jsonl").write_text('{"epoch":1,"test":{"ABC":5}}\n')
        app.state.container.results.collect(identity)
        metrics = client.get(f"/api/v1/experiments/{identity}/metrics").json()["data"]
        assert metrics["total"] == 1 and metrics["items"][0]["value"] == 5
        details = client.get(f"/api/v1/experiments/{identity}").json()["data"]
        assert details["state"] == "succeeded" and details["collection"]["status"] == "error"


def test_sse_validates_both_cursor_sources(settings: Settings):
    app = create_app(settings, training=ControlledTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        identity = prepare_completed(client, app.state.container)
        endpoint = f"/api/v1/experiments/{identity}/logs"
        cursor = client.get(endpoint, params={"stream": "console"}).json()["data"]["next_cursor"]
        wrong = json.loads(base64.urlsafe_b64decode(cursor))
        wrong["experiment"] = "another-experiment"
        invalid = base64.urlsafe_b64encode(json.dumps(wrong).encode()).decode()
        response = client.get(
            endpoint + "/stream",
            params={"stream": "console", "cursor": invalid},
            headers={"Last-Event-ID": cursor},
        )
        assert response.status_code == 409 and response.json()["data"]["error"] == "cursor_invalid"


def test_frozen_provider_identity_is_applied_to_component_artifacts(settings: Settings):
    class ComponentsTraining(ControlledTraining):
        def validate(self, config, resources):
            return super().validate(config, resources) | {
                "components": [
                    {
                        "scope": "model",
                        "type": "sample",
                        "origin": "builtin",
                        "path": "model.py",
                        "source_hash": "fixed-source",
                    }
                ]
            }

    app = create_app(settings, training=ComponentsTraining(settings), start_monitor=False)
    with TestClient(app) as client:
        entry = client.post(
            "/api/v1/experiments",
            json={
                "name": "component provenance",
                "native_config": {
                    "mate": {"device": "cpu"},
                    "task": {"type": "MyTask"},
                    "model": {"type": "sample"},
                },
            },
        ).json()["data"]
        identity = entry["id"]
        client.post(
            "/api/v1/queue/submissions", json={"experiment_ids": [identity]}
        ).raise_for_status()
        assert advance(app.state.container, client, [identity]) == ["succeeded"]
        directory = settings.data_dir / "runs" / identity
        (directory / "best_result.json").write_text('{"epoch":1,"test":{"ABC":2}}')
        (directory / "checkpoint").mkdir()
        (directory / "checkpoint/model.bin").write_bytes(b"opaque-checkpoint")
        app.state.container.results.collect(identity)
        assert client.get(f"/api/v1/experiments/{identity}/results").json()["data"]["available"]
        artifact = next(
            item
            for item in client.get(f"/api/v1/experiments/{identity}/artifacts").json()["data"]
            if item["name"] == "model.bin"
        )
        with app.state.container.database.unit_of_work() as unit:
            component = unit.artifacts.component(artifact["component_id"])
        assert component["provider_commit"] == "controlled-test"
