import pickle
import time
from pathlib import Path

from fastapi.testclient import TestClient


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
