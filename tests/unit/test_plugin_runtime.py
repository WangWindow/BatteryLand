import json
from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.training.plugin_runtime import initialize_runtime

COMMIT = "provider-test-commit"


def test_runtime_seeds_default_code_and_adapter_once_without_overwriting(tmp_path: Path, settings):
    runtime = tmp_path / "plugins"
    initialize_runtime(settings.provider_root, runtime, COMMIT)

    base = runtime / "components/datafactory/BatteryLifeDataset.py"
    adapter = runtime / "components/datafactory/batterylife_custom.py"
    split = runtime / "datasets/batteryLife/data_split/CALCE.json"
    manifest = json.loads((runtime / ".batteryland-runtime.json").read_text())
    assert base.is_file() and adapter.is_file() and split.is_file()
    assert manifest["provider_commit"] == COMMIT
    assert (runtime / "components/__init__.py").is_file()
    assert (runtime / "tools/component_upload.py").is_file()
    assert "BATTERYLAND_DATA_ROOT" in (runtime / "utils/sync_flat_symlinks.py").read_text()

    base.write_text("user-edited default", encoding="utf-8")
    initialize_runtime(settings.provider_root, runtime, COMMIT)

    assert base.read_text(encoding="utf-8") == "user-edited default"


def test_runtime_refuses_to_reseed_from_another_provider_revision(tmp_path: Path, settings):
    runtime = tmp_path / "plugins"
    initialize_runtime(settings.provider_root, runtime, COMMIT)

    with pytest.raises(DomainError) as error:
        initialize_runtime(settings.provider_root, runtime, "different-provider-commit")

    assert error.value.symbol == "integration_precondition_failed"
