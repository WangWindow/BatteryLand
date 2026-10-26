import hashlib
import json
from collections.abc import Sequence
from pathlib import PurePosixPath
from typing import cast
from uuid import NAMESPACE_URL, uuid4, uuid5

from batteryland.common.errors import DomainError
from batteryland.common.serialization import load_json
from batteryland.datasets.split_rules import PARTITIONS, make_split
from batteryland.datasets.statistics import summarize_dataset
from batteryland.db.contracts import Record, UnitOfWork, UnitOfWorkFactory
from batteryland.documents.contracts import DocumentStore


class SplitService:
    def __init__(self, units: UnitOfWorkFactory, documents: DocumentStore) -> None:
        self.units = units
        self.documents = documents

    @staticmethod
    def _manifest(content: bytes) -> Record:
        value = load_json(content)
        if (
            not isinstance(value, dict)
            or set(value) != {"dataset", *PARTITIONS}
            or not isinstance(value["dataset"], str)
            or not value["dataset"].strip()
        ):
            raise DomainError("invalid_input", "Split import requires dataset, train, val and test")
        for partition in PARTITIONS:
            members = value[partition]
            if not isinstance(members, list) or any(
                not isinstance(item, str)
                or not item.strip()
                or item != item.strip()
                or "\x00" in item
                or "\\" in item
                or PurePosixPath(item).name != item
                or item in {".", ".."}
                for item in members
            ):
                raise DomainError(
                    "invalid_input", f"Split {partition} must contain plain file names"
                )
        return value

    @staticmethod
    def _resolve_manifest(
        unit: UnitOfWork, manifest: Record, member_bindings: Record | None = None
    ) -> Record:
        bindings = member_bindings or {}
        filenames = list(dict.fromkeys(name for part in PARTITIONS for name in manifest[part]))
        unexpected_bindings = set(bindings) - set(filenames)
        if unexpected_bindings:
            raise DomainError(
                "invalid_input",
                "Import bindings contain file names that are not in the split",
                details={"file_names": sorted(unexpected_bindings)},
            )
        batteries = unit.resources.find_batteries_by_names(filenames)
        by_name: dict[str, list[Record]] = {name: [] for name in filenames}
        for battery in batteries:
            by_name[battery["file_name"]].append(battery)

        counts = {part: len(manifest[part]) for part in PARTITIONS}
        resolution: Record = {
            "matched": 0,
            "missing": 0,
            "ambiguous": 0,
            "duplicates": 0,
            "issues": [],
        }
        selected_by_name: dict[str, Record] = {}
        occurrences: dict[str, list[str]] = {}
        for partition in PARTITIONS:
            for filename in manifest[partition]:
                occurrences.setdefault(filename, []).append(partition)

        for filename, partitions in occurrences.items():
            candidates = by_name[filename]
            binding = bindings.get(filename)
            chosen = None
            if not candidates:
                resolution["missing"] += len(partitions)
                resolution["issues"].append(
                    {"file_name": filename, "status": "missing", "candidates": []}
                )
                continue
            if binding is not None:
                chosen = next((item for item in candidates if item["id"] == binding), None)
                if chosen is None:
                    raise DomainError(
                        "invalid_input",
                        "A selected import member is not a candidate for its file name",
                        details={"file_name": filename, "battery_id": binding},
                    )
            elif len(candidates) == 1:
                chosen = candidates[0]

            if chosen is None:
                resolution["ambiguous"] += len(partitions)
                resolution["issues"].append(
                    {
                        "file_name": filename,
                        "status": "ambiguous",
                        "candidates": [
                            {
                                "battery_id": item["id"],
                                "source_id": item["source_id"],
                                "source_name": item["source_name"],
                                "relative_key": item["relative_key"],
                            }
                            for item in candidates
                        ],
                    }
                )
                continue

            selected_by_name[filename] = chosen
            resolution["matched"] += len(partitions)

        selected_ids: set[str] = set()
        partitions_by_id = {part: [] for part in PARTITIONS}
        sources: dict[str, Record] = {}
        for partition in PARTITIONS:
            for filename in manifest[partition]:
                battery = selected_by_name.get(filename)
                if battery is None:
                    continue
                if battery["id"] in selected_ids:
                    resolution["duplicates"] += 1
                    resolution["issues"].append(
                        {
                            "file_name": filename,
                            "status": "duplicate_member",
                            "candidates": [
                                {
                                    "battery_id": battery["id"],
                                    "source_id": battery["source_id"],
                                    "source_name": battery["source_name"],
                                    "relative_key": battery["relative_key"],
                                }
                            ],
                        }
                    )
                    continue
                selected_ids.add(battery["id"])
                partitions_by_id[partition].append(battery["id"])
                sources[battery["source_id"]] = {
                    "source_id": battery["source_id"],
                    "source_revision": battery["source_revision"],
                    "include_all": False,
                }

        for partition in PARTITIONS:
            if counts[partition] == 0:
                resolution["issues"].append(
                    {
                        "file_name": "",
                        "status": "empty_partition",
                        "partition": partition,
                        "candidates": [],
                    }
                )

        total_members = sum(counts.values())
        ready = (
            resolution["missing"] == 0
            and resolution["ambiguous"] == 0
            and resolution["duplicates"] == 0
            and all(counts[part] > 0 for part in PARTITIONS)
            and resolution["matched"] == total_members
        )
        return {
            "name": manifest["dataset"].strip(),
            "counts": counts,
            "resolution": resolution,
            "execution_ready": ready,
            "partitions": partitions_by_id,
            "sources": list(sources.values()),
            "batteries": selected_by_name,
        }

    @staticmethod
    def _provider_payload(manifest: Record, resolved: Record) -> Record:
        return {
            "dataset_name": resolved["name"],
            "logical_dataset_id": None,
            "sources": resolved["sources"],
            **resolved["partitions"],
            "method": "provider",
            "seed": None,
            "algorithm_version": "provider-manifest-v1",
            "parameters": {},
            "origin": "builtin",
            "execution_ready": resolved["execution_ready"],
            "counts": resolved["counts"],
            "resolution": resolved["resolution"],
            "provider_split": manifest,
        }

    @staticmethod
    def _readiness(counts: Record, resolution: Record) -> tuple[bool, Record]:
        issues = list(resolution.get("issues", []))
        for partition in PARTITIONS:
            if counts[partition] == 0 and not any(
                issue.get("status") == "empty_partition" and issue.get("partition") == partition
                for issue in issues
            ):
                issues.append(
                    {"file_name": "", "status": "empty_partition", "partition": partition}
                )
        normalized = {
            "matched": resolution.get("matched", 0),
            "missing": resolution.get("missing", 0),
            "ambiguous": resolution.get("ambiguous", 0),
            "duplicates": resolution.get("duplicates", 0),
            "issues": issues,
        }
        ready = all(counts[partition] > 0 for partition in PARTITIONS) and not any(
            issue.get("status") in {"missing", "ambiguous", "duplicate_member", "empty_partition"}
            for issue in issues
        )
        return ready, normalized

    @staticmethod
    def _statistics(unit: UnitOfWork, payload: Record) -> Record:
        member_ids = [member for name in PARTITIONS for member in payload[name]]
        records = unit.resources.get_batteries(member_ids)
        metadata = {record["id"]: record["metadata"] for record in records}
        return summarize_dataset(
            {name: payload[name] for name in PARTITIONS},
            metadata,
        )

    def _payload(
        self, unit: UnitOfWork, body: Record, *, allow_catalog_scan: bool = False
    ) -> Record:
        catalog_state = unit.catalog.status()["state"]
        if catalog_state == "running" and not allow_catalog_scan:
            raise DomainError("conflict", "The asset catalog is syncing; retry after it finishes")
        enforce_availability = catalog_state == "ready"
        if body.get("logical_dataset_id"):
            logical_dataset = unit.logical_datasets.get(body["logical_dataset_id"])
            if logical_dataset["stale"]:
                raise DomainError(
                    "conflict", "A source changed since this logical dataset was saved"
                )
            ids = list(unit.logical_datasets.battery_ids(body["logical_dataset_id"]))
            selected_records = unit.resources.get_batteries(ids)
            if len(selected_records) != len(ids) or any(
                item["availability"] != "available" for item in selected_records
            ):
                raise DomainError("conflict", "A logical dataset member is no longer available")
            records = {item["id"]: item for item in selected_records}
            source_snapshots = [
                {
                    "source_id": source["source_id"],
                    "source_revision": source["source_revision"],
                    "include_all": False,
                }
                for source in logical_dataset["source_snapshot"]
            ]
            includes_whole_source = False
        else:
            ids = []
            records = {}
            source_snapshots = []
            includes_whole_source = False

        if not body.get("logical_dataset_id"):
            source_selections = body["source_selections"]
            source_ids = [selection["source_id"] for selection in source_selections]
            if len(source_ids) != len(set(source_ids)):
                raise DomainError("invalid_input", "A source can only be selected once")

            for selection in source_selections:
                source_id = selection["source_id"]
                source = unit.resources.get_source(source_id)
                if selection["expected_revision"] != source["revision"]:
                    raise DomainError(
                        "conflict", "A data source revision changed; preview the split again"
                    )

                include_all = selection.get("include_all", False)
                selected_ids = selection.get("battery_ids", [])
                excluded_ids = selection.get("excluded_battery_ids", [])
                if include_all:
                    if selected_ids:
                        raise DomainError(
                            "invalid_input", "Whole-source selection cannot include explicit files"
                        )
                    includes_whole_source = True
                    source_batteries = (
                        unit.resources.list_available_source_batteries(source_id)
                        if enforce_availability
                        else unit.resources.list_source_batteries(source_id)
                    )
                    source_records = {record["id"]: record for record in source_batteries}
                    if not set(excluded_ids).issubset(source_records):
                        raise DomainError(
                            "invalid_input", "Excluded files must belong to their selected source"
                        )
                    selected_ids = [
                        identity for identity in source_records if identity not in excluded_ids
                    ]
                    records.update(
                        {
                            identity: record
                            for identity, record in source_records.items()
                            if identity not in excluded_ids
                        }
                    )
                elif not selected_ids:
                    if excluded_ids:
                        raise DomainError(
                            "invalid_input", "Excluded files require a whole-source selection"
                        )
                    raise DomainError("invalid_input", "Each selected source needs selected files")
                else:
                    if excluded_ids:
                        raise DomainError(
                            "invalid_input", "Excluded files require a whole-source selection"
                        )
                    source_batteries = unit.resources.get_batteries(selected_ids)
                    if len(source_batteries) != len(selected_ids):
                        raise DomainError("invalid_input", "Split references an unknown battery")
                    if any(record["source_id"] != source_id for record in source_batteries):
                        raise DomainError(
                            "invalid_input", "Split members must belong to their selected source"
                        )
                    if enforce_availability and any(
                        record["availability"] != "available" for record in source_batteries
                    ):
                        raise DomainError("conflict", "A selected battery is no longer available")
                    records.update({record["id"]: record for record in source_batteries})

                ids.extend(selected_ids)
                source_snapshots.append(
                    {
                        "source_id": source_id,
                        "source_revision": source["revision"],
                        "include_all": include_all,
                    }
                )

        if not ids:
            raise DomainError("invalid_input", "Select at least one battery for the split")
        if len(ids) != len(set(ids)):
            raise DomainError("invalid_input", "A battery can only be selected once")
        if includes_whole_source and body["method"] != "random":
            raise DomainError(
                "invalid_input", "Whole-source selections must use random partitioning"
            )
        parents = (
            {record["parent_battery_id"] for record in records.values()} - {None} - records.keys()
        )
        while parents:
            found = unit.resources.get_batteries(list(parents))
            if len(found) != len(parents):
                raise DomainError("invalid_input", "Battery parent reference is missing")
            records.update({record["id"]: record for record in found})
            parents = {record["parent_battery_id"] for record in found} - {None} - records.keys()
        families: dict[str, str] = {}
        for identity in ids:
            current = identity
            visited: set[str] = set()
            while records[current]["parent_battery_id"]:
                if current in visited:
                    raise DomainError(
                        "invalid_input", "Battery parent relationship contains a cycle"
                    )
                visited.add(current)
                current = records[current]["parent_battery_id"]
            families[identity] = current
        partitions = make_split(
            ids,
            families,
            body["method"],
            body.get("partitions"),
            body.get("ratios"),
            body.get("seed"),
        )
        return {
            "dataset_name": body["name"],
            "logical_dataset_id": body.get("logical_dataset_id"),
            "sources": source_snapshots,
            **partitions,
            "method": body["method"],
            "seed": body.get("seed"),
            "algorithm_version": "shuffle-v1",
            "parameters": {"ratios": body.get("ratios")},
        }

    @staticmethod
    def _view(
        header: Record, version: int, payload: Record, statistics: Record | None = None
    ) -> Record:
        is_head = version == header["revision"]
        return {key: value for key, value in header.items() if key != "head_document_id"} | {
            "name": payload["dataset_name"],
            "logical_dataset_id": payload.get("logical_dataset_id"),
            "head_version": header["revision"],
            "version": version,
            "origin": payload.get("origin", header.get("origin", "created")),
            "read_only": header.get("read_only", False),
            "execution_ready": (
                header.get("execution_ready", True)
                if is_head
                else payload.get("execution_ready", True)
            ),
            "resolution": (
                header.get("resolution", {})
                if is_head
                else payload.get("resolution", header.get("resolution", {}))
            ),
            "counts": payload.get("counts", {name: len(payload[name]) for name in PARTITIONS}),
            "payload": payload,
            "statistics": statistics,
        }

    def create(self, body: Record) -> Record:
        identity = str(uuid4())
        with self.units() as unit:
            payload = self._payload(unit, body)
            counts = {name: len(payload[name]) for name in PARTITIONS}
            ready, resolution = self._readiness(counts, {"issues": []})
            payload.update(
                origin="created",
                execution_ready=ready,
                counts=counts,
                resolution=resolution,
            )
            statistics = self._statistics(unit, payload)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.add(
                    identity,
                    body["name"],
                    document.id,
                    payload["sources"],
                    counts,
                    resolution,
                    execution_ready=ready,
                )
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, 1, payload, statistics)

    def preview(self, body: Record) -> Record:
        with self.units() as unit:
            payload = self._payload(unit, body)
        counts = {name: len(payload[name]) for name in PARTITIONS}
        ready, resolution = self._readiness(counts, {"issues": []})
        return {
            "source_revisions": {
                source["source_id"]: source["source_revision"] for source in payload["sources"]
            },
            "counts": {"all": sum(counts.values()), **counts},
            "execution_ready": ready,
            "resolution": resolution,
        }

    def update(self, identity: str, body: Record, revision: int) -> Record:
        with self.units() as unit:
            old = unit.splits.get(identity)
            if old["revision"] != revision:
                raise DomainError("conflict", "Split revision has changed")
            if old["read_only"]:
                raise DomainError("conflict", "Built-in training datasets are read-only")
            payload = self._payload(unit, body)
            counts = {name: len(payload[name]) for name in PARTITIONS}
            ready, resolution = self._readiness(counts, {"issues": []})
            payload.update(
                origin="imported" if old["origin"] == "imported" else "created",
                execution_ready=ready,
                counts=counts,
                resolution=resolution,
            )
            statistics = self._statistics(unit, payload)
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, revision + 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.update(
                    identity,
                    revision,
                    body["name"],
                    document.id,
                    payload["sources"],
                    counts,
                    resolution,
                    ready,
                )
                unit.splits.add_members(document.id, {name: payload[name] for name in PARTITIONS})
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, revision + 1, payload, statistics)

    def get(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            payload = self.documents.read(document)["payload"]
            header = header | {"sources": unit.splits.sources(document.id)}
            statistics = unit.splits.statistics(document.id)
            is_head = document.version == header["revision"]
            resolution = cast(
                Record,
                header["resolution"] if is_head else payload.get("resolution", {}),
            )
            unresolved_members = resolution.get("manifest_missing") or any(
                issue.get("status") in {"missing", "ambiguous", "duplicate_member"}
                for issue in resolution.get("issues", [])
            )
            if statistics is None and not unresolved_members:
                statistics = self._statistics(unit, payload)
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, document.version, payload, statistics)

    def list(
        self, source_ids: Sequence[str] | None, q: str | None, page: int, page_size: int
    ) -> Record:
        with self.units() as unit:
            result = unit.splits.list_splits(
                list(source_ids) if source_ids is not None else None, q, page, page_size
            )
        for item in result["items"]:
            item.pop("head_document_id")
        return result

    def members(
        self, identity: str, version: int | None, partition: str | None, page: int, page_size: int
    ) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            return unit.splits.members(document.id, partition, page, page_size)

    def export(self, identity: str, version: int | None = None) -> Record:
        split = self.get(identity, version)
        payload = split["payload"]
        if "provider_split" in payload:
            return payload["provider_split"]
        with self.units() as unit:
            records = unit.resources.get_batteries(
                [member for name in PARTITIONS for member in payload[name]]
            )
        names = {record["id"]: record["file_name"] for record in records}
        return {
            "dataset": payload["dataset_name"],
            **{name: [names[member] for member in payload[name]] for name in PARTITIONS},
        }

    def execution_binding(self, identity: str, version: int | None = None) -> Record:
        with self.units() as unit:
            header = unit.splits.get(identity)
            document = (
                unit.documents.get(header["head_document_id"])
                if version is None
                else unit.documents.find("split", identity, version)
            )
            payload = self.documents.read(document)["payload"]
            is_head = document.version == header["revision"]
            execution_ready = (
                header["execution_ready"] if is_head else payload.get("execution_ready", True)
            )
            resolution = (
                header["resolution"] if is_head else payload.get("resolution", header["resolution"])
            )
            if not execution_ready:
                raise DomainError(
                    "conflict",
                    "This training dataset is not ready to run",
                    details={"resolution": resolution},
                )
            member_ids = [member for name in PARTITIONS for member in payload[name]]
            batteries = unit.resources.get_batteries(member_ids)
            if len(batteries) != len(member_ids):
                raise DomainError("storage_corrupt", "Split references missing battery records")

            sources = {item["id"]: item for item in unit.splits.sources(document.id)}
            members = []
            for battery in batteries:
                source = sources.get(battery["source_id"])
                if source is None:
                    raise DomainError("storage_corrupt", "Split member source is not versioned")
                members.append(battery | {"root_alias": source["root_alias"]})

            names = {battery["id"]: battery["file_name"] for battery in batteries}
            provider_split = payload.get("provider_split") or {
                "dataset": payload["dataset_name"],
                **{name: [names[member] for member in payload[name]] for name in PARTITIONS},
            }
            return {
                "split_id": identity,
                "split_version": document.version,
                "split_document_id": document.id,
                "name": payload["dataset_name"],
                "sources": list(sources.values()),
                "members": members,
                "provider_split": provider_split,
            }

    def preview_import(self, content: bytes, member_bindings: Record | None = None) -> Record:
        manifest = self._manifest(content)
        with self.units() as unit:
            if unit.catalog.status()["state"] == "running":
                raise DomainError(
                    "conflict", "The asset catalog is syncing; retry after it finishes"
                )
            resolved = self._resolve_manifest(unit, manifest, member_bindings)
        return {
            "name": resolved["name"],
            "counts": resolved["counts"],
            "resolution": resolved["resolution"],
            "execution_ready": resolved["execution_ready"],
        }

    def import_document(self, content: bytes, member_bindings: Record | None = None) -> Record:
        manifest = self._manifest(content)
        with self.units() as unit:
            if unit.catalog.status()["state"] == "running":
                raise DomainError(
                    "conflict", "The asset catalog is syncing; retry after it finishes"
                )
            resolved = self._resolve_manifest(unit, manifest, member_bindings)
            if not resolved["execution_ready"]:
                raise DomainError(
                    "invalid_input",
                    "Imported training dataset has unresolved members or empty partitions",
                    details={
                        "resolution": resolved["resolution"],
                        "counts": resolved["counts"],
                    },
                )
            payload = {
                "dataset_name": resolved["name"],
                "logical_dataset_id": None,
                "sources": resolved["sources"],
                **resolved["partitions"],
                "method": "manual",
                "seed": None,
                "algorithm_version": "import-v1",
                "parameters": {},
                "origin": "imported",
                "execution_ready": True,
                "counts": resolved["counts"],
                "resolution": resolved["resolution"],
            }
            statistics = self._statistics(unit, payload)
        identity = str(uuid4())
        with self.documents.write_lock():
            document = self.documents.publish("split", identity, 1, payload)
            with self.units() as unit:
                unit.documents.add(document)
                header = unit.splits.add(
                    identity,
                    resolved["name"],
                    document.id,
                    resolved["sources"],
                    resolved["counts"],
                    resolved["resolution"],
                    origin="imported",
                    execution_ready=True,
                )
                unit.splits.add_members(document.id, resolved["partitions"])
                unit.splits.add_statistics(document.id, statistics)
        return self._view(header, 1, payload, statistics)

    def sync_provider_manifests(self, manifests: Sequence[Record]) -> None:
        seen_refs: set[str] = set()
        for source in manifests:
            source_ref = source["source_ref"]
            content = source["content"]
            manifest = self._manifest(content)
            with self.units() as unit:
                resolved = self._resolve_manifest(unit, manifest)
            payload = self._provider_payload(manifest, resolved)
            digest_input = json.dumps(
                {
                    "manifest": hashlib.sha256(content).hexdigest(),
                    "partitions": resolved["partitions"],
                    "resolution": resolved["resolution"],
                    "sources": resolved["sources"],
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            source_hash = hashlib.sha256(digest_input).hexdigest()
            identity = str(uuid5(NAMESPACE_URL, f"batteryland:provider-split:{source_ref}"))
            with self.units() as unit:
                current = unit.splits.get_by_source_ref(source_ref)
            changed = current is None or current["source_hash"] != source_hash
            version = current["revision"] + 1 if current else 1
            if changed:
                with self.units() as unit:
                    statistics = (
                        self._statistics(unit, payload) if resolved["execution_ready"] else None
                    )
                with self.documents.write_lock():
                    document = self.documents.publish("split", identity, version, payload)
                    with self.units() as unit:
                        unit.documents.add(document)
                        unit.splits.sync_builtin(
                            identity,
                            resolved["name"],
                            source_ref,
                            source_hash,
                            document.id,
                            resolved["sources"],
                            resolved["partitions"],
                            resolved["counts"],
                            resolved["resolution"],
                            resolved["execution_ready"],
                            statistics,
                        )
            else:
                with self.units() as unit:
                    unit.splits.sync_builtin(
                        identity,
                        resolved["name"],
                        source_ref,
                        source_hash,
                        current["head_document_id"],
                        resolved["sources"],
                        resolved["partitions"],
                        resolved["counts"],
                        resolved["resolution"],
                        resolved["execution_ready"],
                        None,
                    )
            seen_refs.add(source_ref)
        with self.units() as unit:
            unit.splits.mark_missing_builtins(seen_refs)

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            if unit.splits.get(identity)["read_only"]:
                raise DomainError("conflict", "Built-in training datasets cannot be deleted")
            unit.splits.delete(identity)
        return {"deleted": True}
