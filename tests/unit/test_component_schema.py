from batteryland.components.service import ArtifactService


def test_custom_factory_schema_hides_platform_managed_split_file():
    source_schema = {
        "params": [
            {"name": "dataset", "configurable": True},
            {
                "name": "split_file",
                "configurable": True,
                "has_default": True,
                "default": None,
            },
        ],
        "required": ["dataset"],
        "defaults": {"split_file": None},
        "injected_params": [],
    }

    component = ArtifactService._component_for_editor(
        {
            "scope": "datafactory",
            "type": "BatteryLandBatteryLifeDatasetFactory",
            "schema": source_schema,
        }
    )

    schema = component["schema"]
    assert [item["name"] for item in schema["params"]] == ["dataset"]
    assert schema["defaults"] == {}
    assert schema["injected_params"] == [
        {"name": "split_file", "source": "BatteryLand execution"}
    ]
    assert source_schema["params"][1]["configurable"] is True


def test_unrelated_component_schema_is_returned_unchanged():
    schema = {"params": [{"name": "split_file", "configurable": True}]}
    component = {
        "scope": "datafactory",
        "type": "anotherfactory",
        "schema": schema,
    }

    assert ArtifactService._component_for_editor(component) == component
