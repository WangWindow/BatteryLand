"""The three original pages share the BatteryLand origin and keep source data read-only."""

import json
import os
import pickle
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from batteryland.config import Settings
from batteryland.data_layer.web import create_data_layer_app


def test_data_layer_routes_and_catalog(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "Life labels").mkdir(parents=True)
    (source / "MATR").mkdir()
    name = "MATR_example.pkl"
    (source / "Life labels" / "labels.json").write_text(
        json.dumps({name: 25}), encoding="utf-8"
    )
    cycle = {
        "cycle_number": 1,
        "time_in_s": [0, 60, 120],
        "voltage_in_V": [3.0, 3.1, 3.2],
        "current_in_A": [1.0, 1.0, 1.0],
        "discharge_capacity_in_Ah": [0.0, 0.5, 1.0],
        "charge_capacity_in_Ah": [0.0, 0.5, 1.0],
    }
    with (source / "MATR" / name).open("wb") as stream:
        pickle.dump({"cycle_data": [cycle, {**cycle, "cycle_number": 3}]}, stream)
    before = {path: path.stat().st_mtime_ns for path in source.rglob("*") if path.is_file()}
    output = tmp_path / "var"
    environment = dict(os.environ, BATTERYLAND_SOURCE_ROOTS=json.dumps({"battery_life": str(source)}))
    subprocess.run(
        [sys.executable, "-m", "batteryland.data_layer.prepare", "--output", str(output / "data-layer")],
        check=True,
        env=environment,
        capture_output=True,
        text=True,
    )
    settings = Settings(data_dir=output, source_roots={"battery_life": source}, auto_index_catalog=False)
    app = FastAPI()
    app.mount("/data-layer", create_data_layer_app(settings))
    with TestClient(app) as client:
        for url, title in (
            ("/data-layer/", "电池寿命与循环数据"),
            ("/data-layer/overview", "电池数据组成"),
            ("/data-layer/trends", "多电池退化曲线"),
        ):
            response = client.get(url)
            assert response.status_code == 200
            assert title in response.text
            assert "/data-layer/site-config.js" in response.text
        assert client.get("/data-layer/site-config.js").status_code == 200
        assert client.get("/data-layer/api/catalog").json()["sources"]["MATR"][0]["name"] == name
        overview = client.get("/data-layer/api/overview").json()
        assert overview["ready"] is True
        assert overview["unique_cells"] == 1
        summary = client.get("/data-layer/api/summary", params={"source": "MATR", "cell": name}).json()
        assert [row[0] for row in summary["cycles"]] == [1, 3]
        sample = client.get(
            "/data-layer/api/cycle", params={"source": "MATR", "cell": name, "index": 1}
        ).json()
        assert sample["number"] == 3
        assert client.get("/data-layer/api/trajectories").status_code == 200
        assert client.get("/data-layer/api/delivery-status").json()["ready"] is True
        assert client.get("/data-layer/download/delivery-manifest.csv").status_code == 200
        assert client.get("/data-layer/intake").status_code == 404
        assert client.get("/data-layer/api/intake/records").status_code == 404
        assert client.post("/data-layer/api/intake/save", json={}).status_code == 404
    assert before == {path: path.stat().st_mtime_ns for path in source.rglob("*") if path.is_file()}
    assert (output / "data-layer" / "catalog.sqlite3").is_file()
