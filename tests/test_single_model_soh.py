import pickle

from batteryland.single_model.service import SingleModelService


def test_single_model_soh_curves_read_indexed_battery(client, settings) -> None:
    folder = settings.source_roots["demo"] / "MATR"
    folder.mkdir()
    path = folder / "cell-1.pkl"
    cycles = [
        {
            "cycle_number": index,
            "discharge_capacity_in_Ah": [0.0, capacity * 0.8, capacity],
        }
        for index, capacity in ((1, 2.0), (2, 1.8), (3, 1.6), (4, 1.4))
    ]
    with path.open("wb") as stream:
        pickle.dump({"cell_id": "cell-1", "cycle_data": cycles}, stream)

    client.app.state.container.catalog_indexer.index()
    response = client.post(
        "/api/v1/single-model/soh-curves",
        json={"dataset_name": "MATR", "file_names": ["cell-1.pkl"], "max_points": 50},
    )

    assert response.status_code == 200, response.text
    payload = response.json()["data"]
    assert payload["source_name"] == "MATR"
    assert payload["warnings"] == []
    assert payload["items"][0]["cell_id"] == "cell-1"
    assert payload["items"][0]["points"] == [
        {"cycle": 1.0, "soh": 1.0},
        {"cycle": 2.0, "soh": 0.9},
        {"cycle": 3.0, "soh": 0.8},
        {"cycle": 4.0, "soh": 0.7},
    ]


def test_single_model_soh_curves_report_unknown_dataset(client) -> None:
    response = client.post(
        "/api/v1/single-model/soh-curves",
        json={"dataset_name": "missing", "file_names": ["cell.pkl"]},
    )
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []
    assert "未找到数据集" in response.json()["data"]["warnings"][0]


def test_single_model_soh_curves_use_nominal_capacity_and_processed_cycle_index(
    client, settings
) -> None:
    folder = settings.source_roots["demo"] / "HNEI"
    folder.mkdir()
    path = folder / "cell-hnei.pkl"
    cycles = [
        {"cycle_number": raw_number, "discharge_capacity_in_Ah": [capacity]}
        for raw_number, capacity in ((13, 2.25), (14, 2.0), (15, 1.75))
    ]
    with path.open("wb") as stream:
        pickle.dump(
            {
                "cell_id": "cell-hnei",
                "nominal_capacity_in_Ah": 2.5,
                "cycle_data": cycles,
            },
            stream,
        )

    client.app.state.container.catalog_indexer.index()
    response = client.post(
        "/api/v1/single-model/soh-curves",
        json={"dataset_name": "HNEI", "file_names": ["cell-hnei.pkl"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["items"][0]["points"] == [
        {"cycle": 1.0, "soh": 0.9},
        {"cycle": 2.0, "soh": 0.8},
        {"cycle": 3.0, "soh": 0.7},
    ]


def test_single_model_soh_curves_smooth_isolated_drop(client, settings) -> None:
    folder = settings.source_roots["demo"] / "MATR"
    folder.mkdir()
    path = folder / "cell-spike.pkl"
    cycles = [
        {"cycle_number": index, "discharge_capacity_in_Ah": [capacity]}
        for index, capacity in ((1, 2.0), (2, 1.96), (3, 1.4), (4, 1.88), (5, 1.8))
    ]
    with path.open("wb") as stream:
        pickle.dump({"cell_id": "cell-spike", "cycle_data": cycles}, stream)

    client.app.state.container.catalog_indexer.index()
    response = client.post(
        "/api/v1/single-model/soh-curves",
        json={"dataset_name": "MATR", "file_names": ["cell-spike.pkl"]},
    )

    assert response.status_code == 200, response.text
    points = response.json()["data"]["items"][0]["points"]
    assert points[2]["soh"] == 0.96
    assert points[1]["soh"] == 0.98
    assert points[3]["soh"] == 0.94


def test_single_model_soh_curves_smooth_repeated_narrow_spikes() -> None:
    points = [
        {"cycle": float(index), "soh": value}
        for index, value in enumerate(
            (1.0, 0.995, 0.99, 0.94, 0.985, 0.93, 0.98, 0.925, 0.975, 0.97, 0.965),
            start=1,
        )
    ]

    smoothed = SingleModelService._smooth_curve(points)

    assert smoothed[3]["soh"] > 0.97
    assert smoothed[5]["soh"] > 0.96
    assert smoothed[7]["soh"] > 0.96
    assert smoothed[0]["soh"] == 1.0
