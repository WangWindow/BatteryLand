import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from batteryland.common.errors import DomainError
from batteryland.training.gateway import DeeplatformGateway


@pytest.fixture
def catalog(settings, monkeypatch):
    gateway = DeeplatformGateway(settings)
    operations = []
    control = gateway._control

    def counted(operation, arguments):
        operations.append(operation)
        return control(operation, arguments)

    monkeypatch.setattr(gateway, "_control", counted)
    return gateway, operations


def source(name):
    return f"from core.register.registryhub import R\n@R.model.register('{name}')\nclass Model: pass\n".encode()


def test_unchanged_sources_share_a_snapshot_across_scope_queries(catalog):
    gateway, operations = catalog
    all_values = gateway.components()
    models = gateway.components("model")
    assert models == [value for value in all_values if value["scope"] == "model"]
    assert gateway.components() == all_values
    assert operations == ["inspect"]


def test_callers_cannot_mutate_the_cached_snapshot(catalog):
    gateway, operations = catalog
    original = gateway.components()
    returned = gateway.components()
    returned[0]["type"] = "caller-mutation"
    returned.clear()
    assert gateway.components() == original
    assert operations == ["inspect"]


def test_content_edits_are_detected_even_when_size_and_mtime_are_preserved(catalog):
    gateway, operations = catalog
    path = gateway.runtime / "components" / "custom.py"
    path.parent.mkdir(parents=True)
    path.write_bytes(source("Before"))
    before = gateway.components()
    stat = path.stat()
    path.write_bytes(source("AfterX"))
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    after = gateway.components()
    assert any(item["type"] == "before" for item in before)
    assert any(item["type"] == "afterx" for item in after)
    assert not any(item["type"] == "before" for item in after)
    assert operations == ["inspect", "inspect"]


def test_source_addition_and_removal_invalidate_the_snapshot(catalog):
    gateway, operations = catalog
    original = gateway.components()
    path = gateway.runtime / "components" / "added.py"
    path.write_bytes(source("Added"))
    assert any(item["type"] == "added" for item in gateway.components())
    path.unlink()
    assert gateway.components() == original
    assert operations == ["inspect", "inspect", "inspect"]


def test_successful_upload_refreshes_the_snapshot(catalog):
    gateway, operations = catalog
    gateway.components()
    gateway.upload("model", "fresh.py", source("Fresh"))
    assert any(item["type"] == "fresh" for item in gateway.components())
    gateway.components()
    assert operations == ["inspect", "upload", "inspect"]


def test_parallel_queries_parse_only_once(catalog):
    gateway, operations = catalog
    barrier = threading.Barrier(4)

    def query(_):
        barrier.wait(timeout=5)
        return gateway.components()

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(query, range(4)))
    assert all(result == results[0] for result in results)
    assert operations == ["inspect"]


def test_failed_inspection_can_be_retried(catalog, monkeypatch):
    gateway, _ = catalog
    control = gateway._control
    attempts = []

    def fail_once(operation, arguments):
        attempts.append(operation)
        if len(attempts) == 1:
            raise DomainError("provider_unavailable", "Temporary inspection failure")
        return control(operation, arguments)

    monkeypatch.setattr(gateway, "_control", fail_once)
    with pytest.raises(DomainError):
        gateway.components()
    assert gateway.components()
    assert attempts == ["inspect", "inspect"]


def test_cached_results_do_not_bypass_provider_revision_checks(catalog, monkeypatch):
    gateway, _ = catalog
    gateway.components()

    def changed():
        raise DomainError("integration_precondition_failed", "Provider changed")

    monkeypatch.setattr(gateway, "identity", changed)
    with pytest.raises(DomainError, match="Provider changed"):
        gateway.components()
