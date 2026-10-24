from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from batteryland.application.ports.persistence import UnitOfWork
from batteryland.domain.errors import DomainError
from batteryland.infrastructure.persistence.unit_of_work import SqlUnitOfWork


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(f"sqlite:///{path}", connect_args={"autocommit": False})
        event.listen(self.engine, "connect", self._configure_connection)

    @staticmethod
    def _configure_connection(connection: Any, record: Any) -> None:
        previous = connection.autocommit
        connection.autocommit = True
        try:
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=5000")
        finally:
            connection.autocommit = previous

    def initialize(self) -> None:
        raw = self.engine.raw_connection()
        dbapi = raw.driver_connection
        assert dbapi is not None
        previous = dbapi.autocommit
        dbapi.autocommit = True
        try:
            dbapi.execute("PRAGMA journal_mode=WAL")
        finally:
            dbapi.autocommit = previous
            raw.close()
        config = Config()
        config.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    @contextmanager
    def unit_of_work(self) -> Generator[UnitOfWork]:
        try:
            with Session(self.engine, expire_on_commit=False) as session, session.begin():
                yield SqlUnitOfWork(session)
        except IntegrityError as exc:
            raise DomainError(
                "conflict", "A unique identity or resource reference conflicts"
            ) from exc
        except OperationalError as exc:
            symbol = "storage_busy" if "locked" in str(exc.orig).lower() else "storage_corrupt"
            raise DomainError(symbol, "Storage operation could not be completed") from exc
