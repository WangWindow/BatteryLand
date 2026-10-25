from collections.abc import Callable

from sqlalchemy import Select, func, select, update
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
        return result

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
        return {
            "items": [source_value(row) | {"battery_count": counts.get(row.id, 0)} for row in rows],
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

    def list_batteries(self, filters: Record, page: int, page_size: int) -> Record:
        statement = select(BatteryRow)
        for name, value in filters.items():
            if value is None:
                continue
            if name == "source_id":
                statement = statement.where(BatteryRow.source_id == value)
            elif name == "q":
                statement = statement.where(BatteryRow.file_name.contains(value, autoescape=True))
            elif name in {"chemistry", "material"}:
                statement = statement.where(BatteryRow.attributes[name].as_string() == value)
            elif name in {"temperature_c", "nominal_capacity_ah"}:
                statement = statement.where(BatteryRow.attributes[name].as_float() == value)
        statement = statement.order_by(BatteryRow.created_at.desc(), BatteryRow.id.desc())
        return page_of(self.session, statement, battery_value, page, page_size)
