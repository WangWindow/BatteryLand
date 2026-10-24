import pytest

from batteryland.domain.errors import DomainError
from batteryland.domain.splits import make_split


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
    assert result["val"] == ["a", "a-window"]
    assert len(result["train"]) == 2
    with pytest.raises(DomainError):
        make_split(
            ["a", "b", "c", "d"],
            {key: key for key in "abcd"},
            "hybrid",
            {"train": ["a", "b", "c"], "val": [], "test": []},
            {"train": 0.5, "val": 0.25, "test": 0.25},
            1,
        )


def test_manual_empty_groups_are_preserved_and_bad_proportions_fail() -> None:
    assert make_split(["a"], {"a": "a"}, "manual", {"train": ["a"], "val": [], "test": []}) == {
        "train": ["a"],
        "val": [],
        "test": [],
    }
    with pytest.raises(DomainError):
        make_split(["a"], {"a": "a"}, "random", ratios={"train": 1, "val": 1, "test": 0}, seed=42)
