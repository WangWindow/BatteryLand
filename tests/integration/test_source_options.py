def test_source_options_expose_allowed_aliases_without_physical_paths(client, settings):
    response = client.get("/api/v1/data-sources/options")
    assert response.status_code == 200
    assert response.json()["data"] == [
        {"root_alias": "demo", "availability": "available"},
        {"root_alias": "other", "availability": "available"},
    ]
    assert str(settings.source_roots["demo"]) not in response.text
