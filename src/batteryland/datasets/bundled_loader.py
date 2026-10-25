from pathlib import Path

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_config, load_json
from batteryland.db.contracts import Record


def load_bundled(provider: Path, source: Path) -> Record:
    splits = [
        load_json(path.read_bytes())
        for path in sorted((provider / "datasets/batteryLife/data_split").glob("*.json"))
    ]
    if not splits:
        raise DomainError("provider_unavailable", "Bundled splits are unavailable")
    names = sorted(
        {name for item in splits for group in ("train", "val", "test") for name in item[group]}
    )
    paths: dict[str, list[Path]] = {}
    if source.is_dir():
        for path in sorted(source.rglob("*.pkl")):
            if path.is_file() and not any(
                part in {"Life labels", "seen_unseen_labels", "life_bank_cache", "READMEs"}
                for part in path.relative_to(source).parts[:-1]
            ):
                paths.setdefault(path.name, []).append(path)
    batteries = []
    for name in names:
        matches = paths.get(name, [])
        batteries.append(
            {
                "file_name": name,
                "relative_key": (
                    min(
                        (path.relative_to(source).as_posix() for path in matches),
                        key=lambda value: (value.casefold(), value),
                    )
                    if matches
                    else name
                ),
            }
        )
    return {
        "batteries": batteries,
        "splits": splits,
        "templates": [
            {"name": path.stem, "native_config": load_config(path.read_bytes())}
            for path in sorted((provider / "configs").glob("*.yaml"))
        ],
    }
