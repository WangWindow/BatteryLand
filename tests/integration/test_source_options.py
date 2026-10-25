def test_source_options_expose_allowed_aliases_without_physical_paths(client, settings):
    response = client.get("/api/v1/data-sources/options")
    assert response.status_code == 200
    assert [
        (item["root_alias"], item["availability"], item["file_count"])
        for item in response.json()["data"]
    ] == [("demo", "available", 0), ("other", "available", 0)]
    assert str(settings.source_roots["demo"]) not in response.text
