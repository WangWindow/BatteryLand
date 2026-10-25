from collections.abc import Callable

from sqlalchemy import Select, func, or_, select, update
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.db.contracts import Record
from batteryland.db.models import Base, BatteryRow, DataSourceRow


def page_of[T: Base](
    session: Session,
    statement: Select[T],
    convert: Callable[[T], Record],
    page: int,
    page_size: int,
) -> Record:
    total = session.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    rows = session.scalars(statement.limit(page_size).offset((page - 1) * page_size)).all()
    return {
        "items": [convert(row) for row in rows],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


def source_value(row: DataSourceRow) -> Record:
    return {
        "id": row.id,
        "name": row.name,
        "root_alias": row.root_alias,
        "group_prefix": row.group_prefix,
        "revision": row.revision,
        "battery_count": 0,
        "available_battery_count": 0,
        "availability": row.availability,
        "created_at": row.created_at,
    }


def battery_value(row: BatteryRow) -> Record:
    return {
        "id": row.id,
        "source_id": row.source_id,
        "file_name": row.file_name,
        "relative_key": row.relative_key,
        "parent_battery_id": row.parent_battery_id,
        "metadata": row.attributes,
        "availability": row.availability,
        "file_size_bytes": row.file_size_bytes,
        "modified_at_ns": row.modified_at_ns,
        "created_at": row.created_at,
    }


class SqlResourceRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_source(
        self, name: str, root_alias: str, availability: str, group_prefix: str = ""
    ) -> Record:
        row = DataSourceRow(
            name=name, root_alias=root_alias, availability=availability, group_prefix=group_prefix
        )
        self.session.add(row)
        self.session.flush()
        return source_value(row)

    def get_source(self, identity: str) -> Record:
        row = self.session.get(DataSourceRow, identity)
        if row is None:
            raise DomainError("not_found", "Data source not found")
        result = source_value(row)
        result["battery_count"] = self.session.scalar(
            select(func.count()).select_from(BatteryRow).where(BatteryRow.source_id == identity)
        )
        result["available_battery_count"] = self.session.scalar(
            select(func.count())
            .select_from(BatteryRow)
            .where(BatteryRow.source_id == identity, BatteryRow.availability == "available")
        )
        return result

    def find_source(self, root_alias: str, group_prefix: str) -> Record | None:
        row = self.session.scalar(
            select(DataSourceRow).where(
                DataSourceRow.root_alias == root_alias,
                DataSourceRow.group_prefix == group_prefix,
            )
        )
        return source_value(row) if row is not None else None

    def rename_source(self, identity: str, name: str) -> None:
        row = self.session.get(DataSourceRow, identity)
        if row is None:
            raise DomainError("not_found", "Data source not found")
        row.name = name

    def sync_catalog_source(
        self,
        identity: str,
        *,
        root_available: bool,
        batteries: list[Record],
    ) -> Record:
        source = self.session.get(DataSourceRow, identity)
        if source is None:
            raise DomainError("not_found", "Data source not found")

        changed = source.availability != ("available" if root_available else "missing")
        source.availability = "available" if root_available else "missing"
        current = {
            row.file_name: row
            for row in self.session.scalars(
                select(BatteryRow).where(BatteryRow.source_id == identity)
            )
        }
        seen: set[str] = set()
        for item in batteries:
            name = item["file_name"]
            seen.add(name)
            row = current.get(name)
            if row is None:
                self.session.add(
                    BatteryRow(
                        source_id=identity,
                        file_name=name,
                        relative_key=item["relative_key"],
                        attributes={},
                        availability="available",
                        file_size_bytes=item["size_bytes"],
                        modified_at_ns=item["modified_at_ns"],
                    )
                )
                changed = True
                continue
            values = {
                "relative_key": item["relative_key"],
                "availability": "available",
                "file_size_bytes": item["size_bytes"],
                "modified_at_ns": item["modified_at_ns"],
            }
            for key, value in values.items():
                if getattr(row, key) != value:
                    setattr(row, key, value)
                    changed = True

        for name, row in current.items():
            if name not in seen and row.availability != "missing":
                row.availability = "missing"
                changed = True

        if changed:
            source.revision += 1
        self.session.flush()
        return source_value(source)

    def increment_source_revision(self, identity: str) -> int:
        revision = self.session.scalar(
            update(DataSourceRow)
            .where(DataSourceRow.id == identity)
            .values(revision=DataSourceRow.revision + 1)
            .returning(DataSourceRow.revision)
        )
        if revision is None:
            raise DomainError("not_found", "Data source not found")
        return revision

    def list_sources(self, page: int, page_size: int) -> Record:
        statement = select(DataSourceRow).order_by(
            DataSourceRow.created_at.desc(), DataSourceRow.id.desc()
        )
        total = self.session.scalar(select(func.count()).select_from(DataSourceRow))
        rows = self.session.scalars(statement.limit(page_size).offset((page - 1) * page_size)).all()
        counts = {
            identity: count
            for identity, count in self.session.execute(
                select(BatteryRow.source_id, func.count())
                .where(BatteryRow.source_id.in_([row.id for row in rows]))
                .group_by(BatteryRow.source_id)
            )
        }
        available_counts = {
            identity: count
            for identity, count in self.session.execute(
                select(BatteryRow.source_id, func.count())
                .where(
                    BatteryRow.source_id.in_([row.id for row in rows]),
                    BatteryRow.availability == "available",
                )
                .group_by(BatteryRow.source_id)
            )
        }
        return {
            "items": [
                source_value(row)
                | {
                    "battery_count": counts.get(row.id, 0),
                    "available_battery_count": available_counts.get(row.id, 0),
                }
                for row in rows
            ],
            "total": total or 0,
            "page": page,
            "page_size": page_size,
        }

    def find_battery(self, source_id: str, file_name: str) -> Record | None:
        row = self.session.scalar(
            select(BatteryRow).where(
                BatteryRow.source_id == source_id, BatteryRow.file_name == file_name
            )
        )
        return battery_value(row) if row is not None else None

    def get_battery(self, identity: str) -> Record:
        row = self.session.get(BatteryRow, identity)
        if row is None:
            raise DomainError("not_found", "Battery not found")
        return battery_value(row)

    def add_battery(self, value: Record) -> Record:
        arguments = dict(value)
        arguments["attributes"] = arguments.pop("metadata", {})
        row = BatteryRow(**arguments)
        self.session.add(row)
        self.session.flush()
        return battery_value(row)

    def get_batteries(self, identities: list[str]) -> list[Record]:
        by_id: dict[str, Record] = {}
        for offset in range(0, len(identities), 500):
            batch = identities[offset : offset + 500]
            rows = self.session.scalars(select(BatteryRow).where(BatteryRow.id.in_(batch)))
            by_id.update({row.id: battery_value(row) for row in rows})
        return [by_id[identity] for identity in identities if identity in by_id]

    def list_source_batteries(self, source_id: str) -> list[Record]:
        rows = self.session.execute(
            select(BatteryRow.id, BatteryRow.source_id, BatteryRow.parent_battery_id)
            .where(BatteryRow.source_id == source_id)
            .order_by(BatteryRow.file_name, BatteryRow.id)
        )
        return [
            {"id": identity, "source_id": source, "parent_battery_id": parent}
            for identity, source, parent in rows
        ]

    def list_available_source_batteries(self, source_id: str) -> list[Record]:
        rows = self.session.scalars(
            select(BatteryRow)
            .where(BatteryRow.source_id == source_id, BatteryRow.availability == "available")
            .order_by(BatteryRow.file_name, BatteryRow.id)
        )
        return [
            {"id": row.id, "source_id": row.source_id, "parent_battery_id": row.parent_battery_id}
            for row in rows
        ]

    def list_batteries(self, filters: Record, page: int, page_size: int) -> Record:
        statement = select(BatteryRow)
        for name, value in filters.items():
            if value is None:
                continue
            if name == "source_ids":
                statement = statement.where(BatteryRow.source_id.in_(value))
            if name == "source_id":
                statement = statement.where(BatteryRow.source_id == value)
            if name == "availability":
                statement = statement.where(BatteryRow.availability == value)
            elif name == "q":
                statement = statement.where(
                    or_(
                        BatteryRow.file_name.contains(value, autoescape=True),
                        BatteryRow.relative_key.contains(value, autoescape=True),
                    )
                )
            elif name in {"chemistry", "material"}:
                statement = statement.where(BatteryRow.attributes[name].as_string() == value)
            elif name in {"temperature_c", "nominal_capacity_ah"}:
                statement = statement.where(BatteryRow.attributes[name].as_float() == value)
            elif name.endswith("_min") and name.removesuffix("_min") in {
                "temperature_c",
                "nominal_capacity_ah",
            }:
                field = name.removesuffix("_min")
                statement = statement.where(BatteryRow.attributes[field].as_float() >= value)
            elif name.endswith("_max") and name.removesuffix("_max") in {
                "temperature_c",
                "nominal_capacity_ah",
            }:
                field = name.removesuffix("_max")
                statement = statement.where(BatteryRow.attributes[field].as_float() <= value)
        statement = statement.order_by(BatteryRow.created_at.desc(), BatteryRow.id.desc())
        return page_of(self.session, statement, battery_value, page, page_size)

    def battery_facets(self, source_ids: list[str] | None) -> Record:
        statement = select(BatteryRow.attributes)
        if source_ids is not None:
            if not source_ids:
                return {"values": {}, "ranges": {}}
            statement = statement.where(BatteryRow.source_id.in_(source_ids))

        values: dict[str, set[str]] = {}
        ranges: dict[str, list[float]] = {}
        for attributes in self.session.scalars(statement):
            for name, value in attributes.items():
                if isinstance(value, bool) or value is None:
                    continue
                if isinstance(value, (int, float)):
                    if name in {"temperature_c", "nominal_capacity_ah"}:
                        ranges.setdefault(name, []).append(float(value))
                    continue
                if isinstance(value, str) and value:
                    values.setdefault(name, set()).add(value)

        return {
            "values": {
                name: sorted(items, key=str.casefold)[:100]
                for name, items in values.items()
                if len(items) <= 100
            },
            "ranges": {
                name: {"min": min(items), "max": max(items)}
                for name, items in ranges.items()
                if items
            },
        }
