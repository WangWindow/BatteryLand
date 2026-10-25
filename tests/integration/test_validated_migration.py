"""The member projection backfills drafts stored by the previous schema."""

import json
from pathlib import Path

from alembic import command
from alembic.config import Config

from batteryland.db.database import Database


def test_existing_validated_input_gets_member_index_on_upgrade(tmp_path):
    database = Database(tmp_path / "platform.sqlite")
    config = Config()
    config.set_main_option(
        "script_location",
        str(Path(__file__).resolve().parents[2] / "src/batteryland/db/migrations"),
    )
    with database.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0006_catalog_groups")
        connection.exec_driver_sql(
            "INSERT INTO document_versions "
            "(id,kind,owner_id,version,sha256,storage_key,payload) "
            "VALUES ('document','experiment_draft','experiment',1,'hash','key','{}')"
        )
        connection.exec_driver_sql(
            "INSERT INTO experiments (id,name,kind,state,revision,draft_document_id) "
            "VALUES ('experiment','old','train','draft',1,'document')"
        )
        split = {"dataset": "demo", "train": ["a.pkl"], "val": [], "test": ["b.pkl"]}
        connection.exec_driver_sql(
            "INSERT INTO validated_inputs "
            "(experiment_id,version,config_text,split_text,config_sha256,split_sha256,"
            "config,split,receipt,provider_commit,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                "experiment",
                1,
                "mate: {}",
                json.dumps(split),
                "c",
                "s",
                '{"mate":{}}',
                json.dumps(split),
                "{}",
                "commit",
                "2026-01-01T00:00:00Z",
            ),
        )
    with database.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        counts = connection.exec_driver_sql(
            "SELECT split_counts FROM validated_inputs WHERE experiment_id='experiment'"
        ).scalar()
        members = connection.exec_driver_sql(
            "SELECT partition,file_name FROM validated_split_members "
            "WHERE experiment_id='experiment' ORDER BY partition,ordinal"
        ).all()
    assert json.loads(counts) == {"train": 1, "val": 0, "test": 1}
    assert members == [("test", "b.pkl"), ("train", "a.pkl")]
    database.engine.dispose()
