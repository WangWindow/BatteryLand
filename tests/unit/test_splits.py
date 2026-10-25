from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.common.storage import LocalSourceFiles
from batteryland.datasets.service import ResourceService
from batteryland.datasets.split_rules import make_split
from batteryland.datasets.splits import SplitService
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore


def source_selection(
    source_id: str, revision: int, battery_ids: list[str] | None = None, include_all: bool = False
) -> list[dict[str, object]]:
    return [
        {
            "source_id": source_id,
            "expected_revision": revision,
            "battery_ids": battery_ids or [],
            "include_all": include_all,
        }
    ]


def test_seeded_split_is_repeatable_and_preserves_all_members() -> None:
    ids = [str(index) for index in range(11)]
    options = {"method": "random", "ratios": {"train": 0.6, "val": 0.2, "test": 0.2}, "seed": 42}
    first = make_split(ids, {key: key for key in ids}, **options)
    assert first == make_split(list(reversed(ids)), {key: key for key in ids}, **options)
    assert {name: len(members) for name, members in first.items()} == {
        "train": 7,
        "val": 2,
        "test": 2,
    }
    assert set(sum(first.values(), [])) == set(ids)


def test_overlaps_and_physical_battery_leakage_are_rejected() -> None:
    with pytest.raises(DomainError):
        make_split(["a"], {"a": "a"}, "manual", {"train": ["a"], "val": ["a"], "test": []})
    with pytest.raises(DomainError):
        make_split(
            ["a", "b"],
            {"a": "same", "b": "same"},
            "manual",
            {"train": ["a"], "val": ["b"], "test": []},
        )


def test_hybrid_preserves_fixed_members_and_groups_related_samples() -> None:
    ids = ["a", "a-window", "b", "c", "d"]
    result = make_split(
        ids,
        {key: "a" if key.startswith("a") else key for key in ids},
        "hybrid",
        {"train": [], "val": ["a"], "test": []},
        {"train": 0.5, "val": 0.25, "test": 0.25},
        1,
    )
    assert {"a", "a-window"}.issubset(result["val"])
    assert {
        name: len({"a" if member.startswith("a") else member for member in members})
        for name, members in result.items()
    } == {"train": 1, "val": 2, "test": 1}
    over_target = make_split(
        ["a", "b", "c", "d"],
        {key: key for key in "abcd"},
        "hybrid",
        {"train": ["a", "b", "c"], "val": [], "test": []},
        {"train": 0.5, "val": 0.25, "test": 0.25},
        1,
    )
    assert over_target == {"train": ["a", "b", "c", "d"], "val": [], "test": []}


def test_hybrid_ratios_apply_to_unassigned_members_only() -> None:
    ids = ["train-fixed", "val-fixed", "test-fixed", *[str(index) for index in range(20)]]
    fixed = {"train": ["train-fixed"], "val": ["val-fixed"], "test": ["test-fixed"]}

    result = make_split(
        ids,
        {key: key for key in ids},
        "hybrid",
        fixed,
        {"train": 0.7, "val": 0.15, "test": 0.15},
        42,
    )

    assert all(member in result[name] for name in result for member in fixed[name])
    assert {name: len(result[name]) - len(fixed[name]) for name in result} == {
        "train": 14,
        "val": 3,
        "test": 3,
    }


def test_hybrid_accepts_three_fixed_members_for_small_dataset() -> None:
    ids = ["train-fixed", "val-fixed", "test-fixed"]
    fixed = {"train": [ids[0]], "val": [ids[1]], "test": [ids[2]]}

    result = make_split(
        ids,
        {key: key for key in ids},
        "hybrid",
        fixed,
        {"train": 0.7, "val": 0.15, "test": 0.15},
        42,
    )

    assert result == fixed


def test_hybrid_preview_preserves_fixed_groups_for_small_dataset(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": f"{name}.pkl"} for name in "abc"])
    revision = resources.list_sources(1, 10)["items"][0]["revision"]
    batteries = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"]
    ids = [item["id"] for item in batteries]
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))

    preview = splits.preview(
        {
            "name": "Small hybrid split",
            "source_selections": source_selection(source["id"], revision, ids),
            "method": "hybrid",
            "ratios": {"train": 0.7, "val": 0.15, "test": 0.15},
            "seed": 42,
            "partitions": {"train": [ids[0]], "val": [ids[1]], "test": [ids[2]]},
        }
    )

    assert preview["counts"] == {"all": 3, "train": 1, "val": 1, "test": 1}
    database.engine.dispose()


def test_manual_empty_groups_are_preserved_and_bad_proportions_fail() -> None:
    assert make_split(["a"], {"a": "a"}, "manual", {"train": ["a"], "val": [], "test": []}) == {
        "train": ["a"],
        "val": [],
        "test": [],
    }
    with pytest.raises(DomainError):
        make_split(["a"], {"a": "a"}, "random", ratios={"train": 1, "val": 1, "test": 0}, seed=42)


def test_whole_source_split_uses_registered_members_and_expected_revision(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    files = LocalSourceFiles({"demo": root})
    resources = ResourceService(database.unit_of_work, files)
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": "root.pkl"}])
    root_battery = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"][0]
    resources.import_batteries(
        source["id"],
        [
            {"file_name": "child.pkl", "parent_battery_id": root_battery["id"]},
            {"file_name": "other.pkl"},
        ],
    )
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    batteries = resources.list_batteries({"source_id": source["id"]}, 1, 10)["items"]
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))

    split = splits.create(
        {
            "name": "Whole source",
            "source_selections": source_selection(source["id"], source_revision, include_all=True),
            "method": "random",
            "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
            "seed": 42,
        }
    )

    assert sum(split["counts"].values()) == 3
    memberships = [
        {member for member in split["payload"][partition]} for partition in ("train", "val", "test")
    ]
    assert set().union(*memberships) == {battery["id"] for battery in batteries}
    child = next(battery for battery in batteries if battery["file_name"] == "child.pkl")
    assert any(root_battery["id"] in group and child["id"] in group for group in memberships)

    with pytest.raises(DomainError, match="revision"):
        splits.create(
            {
                "name": "Stale source",
                "source_selections": source_selection(
                    source["id"], source_revision - 1, include_all=True
                ),
                "method": "random",
                "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
                "seed": 42,
            }
        )
    database.engine.dispose()


def test_manual_split_combines_members_and_revisions_from_multiple_sources(tmp_path: Path) -> None:
    roots = {"first": tmp_path / "first", "second": tmp_path / "second"}
    for root in roots.values():
        root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles(roots))
    first = resources.create_source("First", "first")
    second = resources.create_source("Second", "second")
    resources.import_batteries(first["id"], [{"file_name": "a.pkl"}, {"file_name": "b.pkl"}])
    resources.import_batteries(second["id"], [{"file_name": "c.pkl"}, {"file_name": "d.pkl"}])
    first_items = resources.list_batteries({"source_id": first["id"]}, 1, 10)["items"]
    second_items = resources.list_batteries({"source_id": second["id"]}, 1, 10)["items"]
    members = {item["file_name"]: item["id"] for item in first_items + second_items}
    revisions = {item["id"]: item["revision"] for item in resources.list_sources(1, 10)["items"]}
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))

    split = splits.create(
        {
            "name": "Combined",
            "source_selections": [
                {
                    "source_id": first["id"],
                    "expected_revision": revisions[first["id"]],
                    "battery_ids": [members["a.pkl"], members["b.pkl"]],
                },
                {
                    "source_id": second["id"],
                    "expected_revision": revisions[second["id"]],
                    "battery_ids": [members["c.pkl"], members["d.pkl"]],
                },
            ],
            "method": "manual",
            "partitions": {
                "train": [members["a.pkl"], members["c.pkl"]],
                "val": [members["b.pkl"]],
                "test": [members["d.pkl"]],
            },
        }
    )

    assert {source["id"] for source in split["sources"]} == {first["id"], second["id"]}
    assert split["counts"] == {"train": 2, "val": 1, "test": 1}
    assert set(split["payload"]["train"]) == {members["a.pkl"], members["c.pkl"]}
    assert splits.list([second["id"]], None, 1, 10)["total"] == 1
    assert splits.list([], None, 1, 10)["total"] == 0
    database.engine.dispose()


def test_preview_returns_exact_counts_without_saving_a_split(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Demo", "demo")
    resources.import_batteries(source["id"], [{"file_name": name} for name in ("a.pkl", "b.pkl")])
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))

    body = {
        "name": "Preview only",
        "source_selections": source_selection(source["id"], source_revision, include_all=True),
        "method": "random",
        "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
        "seed": 42,
    }
    result = splits.preview(body)

    assert result == {
        "source_revisions": {source["id"]: source_revision},
        "counts": {"all": 2, "train": 2, "val": 0, "test": 0},
    }
    assert splits.list([source["id"]], None, 1, 10)["total"] == 0
    created = splits.create(body)
    assert created["counts"] == {"train": result["counts"]["train"], "val": 0, "test": 0}
    database.engine.dispose()


def test_preview_rejects_a_source_without_registered_batteries(tmp_path: Path) -> None:
    root = tmp_path / "source"
    root.mkdir()
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    resources = ResourceService(database.unit_of_work, LocalSourceFiles({"demo": root}))
    source = resources.create_source("Empty", "demo")
    source_revision = resources.list_sources(1, 10)["items"][0]["revision"]
    splits = SplitService(database.unit_of_work, SQLiteDocumentStore(database.unit_of_work))

    with pytest.raises(DomainError, match="at least one"):
        splits.preview(
            {
                "name": "Empty dataset",
                "source_selections": source_selection(
                    source["id"], source_revision, include_all=True
                ),
                "method": "random",
                "ratios": {"train": 1.0, "val": 0.0, "test": 0.0},
                "seed": 42,
            }
        )
    database.engine.dispose()
