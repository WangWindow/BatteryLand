from uuid import UUID

import pytest

from batteryland.common.errors import DomainError
from batteryland.db.database import Database
from batteryland.experiments.validated import ValidatedExperimentService
from batteryland.experiments.validated_routes import delete as delete_experiment_route


def seed_experiment(database: Database, identity: str, state: str = "draft") -> None:
    with database.unit_of_work() as unit:
        document = unit.documents.publish("experiment_draft", identity, 1, {"native_config": {}})
        unit.experiments.add(
            identity,
            {"name": "management test", "kind": "train"},
            document.id,
            {
                "split_document_id": document.id,
                "source_split_document_id": None,
                "target_split_document_id": None,
                "checkpoint_id": None,
            },
            {
                "source_id": None,
                "split_id": None,
                "model_type": None,
                "task_type": None,
                "requested_device": "auto",
                "source_domain": None,
                "target_domain": None,
            },
        )
    if state != "draft":
        with database.engine.begin() as connection:
            connection.exec_driver_sql(
                "UPDATE experiments SET state = ? WHERE id = ?", (state, identity)
            )


def test_delete_removes_a_draft_experiment(tmp_path):
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    seed_experiment(database, "draft-experiment")
    service = ValidatedExperimentService(database.unit_of_work, "", None)

    service.delete("draft-experiment")

    with database.unit_of_work() as unit, pytest.raises(DomainError, match="not found"):
        unit.experiments.get("draft-experiment")
    database.engine.dispose()


def test_delete_rejects_an_active_experiment(tmp_path):
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    seed_experiment(database, "running-experiment", "running")
    service = ValidatedExperimentService(database.unit_of_work, "", None)

    with pytest.raises(DomainError, match="Active experiment cannot be deleted") as error:
        service.delete("running-experiment")

    assert error.value.symbol == "resource_in_use"
    with database.unit_of_work() as unit:
        assert unit.experiments.get("running-experiment")["state"] == "running"
    database.engine.dispose()


def test_delete_route_returns_a_deleted_result(tmp_path):
    identity = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    database = Database(tmp_path / "platform.sqlite")
    database.initialize()
    seed_experiment(database, identity)
    service = ValidatedExperimentService(database.unit_of_work, "", None)

    response = delete_experiment_route(UUID(identity), service)

    assert response == {"data": {"deleted": True}}
    with database.unit_of_work() as unit, pytest.raises(DomainError, match="not found"):
        unit.experiments.get(identity)
    database.engine.dispose()
