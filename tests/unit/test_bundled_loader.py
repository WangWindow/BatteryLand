import json
from pathlib import Path

from batteryland.datasets.bundled_loader import load_bundled


def test_bundled_loader_uses_one_stable_reference_for_duplicate_names(tmp_path: Path):
    provider = tmp_path / "provider"
    split_dir = provider / "datasets/batteryLife/data_split"
    split_dir.mkdir(parents=True)
    document = {"dataset": "demo", "train": ["same.pkl"], "val": [], "test": []}
    (split_dir / "demo.json").write_text(json.dumps(document), encoding="utf-8")
    source = tmp_path / "pool"
    for relative in ("z/same.pkl", "a/same.pkl"):
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"same content")

    result = load_bundled(provider, source)

    assert result["batteries"] == [{"file_name": "same.pkl", "relative_key": "a/same.pkl"}]
