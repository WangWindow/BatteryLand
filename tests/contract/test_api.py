import json
from pathlib import Path

from batteryland.api.app import create_app


def test_generated_openapi_matches_reviewed_contract(settings):
    expected = json.loads(
        Path("specs/012-backend-service-protocol/contracts/core-openapi.json").read_text()
    )
    actual = create_app(settings).openapi()
    assert actual == expected, "Export the reviewed runtime OpenAPI after reconciling DTO changes"


def test_all_operations_declare_typed_success_and_uniform_errors(settings):
    schema = create_app(settings).openapi()
    operations = [
        operation
        for path in schema["paths"].values()
        for method, operation in path.items()
        if method in {"get", "post", "put", "patch", "delete"}
    ]
    assert len(operations) >= 60
    for path in (
        "/api/v1/training/validation",
        "/api/v1/validated-experiments",
        "/api/v1/validated-experiments/{experiment_id}/members",
        "/api/v1/catalog/named-groups",
        "/api/v1/scheduler/resources",
        "/api/v1/worker/claims",
        "/api/v1/worker/experiments/{experiment_id}/result",
    ):
        assert path in schema["paths"]
    for operation in operations:
        assert operation["responses"]["422"]["content"]["application/json"]["schema"][
            "$ref"
        ].endswith("/ErrorEnvelope")
        success = next(
            response
            for status, response in operation["responses"].items()
            if status.startswith("2")
        )
        assert success.get("content"), operation["operationId"]

    def check(value):
        if isinstance(value, dict):
            if "$ref" in value:
                target = schema
                for key in value["$ref"].removeprefix("#/").split("/"):
                    target = target[key]
            for child in value.values():
                check(child)
        elif isinstance(value, list):
            for child in value:
                check(child)

    check(schema)


def test_data_source_list_exposes_registered_battery_count(settings):
    schema = create_app(settings).openapi()

    assert "battery_count" in schema["components"]["schemas"]["DataSource"]["properties"]
    split_write = schema["components"]["schemas"]["SplitWrite"]["properties"]
    assert "include_all_source" in split_write
    assert "expected_source_revision" in split_write
    assert "post" in schema["paths"]["/api/v1/splits/preview"]
    assert "statistics" in schema["components"]["schemas"]["Split"]["properties"]
