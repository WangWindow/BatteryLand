"""Exercise the trainable dataset catalog through the public ASGI API."""

import asyncio
import json
from pathlib import Path

import fastapi.dependencies.utils
import fastapi.routing
import httpx
import pytest

from batteryland.api.app import create_app
from batteryland.config import Settings


async def _exercise_catalog_flow(tmp_path: Path) -> None:
    source_root = tmp_path / "BatteryLife_Processed"
    second_root = tmp_path / "second-source"
    provider_root = tmp_path / "provider"
    split_root = provider_root / "datasets" / "batteryLife" / "data_split"
    calce = source_root / "CALCE"
    matr = source_root / "MATR"
    split_root.mkdir(parents=True)
    calce.mkdir(parents=True)
    matr.mkdir(parents=True)
    second_root.mkdir()
    for name in ("train.pkl", "validation.pkl", "test.pkl"):
        (calce / name).write_bytes(name.encode())
    for name in ("shared.pkl", "shared-test.pkl"):
        (matr / name).write_bytes(name.encode())
    (second_root / "shared.pkl").write_bytes(b"second source copy")

    ready_manifest = {
        "dataset": "Provider baseline",
        "train": ["train.pkl"],
        "val": ["validation.pkl"],
        "test": ["test.pkl"],
    }
    missing_manifest = {
        "dataset": "Provider with missing member",
        "train": ["not-present.pkl"],
        "val": ["validation.pkl"],
        "test": ["test.pkl"],
    }
    (split_root / "baseline.json").write_text(json.dumps(ready_manifest), encoding="utf-8")
    (split_root / "missing.json").write_text(json.dumps(missing_manifest), encoding="utf-8")

    settings = Settings(
        data_dir=tmp_path / "platform",
        source_roots={"battery_life": source_root, "other": second_root},
        provider_root=provider_root,
        auto_index_catalog=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        app.state.container.catalog_indexer.index()
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://batteryland") as client:
            listing = await client.get("/api/v1/splits", params={"page_size": 100})
            assert listing.status_code == 200
            splits = listing.json()["data"]["items"]
            by_name = {item["name"]: item for item in splits}
            baseline = by_name["Provider baseline"]
            missing = by_name["Provider with missing member"]

            assert baseline["origin"] == "builtin"
            assert baseline["read_only"] is True
            assert baseline["execution_ready"] is True
            assert baseline["counts"] == {"train": 1, "val": 1, "test": 1}
            searched_members = await client.get(
                f"/api/v1/splits/{baseline['id']}/members",
                params={"partition": "train", "q": "train"},
            )
            assert searched_members.status_code == 200
            assert [item["file_name"] for item in searched_members.json()["data"]["items"]] == [
                "train.pkl"
            ]
            empty_search = await client.get(
                f"/api/v1/splits/{baseline['id']}/members",
                params={"partition": "train", "q": "not-present"},
            )
            assert empty_search.json()["data"]["total"] == 0
            assert missing["execution_ready"] is False
            assert missing["resolution"]["missing"] == 1
            missing_detail = await client.get(f"/api/v1/splits/{missing['id']}")
            assert missing_detail.json()["data"]["statistics"] is None

            exported = await client.get(f"/api/v1/splits/{baseline['id']}/export")
            assert exported.json() == ready_manifest
            deleted = await client.delete(f"/api/v1/splits/{baseline['id']}")
            assert deleted.status_code == 409
            rejected_run = await client.post(
                "/api/v1/training/validation",
                json={
                    "config_text": "{}",
                    "split_id": missing["id"],
                    "split_version": missing["version"],
                },
            )
            assert rejected_run.status_code == 409

            candidates_response = await client.get(
                "/api/v1/batteries", params={"q": "shared.pkl", "page_size": 20}
            )
            candidates = candidates_response.json()["data"]["items"]
            assert len(candidates) == 2

            imported_manifest = {
                "dataset": "Imported baseline",
                "train": ["train.pkl"],
                "val": ["shared.pkl"],
                "test": ["test.pkl"],
            }
            upload = {
                "file": (
                    "import.json",
                    json.dumps(imported_manifest).encode(),
                    "application/json",
                )
            }
            preview = await client.post("/api/v1/splits/import/preview", files=upload)
            preview_data = preview.json()["data"]
            assert preview.status_code == 200
            assert preview_data["execution_ready"] is False
            assert preview_data["resolution"]["ambiguous"] == 1
            assert len(preview_data["resolution"]["issues"][0]["candidates"]) == 2

            unresolved = await client.post("/api/v1/splits/import", files=upload)
            assert unresolved.status_code == 422

            binding = {"shared.pkl": candidates[0]["id"]}
            resolved_preview = await client.post(
                "/api/v1/splits/import/preview",
                files=upload,
                data={"member_bindings": json.dumps(binding)},
            )
            assert resolved_preview.json()["data"]["execution_ready"] is True
            imported = await client.post(
                "/api/v1/splits/import",
                files=upload,
                data={"member_bindings": json.dumps(binding)},
            )
            assert imported.status_code == 201
            imported_split = imported.json()["data"]
            assert imported_split["origin"] == "imported"
            assert imported_split["execution_ready"] is True
            assert imported_split["counts"] == {"train": 1, "val": 1, "test": 1}
            exported_import = await client.get(f"/api/v1/splits/{imported_split['id']}/export")
            assert exported_import.json() == imported_manifest

            payload = imported_split["payload"]
            assigned = {part: payload[part] for part in ("train", "val", "test")}
            source_members = {source["id"]: [] for source in imported_split["sources"]}
            batteries = (await client.get("/api/v1/batteries", params={"page_size": 200})).json()[
                "data"
            ]["items"]
            source_by_battery = {battery["id"]: battery["source_id"] for battery in batteries}
            for members in assigned.values():
                for battery_id in members:
                    source_members[source_by_battery[battery_id]].append(battery_id)
            update_body = {
                "name": "Imported revised",
                "source_selections": [
                    {
                        "source_id": source["id"],
                        "expected_revision": source["revision"],
                        "battery_ids": source_members[source["id"]],
                    }
                    for source in imported_split["sources"]
                ],
                "method": "manual",
                "partitions": assigned,
                "expected_revision": 1,
            }
            revised = await client.put(f"/api/v1/splits/{imported_split['id']}", json=update_body)
            assert revised.status_code == 200
            assert revised.json()["data"]["version"] == 2
            assert revised.json()["data"]["origin"] == "imported"
            old_export = await client.get(
                f"/api/v1/splits/{imported_split['id']}/export", params={"version": 1}
            )
            assert old_export.json() == imported_manifest
            new_export = await client.get(f"/api/v1/splits/{imported_split['id']}/export")
            assert new_export.json() == imported_manifest | {"dataset": "Imported revised"}

            detail = await client.get(f"/api/v1/splits/{imported_split['id']}")
            assert detail.json()["data"]["statistics"]["scopes"]["all"]["sample_count"] == 3


def test_builtin_and_imported_datasets_share_the_public_trainable_catalog(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    # Python 3.14's worker thread bridge can stall in this constrained test runtime.
    # Keep the API exercised through ASGI while running its synchronous handlers inline.
    monkeypatch.setattr(fastapi.routing, "run_in_threadpool", run_inline)
    monkeypatch.setattr(fastapi.dependencies.utils, "run_in_threadpool", run_inline)
    asyncio.run(_exercise_catalog_flow(tmp_path))
