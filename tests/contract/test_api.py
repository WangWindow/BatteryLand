import json
from pathlib import Path

from batteryland.interfaces.api.app import create_app


def test_generated_openapi_matches_reviewed_contract(settings):
    expected = json.loads(
        Path("specs/001-backend-experiment-platform/contracts/openapi.json").read_text()
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
    assert len(operations) == 48
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
