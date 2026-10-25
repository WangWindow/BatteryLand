import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime
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


def make_legacy_document(
    root: Path,
    *,
    identity: str | None = None,
    kind: str = "config",
    owner_id: str = "experiment-a",
    version: int = 1,
    payload: dict | None = None,
) -> tuple[DocumentRef, bytes]:
    identity = identity or str(uuid4())
    envelope = {
        "schema_version": 1,
        "kind": kind,
        "owner_id": owner_id,
        "version": version,
        "created_at": datetime.now(UTC).isoformat(),
        "payload": payload or {"seed": 42},
    }
    content = json.dumps(
        envelope, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":")
    ).encode("utf-8")
    root.mkdir(parents=True, exist_ok=True)
    (root / f"{identity}.json").write_bytes(content)
    reference = DocumentRef(
        identity,
        kind,
        owner_id,
        version,
        f"{identity}.json",
        hashlib.sha256(content).hexdigest(),
        envelope["created_at"],
    )
    return reference, content


def make_store(tmp_path: Path) -> tuple[Database, SQLiteDocumentStore, Path]:
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    legacy_root = tmp_path / "documents"
    return database, SQLiteDocumentStore(database.unit_of_work, legacy_root), legacy_root


def insert_legacy_metadata(database: Database, reference, *, checksum: str | None = None) -> None:
    with database.engine.begin() as connection:
        connection.exec_driver_sql(
            """INSERT INTO document_versions
               (id, kind, owner_id, version, schema_version, sha256, storage_key, created_at)
               VALUES (?, ?, ?, ?, 1, ?, ?, ?)""",
            (
                reference.id,
                reference.kind,
                reference.owner_id,
                reference.version,
                checksum or reference.sha256,
                reference.storage_key,
                reference.created_at,
            ),
        )


def test_document_round_trip_and_immutable_identity(tmp_path: Path) -> None:
    database, store, _ = make_store(tmp_path)
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
    database, _, _ = make_store(tmp_path)
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
    database.engine.dispose()


def test_documents_detect_corruption_and_reference_mismatch(tmp_path: Path) -> None:
    database, store, _ = make_store(tmp_path)
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
    database, store, _ = make_store(tmp_path)
    reference = store.publish("config", "a", 1, {"value": "old"})
    with pytest.raises((ValueError, DomainError)):
        store.publish("config", "a", 2, {"bad": float("nan")})
    assert store.read(reference)["payload"] == {"value": "old"}
    database.engine.dispose()


def test_legacy_documents_migrate_idempotently_and_keep_a_backup(tmp_path: Path) -> None:
    database, store, legacy_root = make_store(tmp_path)
    reference, content = make_legacy_document(legacy_root)
    insert_legacy_metadata(database, reference)

    store.migrate_legacy()

    backup = tmp_path / "documents.legacy"
    assert not legacy_root.exists()
    assert (backup / f"{reference.id}.json").read_bytes() == content
    with database.unit_of_work() as unit:
        migrated_reference = unit.documents.get(reference.id)
    migrated = store.read(migrated_reference)
    assert migrated["payload"] == {"seed": 42}

    store.migrate_legacy()
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT count(*) FROM document_versions").scalar() == 1
    assert (backup / f"{reference.id}.json").read_bytes() == content
    database.engine.dispose()


def test_legacy_migration_is_retryable_after_import_before_backup(tmp_path: Path) -> None:
    database, store, legacy_root = make_store(tmp_path)
    reference, content = make_legacy_document(legacy_root, payload={"native_config": {"lr": 0.1}})
    original_archive = store._archive_legacy

    def fail_before_archive() -> None:
        raise OSError("Simulated interruption")

    store._archive_legacy = fail_before_archive
    with pytest.raises(OSError, match="Simulated interruption"):
        store.migrate_legacy()
    assert (legacy_root / f"{reference.id}.json").read_bytes() == content
    with database.engine.connect() as connection:
        assert (
            connection.exec_driver_sql(
                "SELECT json_extract(payload, '$.native_config.lr') FROM document_versions WHERE id = ?",
                (reference.id,),
            ).scalar()
            == 0.1
        )

    store._archive_legacy = original_archive
    store.migrate_legacy()
    assert (tmp_path / "documents.legacy" / f"{reference.id}.json").read_bytes() == content
    database.engine.dispose()


def test_corrupt_or_conflicting_legacy_document_fails_without_removing_source(
    tmp_path: Path,
) -> None:
    database, store, legacy_root = make_store(tmp_path)
    reference, content = make_legacy_document(legacy_root)
    insert_legacy_metadata(database, reference, checksum="0" * 64)

    with pytest.raises(DomainError) as corrupt:
        store.migrate_legacy()
    assert corrupt.value.symbol == "storage_corrupt"
    assert (legacy_root / f"{reference.id}.json").read_bytes() == content
    assert not (tmp_path / "documents.legacy").exists()
    database.engine.dispose()


def test_unresolved_database_document_prevents_legacy_backup(tmp_path: Path) -> None:
    database, store, legacy_root = make_store(tmp_path)
    legacy_root.mkdir()
    identity = str(uuid4())
    with database.engine.begin() as connection:
        connection.exec_driver_sql(
            """INSERT INTO document_versions
               (id, kind, owner_id, version, schema_version, sha256, storage_key)
               VALUES (?, 'config', 'experiment-a', 1, 1, ?, ?)""",
            (identity, "0" * 64, f"{identity}.json"),
        )

    with pytest.raises(DomainError, match="missing"):
        store.migrate_legacy()
    assert legacy_root.is_dir()
    assert not (tmp_path / "documents.legacy").exists()
    database.engine.dispose()


def test_concurrent_publish_is_idempotent_within_the_backend(tmp_path: Path) -> None:
    _, store, _ = make_store(tmp_path)
    identity = str(uuid4())

    def publish(_index: int) -> DocumentRef:
        return store.publish("config", "same", 1, {"seed": 42}, document_id=identity)

    with ThreadPoolExecutor(max_workers=4) as executor:
        references = list(executor.map(publish, range(12)))

    assert len({reference.sha256 for reference in references}) == 1
    assert store.read(references[0])["payload"] == {"seed": 42}


def test_configuration_service_reads_sqlite_documents_after_restart(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path)
    first = Container(settings)
    created = first.configurations.create("baseline", {"model": {"type": "linear"}})
    first.close()

    second = Container(settings)
    try:
        loaded = second.configurations.get(created["id"])
        assert loaded["native_config"] == {"model": {"type": "linear"}}
        assert not (tmp_path / "documents").exists()
    finally:
        second.close()


def test_container_startup_migrates_existing_document_files(tmp_path: Path) -> None:
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    reference, content = make_legacy_document(tmp_path / "documents", payload={"threshold": 0.8})
    insert_legacy_metadata(database, reference)
    database.engine.dispose()

    container = Container(Settings(data_dir=tmp_path))
    try:
        with container.database.unit_of_work() as unit:
            migrated_reference = unit.documents.get(reference.id)
        assert container.documents.read(migrated_reference)["payload"] == {"threshold": 0.8}
        assert (tmp_path / "documents.legacy" / f"{reference.id}.json").read_bytes() == content
    finally:
        container.close()
