from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.container import Container
from batteryland.db.database import Database
from batteryland.documents.store import SQLiteDocumentStore
from batteryland.documents.types import DocumentRef


def make_store(tmp_path: Path) -> tuple[Database, SQLiteDocumentStore]:
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    return database, SQLiteDocumentStore(database.unit_of_work)


def test_document_round_trip_and_immutable_identity(tmp_path: Path) -> None:
    database, store = make_store(tmp_path)
    reference = store.publish("config", "experiment-a", 1, {"seed": 42})

    assert reference.storage_key == f"sqlite:{reference.id}"
    assert store.read(reference)["payload"] == {"seed": 42}
    with database.engine.connect() as connection:
        assert (
            connection.exec_driver_sql(
                "SELECT json_extract(payload, '$.seed') FROM document_versions WHERE id = ?",
                (reference.id,),
            ).scalar()
            == 42
        )

    with pytest.raises(DomainError, match="already exists"):
        store.publish("config", "experiment-a", 1, {"seed": 43}, document_id=reference.id)
    assert store.read(reference)["payload"] == {"seed": 42}
    database.engine.dispose()


def test_document_rows_and_payload_roll_back_together(tmp_path: Path) -> None:
    database, _ = make_store(tmp_path)
    identity = str(uuid4())

    with pytest.raises(RuntimeError), database.unit_of_work() as unit:
        unit.documents.publish("config", "experiment-a", 1, {"seed": 42}, document_id=identity)
        raise RuntimeError("Simulated failure")

    with pytest.raises(DomainError, match="not found"), database.unit_of_work() as unit:
        unit.documents.get(identity)
    database.engine.dispose()


def test_database_migrations_foreign_keys_and_existing_rows(tmp_path: Path) -> None:
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    with database.engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO data_sources (id, name, root_alias) VALUES ('source', 'demo', 'demo')"
        )
    with pytest.raises(IntegrityError), database.engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO batteries (id, source_id, file_name) VALUES ('battery', 'missing', 'a.pkl')"
        )
    database.initialize()
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert (
            connection.exec_driver_sql("SELECT name FROM data_sources WHERE id = 'source'").scalar()
            == "demo"
        )
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
        assert "dataset_statistics" in {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        assert "payload" in {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(document_versions)")
        }
        # Keep the unused nullable column: SQLite's table rebuild would cascade
        # delete existing experiments and their related result data.
        assert "template_document_id" in {
            row[1] for row in connection.exec_driver_sql("PRAGMA table_info(experiments)")
        }
        assert "templates" not in {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        experiment_schema = connection.exec_driver_sql(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'experiments'"
        ).scalar()
        assert "CHECK (kind IN ('train','evaluate','transfer'))" in experiment_schema
        assert "CHECK (state IN ('draft','queued'" in experiment_schema
    database.engine.dispose()


def test_documents_detect_corruption_and_reference_mismatch(tmp_path: Path) -> None:
    database, store = make_store(tmp_path)
    reference = store.publish("split", "dataset-a", 1, {"train": ["a"]})
    with database.engine.begin() as connection:
        connection.exec_driver_sql(
            "UPDATE document_versions SET payload = ? WHERE id = ?",
            ('{"train":["changed"]}', reference.id),
        )
    with pytest.raises(DomainError) as corrupt:
        store.read(reference)
    assert corrupt.value.symbol == "storage_corrupt"
    with pytest.raises(DomainError):
        store.read(replace(reference, storage_key="../outside.json"))
    database.engine.dispose()


def test_failed_publication_does_not_replace_previous_content(tmp_path: Path) -> None:
    database, store = make_store(tmp_path)
    reference = store.publish("config", "a", 1, {"value": "old"})
    with pytest.raises((ValueError, DomainError)):
        store.publish("config", "a", 2, {"bad": float("nan")})
    assert store.read(reference)["payload"] == {"value": "old"}
    database.engine.dispose()


def test_concurrent_publish_is_idempotent_within_the_backend(tmp_path: Path) -> None:
    _, store = make_store(tmp_path)
    identity = str(uuid4())

    def publish(_index: int) -> DocumentRef:
        return store.publish("config", "same", 1, {"seed": 42}, document_id=identity)

    with ThreadPoolExecutor(max_workers=4) as executor:
        references = list(executor.map(publish, range(12)))

    assert len({reference.sha256 for reference in references}) == 1
    assert store.read(references[0])["payload"] == {"seed": 42}


def test_container_reopens_sqlite_documents_after_restart(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path, auto_index_catalog=False)
    first = Container(settings)
    reference = first.documents.publish("configuration", "experiment-a", 1, {"seed": 42})
    first.close()

    second = Container(settings)
    try:
        assert second.documents.read(reference)["payload"] == {"seed": 42}
        assert not (tmp_path / "documents").exists()
    finally:
        second.close()
