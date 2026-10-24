from collections.abc import Callable

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from batteryland.application.ports.persistence import Record
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.persistence.models import Base, BatteryRow, DataSourceRow


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
        "revision": row.revision,
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

    def add_source(self, name: str, root_alias: str, availability: str) -> Record:
        row = DataSourceRow(name=name, root_alias=root_alias, availability=availability)
        self.session.add(row)
        self.session.flush()
        return source_value(row)

    def get_source(self, identity: str) -> Record:
        row = self.session.get(DataSourceRow, identity)
        if row is None:
            raise DomainError("not_found", "Data source not found")
        return source_value(row)

    def list_sources(self, page: int, page_size: int) -> Record:
        statement = select(DataSourceRow).order_by(
            DataSourceRow.created_at.desc(), DataSourceRow.id.desc()
        )
        return page_of(self.session, statement, source_value, page, page_size)

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
        return [
            battery_value(row)
            for row in self.session.scalars(select(BatteryRow).where(BatteryRow.id.in_(identities)))
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
