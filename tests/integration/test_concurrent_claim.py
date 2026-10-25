from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from batteryland.experiments.receipt import issue_receipt

CONFIG = "mate:\n  device: cuda:0\n"
SPLIT = '{"dataset":"demo","train":["a"],"val":["b"],"test":["c"]}'
COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"


def test_competing_worker_claims_reserve_only_one_serial_slot(settings):
    configured = replace(settings, validation_secret="secret", service_token="token")
    headers = {"Authorization": "Bearer token"}
    with TestClient(create_app(configured, start_monitor=False)) as client:
        for number in range(2):
            created = client.post(
                "/api/v1/validated-experiments",
                json={
                    "name": f"run-{number}",
                    "config_text": CONFIG,
                    "split_text": SPLIT,
                    "receipt": issue_receipt(CONFIG, SPLIT, COMMIT, [], "secret"),
                },
            )
            identity = created.json()["data"]["id"]
            client.post(f"/api/v1/validated-experiments/{identity}/submit").raise_for_status()
        node = str(uuid4())
        client.put(
            f"/api/v1/worker/nodes/{node}",
            headers=headers,
            json={
                "gpus": [
                    {
                        "cuda_index": 0,
                        "uuid": "GPU-0",
                        "total_bytes": 1000,
                        "free_bytes": 900,
                    }
                ],
            },
        ).raise_for_status()
        queue = client.get("/api/v1/queue").json()["data"]["waiting"]

        def attempt(item):
            return client.post(
                "/api/v1/worker/claims",
                headers=headers,
                json={
                    "experiment_id": item["id"],
                    "expected_revision": item["revision"],
                    "node_id": node,
                    "resolved_device": "cuda:0",
                    "request_id": str(uuid4()),
                },
            ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(attempt, queue))
        assert sorted(statuses) == [201, 409]
        assert len(client.get("/api/v1/queue").json()["data"]["active"]) == 1
