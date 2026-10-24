import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from batteryland.domain.errors import DomainError
from batteryland.infrastructure.documents import JsonDocumentStore
from batteryland.infrastructure.persistence.database import Database


def test_document_round_trip_and_immutable_identity(tmp_path: Path) -> None:
    store = JsonDocumentStore(tmp_path)
    reference = store.publish("config", "experiment-a", 1, {"seed": 42})
    assert store.read(reference)["payload"] == {"seed": 42}
    with pytest.raises(DomainError, match="already exists"):
        store.publish("config", "experiment-a", 1, {"seed": 43}, document_id=reference.id)
    assert store.read(reference)["payload"]["seed"] == 42


def test_documents_detect_corruption_and_path_escape(tmp_path: Path) -> None:
    store = JsonDocumentStore(tmp_path)
    reference = store.publish("split", "dataset-a", 1, {"train": ["a"]})
    (tmp_path / reference.storage_key).write_text("{}")
    with pytest.raises(DomainError) as corrupt:
        store.read(reference)
    assert corrupt.value.symbol == "storage_corrupt"
    with pytest.raises(DomainError):
        store.read(replace(reference, storage_key="../outside.json"))


def test_failed_publication_does_not_replace_previous_content(tmp_path: Path) -> None:
    store = JsonDocumentStore(tmp_path)
    reference = store.publish("config", "a", 1, {"value": "old"})
    with pytest.raises((ValueError, DomainError)):
        store.publish("config", "a", 2, {"bad": float("nan")})
    assert store.read(reference)["payload"] == {"value": "old"}


def test_database_migrations_foreign_keys_and_rollback(tmp_path: Path) -> None:
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    database.initialize()
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar()
    with pytest.raises(IntegrityError), database.engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO batteries (id, source_id, file_name) VALUES ('b','missing','a.pkl')"
        )
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM batteries").scalar() == 0
    with database.engine.begin() as connection:
        connection.exec_driver_sql(
            "INSERT INTO data_sources (id,name,root_alias) VALUES ('s','demo','demo')"
        )
    with pytest.raises(RuntimeError), database.engine.begin() as connection:
        connection.exec_driver_sql("UPDATE data_sources SET name='changed' WHERE id='s'")
        raise RuntimeError("Simulated failure")
    with database.engine.connect() as connection:
        assert (
            connection.exec_driver_sql("SELECT name FROM data_sources WHERE id='s'").scalar()
            == "demo"
        )
    database.engine.dispose()


def test_orphan_cleanup_reads_live_references_under_publication_lock(tmp_path: Path):
    store = JsonDocumentStore(tmp_path / "documents")
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    kept = store.publish("config", "kept", 1, {})
    orphan = store.publish("config", "orphan", 1, {})
    fresh = store.publish("config", "fresh", 1, {})
    with database.unit_of_work() as unit:
        unit.documents.add(kept)
    yesterday = (datetime.now(UTC) - timedelta(days=1)).timestamp()
    for reference in (kept, orphan):
        os.utime(store.root / reference.storage_key, (yesterday, yesterday))

    def referenced():
        with database.unit_of_work() as unit:
            return unit.documents.storage_keys()

    assert store.cleanup(referenced, datetime.now(UTC) - timedelta(hours=1)) == 1
    assert store.read(kept)["payload"] == {}
    assert store.read(fresh)["payload"] == {}
    assert not (store.root / orphan.storage_key).exists()
    database.engine.dispose()


def test_concurrent_document_publication_is_idempotent(tmp_path: Path):
    identity = str(uuid4())
    stores = [JsonDocumentStore(tmp_path) for _ in range(4)]

    def publish(index):
        return stores[index % len(stores)].publish(
            "config", "same", 1, {"seed": 42}, document_id=identity
        )

    with ThreadPoolExecutor(max_workers=4) as executor:
        references = list(executor.map(publish, range(12)))
    assert len({reference.sha256 for reference in references}) == 1
    assert len(list(tmp_path.glob("*.json"))) == 1
    assert stores[0].read(references[-1])["payload"] == {"seed": 42}
