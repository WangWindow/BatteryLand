from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from batteryland.api.app import create_app
from batteryland.config import Settings


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--run-training", action="store_true", help="Enable real DeepPlatform acceptance tests"
    )
    parser.addoption(
        "--run-gpu",
        action="store_true",
        help="Enable acceptance tests that launch real CUDA training (also requires --run-training)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        if item.get_closest_marker("training") and not config.getoption("--run-training"):
            item.add_marker(pytest.mark.skip(reason="Real training requires --run-training"))
        elif item.get_closest_marker("gpu") and not config.getoption("--run-gpu"):
            item.add_marker(pytest.mark.skip(reason="GPU acceptance requires --run-gpu"))


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    source = tmp_path / "source"
    other = tmp_path / "other"
    source.mkdir()
    other.mkdir()
    return Settings(data_dir=tmp_path / "platform", source_roots={"demo": source, "other": other})


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings, legacy_writes=True)) as instance:
        yield instance
