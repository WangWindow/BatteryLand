"""Index fixed battery assets and their provider-owned training splits."""

from collections import Counter
from pathlib import PurePosixPath

from batteryland.config import Settings
from batteryland.datasets.service import ResourceService
from batteryland.datasets.splits import SplitService
from batteryland.db.contracts import Record, UnitOfWorkFactory


class FixedCatalogIndexer:
    def __init__(
        self,
        settings: Settings,
        resources: ResourceService,
        units: UnitOfWorkFactory,
        splits: SplitService,
    ) -> None:
        self.settings = settings
        self.resources = resources
        self.units = units
        self.splits = splits

    def index(self) -> None:
        with self.units() as unit:
            unit.catalog.start_scan()
        try:
            all_groups: dict[tuple[str, str], list[Record]] = {}
            root_availability: dict[str, bool] = {}
            file_count = 0
            for alias in sorted(self.settings.source_roots):
                root_availability[alias] = self.resources.files.inspect(alias) == "available"
                candidates: list[Record] = []
                page = 1
                while True:
                    batch = self.resources.files.list_files(alias, None, page, 100000)
                    candidates.extend(batch["items"])
                    if len(candidates) >= batch["total"] or not batch["items"]:
                        break
                    page += 1
                file_count += len(candidates)
                for item in candidates:
                    parent = PurePosixPath(item["relative_key"]).parent.as_posix()
                    prefix = "" if parent == "." else parent
                    all_groups.setdefault((alias, prefix), []).append(item)
                if not candidates and root_availability[alias]:
                    all_groups.setdefault((alias, ""), [])

            indexed_sources: list[str] = []
            with self.units() as unit:
                existing = {
                    (item["root_alias"], item["group_prefix"]): item
                    for item in unit.resources.list_sources(1, 10000)["items"]
                    if item["root_alias"] in self.settings.source_roots
                }
                # Retain empty/missing physical folders so saved datasets keep stable IDs.
                for key in existing:
                    all_groups.setdefault(key, [])

                names = Counter(prefix or alias for alias, prefix in all_groups)
                for (alias, prefix), candidates in sorted(all_groups.items()):
                    name = prefix or alias
                    if names[name] > 1:
                        name = f"{alias}/{name}"
                    source = existing.get((alias, prefix))
                    if source is None:
                        source = unit.resources.add_source(
                            name,
                            alias,
                            "available" if root_availability[alias] else "missing",
                            prefix,
                        )
                    elif source["name"] != name:
                        # The configured root plus folder path is the stable identity.
                        unit.resources.rename_source(source["id"], name)
                    indexed_sources.append(source["id"])
                    entries = [
                        {
                            "file_name": item["file_name"],
                            "relative_key": item["relative_key"],
                            "size_bytes": item["size_bytes"],
                            "modified_at_ns": item["modified_at_ns"],
                        }
                        for item in candidates
                    ]
                    group_path = self.settings.source_roots[alias] / prefix
                    group_available = root_availability[alias] and group_path.is_dir()
                    unit.resources.sync_catalog_source(
                        source["id"], root_available=group_available, batteries=entries
                    )

            if any(
                root.name == "BatteryLife_Processed" for root in self.settings.source_roots.values()
            ):
                split_folder = self.settings.provider_root / "datasets/batteryLife/data_split"
                manifests = [
                    {
                        "source_ref": path.relative_to(self.settings.provider_root).as_posix(),
                        "content": path.read_bytes(),
                    }
                    for path in sorted(split_folder.glob("*.json"))
                ]
                self.splits.sync_provider_manifests(manifests)
            with self.units() as unit:
                unit.catalog.complete_scan(file_count, len(indexed_sources))
        except Exception as exc:
            with self.units() as unit:
                unit.catalog.fail_scan(f"{type(exc).__name__}: {exc}")
            raise

    def status(self) -> Record:
        with self.units() as unit:
            return unit.catalog.status()
