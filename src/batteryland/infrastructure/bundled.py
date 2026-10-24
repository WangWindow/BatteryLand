from pathlib import Path

from batteryland.application.ports.persistence import Record
from batteryland.application.serialization import load_config, load_json
from batteryland.domain.errors import DomainError


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
        for path in [*source.glob("*.pkl"), *source.glob("*/*.pkl")]:
            if path.is_file():
                paths.setdefault(path.name, []).append(path)
    batteries = []
    for name in names:
        matches = paths.get(name, [])
        if len(matches) > 1:
            raise DomainError("integration_precondition_failed", f"Ambiguous source file: {name}")
        batteries.append(
            {
                "file_name": name,
                "relative_key": str(matches[0].relative_to(source)) if matches else name,
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
