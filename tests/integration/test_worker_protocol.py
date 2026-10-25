from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient

from batteryland.domain.validation_receipt import issue_receipt
from batteryland.interfaces.api.app import create_app

CONFIG = "mate:\n  device: auto\n"
SPLIT = '{"dataset":"demo","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'
COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"


def test_atomic_single_claim_and_idempotent_start_event(settings):
    configured = replace(settings, validation_secret="secret", service_token="worker-secret")
    headers = {"Authorization": "Bearer worker-secret"}
    with TestClient(create_app(configured, start_monitor=False)) as client:
        identities = []
        for name in ("first", "second"):
            receipt = issue_receipt(CONFIG, SPLIT, COMMIT, [], "secret")
            response = client.post(
                "/api/v1/validated-experiments",
                json={"name": name, "config_text": CONFIG, "split_text": SPLIT, "receipt": receipt},
            )
            assert response.status_code == 201, response.text
            identity = response.json()["data"]["id"]
            assert (
                client.post(f"/api/v1/validated-experiments/{identity}/submit").status_code == 202
            )
            identities.append(identity)
        node = str(uuid4())
        heartbeat = client.put(
            f"/api/v1/worker/nodes/{node}",
            headers=headers,
            json={
                "cpu_percent": 8.0,
                "memory_total": 100,
                "memory_available": 80,
                "gpus": [
                    {"cuda_index": 0, "uuid": "GPU-test", "total_bytes": 1000, "free_bytes": 900}
                ],
            },
        )
        assert heartbeat.status_code == 200, heartbeat.text
        queue = client.get("/api/v1/queue").json()["data"]["waiting"]
        first = queue[0]
        request_id = str(uuid4())
        claim_body = {
            "experiment_id": first["id"],
            "expected_revision": first["revision"],
            "node_id": node,
            "resolved_device": "cuda:0",
            "request_id": request_id,
        }
        claimed = client.post("/api/v1/worker/claims", headers=headers, json=claim_body)
        assert claimed.status_code == 201, claimed.text
        data = claimed.json()["data"]
        assert data["input"]["config_text"] == CONFIG
        assert data["requested_device"] == "auto"
        assert data["resolved_device"] == "cuda:0"
        repeated = client.post("/api/v1/worker/claims", headers=headers, json=claim_body)
        assert repeated.status_code == 200
        assert repeated.json()["data"]["claim_token"] == data["claim_token"]
        other = next(item for item in queue if item["id"] != first["id"])
        blocked = client.post(
            "/api/v1/worker/claims",
            headers=headers,
            json={
                **claim_body,
                "experiment_id": other["id"],
                "expected_revision": other["revision"],
                "request_id": str(uuid4()),
            },
        )
        assert blocked.status_code == 409
        started_event = {
            "event_id": str(uuid4()),
            "claim_token": data["claim_token"],
            "expected_revision": data["revision"],
            "kind": "started",
            "data": {
                "receipt": {
                    "experiment_id": first["id"],
                    "intent_id": data["intent_id"],
                    "started_at": "2026-01-01T00:00:00Z",
                    "pid": 123,
                }
            },
        }
        started = client.post(
            f"/api/v1/worker/experiments/{first['id']}/events",
            headers=headers,
            json=started_event,
        )
        assert started.status_code == 200, started.text
        assert started.json()["data"]["state"] == "running"
        repeated_start = client.post(
            f"/api/v1/worker/experiments/{first['id']}/events",
            headers=headers,
            json=started_event,
        )
        assert repeated_start.status_code == 200
        assert repeated_start.json()["data"]["revision"] == started.json()["data"]["revision"]
        unproven = client.post(
            f"/api/v1/worker/experiments/{first['id']}/events",
            headers=headers,
            json={
                "event_id": str(uuid4()),
                "claim_token": data["claim_token"],
                "expected_revision": started.json()["data"]["revision"],
                "kind": "device_observed",
                "data": {"gpu_uuid": "GPU-test"},
            },
        )
        assert unproven.status_code == 409
        assert (
            client.put(
                f"/api/v1/worker/nodes/{node}",
                headers=headers,
                json={
                    "cpu_percent": 8.0,
                    "memory_total": 100,
                    "memory_available": 80,
                    "gpus": [
                        {
                            "cuda_index": 0,
                            "uuid": "GPU-test",
                            "total_bytes": 1000,
                            "free_bytes": 900,
                            "process_pids": [123],
                        }
                    ],
                },
            ).status_code
            == 200
        )
        observed = client.post(
            f"/api/v1/worker/experiments/{first['id']}/events",
            headers=headers,
            json={
                "event_id": str(uuid4()),
                "claim_token": data["claim_token"],
                "expected_revision": started.json()["data"]["revision"],
                "kind": "device_observed",
                "data": {"gpu_uuid": "GPU-test"},
            },
        )
        assert observed.status_code == 200, observed.text
        assert (
            client.get(f"/api/v1/validated-experiments/{first['id']}").json()["data"][
                "actual_gpu_uuid"
            ]
            == "GPU-test"
        )
        result_body = {
            "claim_token": data["claim_token"],
            "result": {
                "epoch": 1,
                "test": {"ABC": 0.5},
                "test_predictions": [{"file_name": "c.pkl", "prediction": 9, "target": 10}],
            },
        }
        report = client.put(
            f"/api/v1/worker/experiments/{first['id']}/result",
            headers=headers,
            json=result_body,
        )
        assert report.status_code == 200, report.text
        assert (
            client.put(
                f"/api/v1/worker/experiments/{first['id']}/result",
                headers=headers,
                json=result_body,
            ).status_code
            == 200
        )
        public_result = client.get(f"/api/v1/experiments/{first['id']}/results")
        assert public_result.status_code == 200
        assert public_result.json()["data"]["metrics"][0]["name"] == "ABC"
        chunk = {"claim_token": data["claim_token"], "offset": 0, "text": "line one\n"}
        assert (
            client.put(
                f"/api/v1/worker/experiments/{first['id']}/logs/console",
                headers=headers,
                json=chunk,
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/v1/worker/experiments/{first['id']}/logs/console",
                headers=headers,
                json=chunk,
            ).status_code
            == 200
        )
        logs = client.get(f"/api/v1/experiments/{first['id']}/logs", params={"stream": "console"})
        assert logs.status_code == 200
        assert logs.json()["data"]["text"] == "line one\n"
        metric_chunk = {
            "claim_token": data["claim_token"],
            "offset": 0,
            "text": '{"epoch":1,"test":{"ABC":0.5}}\n',
        }
        assert (
            client.put(
                f"/api/v1/worker/experiments/{first['id']}/metrics",
                headers=headers,
                json=metric_chunk,
            ).status_code
            == 200
        )
        assert (
            client.put(
                f"/api/v1/worker/experiments/{first['id']}/metrics",
                headers=headers,
                json=metric_chunk,
            ).status_code
            == 200
        )
        metrics = client.get(f"/api/v1/experiments/{first['id']}/metrics")
        assert metrics.status_code == 200
        assert metrics.json()["data"]["total"] == 1
        import hashlib

        artifact_content = b"model weights"
        artifact_hash = hashlib.sha256(artifact_content).hexdigest()
        upload = client.post(
            f"/api/v1/worker/experiments/{first['id']}/artifacts",
            headers=headers,
            data={
                "claim_token": data["claim_token"],
                "kind": "checkpoint",
                "sha256": artifact_hash,
            },
            files={"file": ("weights.bin", artifact_content)},
        )
        assert upload.status_code == 201, upload.text
        repeated_upload = client.post(
            f"/api/v1/worker/experiments/{first['id']}/artifacts",
            headers=headers,
            data={
                "claim_token": data["claim_token"],
                "kind": "checkpoint",
                "sha256": artifact_hash,
            },
            files={"file": ("weights.bin", artifact_content)},
        )
        assert repeated_upload.status_code == 201
        assert repeated_upload.json()["data"]["id"] == upload.json()["data"]["id"]
        listed = client.get(f"/api/v1/experiments/{first['id']}/artifacts")
        assert any(item["id"] == upload.json()["data"]["id"] for item in listed.json()["data"])
        finished = client.post(
            f"/api/v1/worker/experiments/{first['id']}/events",
            headers=headers,
            json={
                "event_id": str(uuid4()),
                "claim_token": data["claim_token"],
                "expected_revision": started.json()["data"]["revision"],
                "kind": "finished",
                "data": {"result": "succeeded", "exit_code": 0},
            },
        )
        assert finished.status_code == 200, finished.text
        assert finished.json()["data"]["state"] == "succeeded"
        assert client.post(f"/api/v1/validated-experiments/{first['id']}/submit").status_code == 409


def test_stop_between_claim_and_start_receipt_preserves_process_identity(settings):
    configured = replace(settings, validation_secret="secret", service_token="worker-secret")
    headers = {"Authorization": "Bearer worker-secret"}
    with TestClient(create_app(configured, start_monitor=False)) as client:
        receipt = issue_receipt(CONFIG, SPLIT, COMMIT, [], "secret")
        created = client.post(
            "/api/v1/validated-experiments",
            json={"name": "race", "config_text": CONFIG, "split_text": SPLIT, "receipt": receipt},
        )
        identity = created.json()["data"]["id"]
        client.post(f"/api/v1/validated-experiments/{identity}/submit").raise_for_status()
        node = str(uuid4())
        client.put(
            f"/api/v1/worker/nodes/{node}",
            headers=headers,
            json={
                "cpu_percent": 1,
                "memory_total": 100,
                "memory_available": 90,
                "gpus": [
                    {"cuda_index": 0, "uuid": "GPU-test", "total_bytes": 1000, "free_bytes": 900}
                ],
            },
        ).raise_for_status()
        queued = client.get("/api/v1/queue").json()["data"]["waiting"][0]
        claimed = client.post(
            "/api/v1/worker/claims",
            headers=headers,
            json={
                "experiment_id": identity,
                "expected_revision": queued["revision"],
                "node_id": node,
                "resolved_device": "cuda:0",
                "request_id": str(uuid4()),
            },
        ).json()["data"]
        stopped = client.post(f"/api/v1/experiments/{identity}/stop")
        assert stopped.status_code == 202
        assert stopped.json()["data"]["state"] == "stopping"
        started = client.post(
            f"/api/v1/worker/experiments/{identity}/events",
            headers=headers,
            json={
                "event_id": str(uuid4()),
                "claim_token": claimed["claim_token"],
                "expected_revision": claimed["revision"],
                "kind": "started",
                "data": {
                    "receipt": {
                        "experiment_id": identity,
                        "intent_id": claimed["intent_id"],
                        "pid": 123,
                    }
                },
            },
        )
        assert started.status_code == 200, started.text
        assert started.json()["data"]["state"] == "stopping"
        active = client.get(f"/api/v1/worker/nodes/{node}/active", headers=headers)
        assert active.json()["data"][0]["state"] == "stopping"
