import json
import os
import subprocess
import sys

import pytest

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.training.gateway import DeeplatformGateway


def test_static_preview_uses_real_provider_without_training_imports(settings: Settings) -> None:
    gateway = DeeplatformGateway(settings)
    components = gateway.components()
    cpmlp = next(
        item for item in components if item["scope"] == "model" and item["type"] == "cpmlp"
    )
    assert len(cpmlp["source_hash"]) == 64 and cpmlp["origin"] == "builtin"
    assert "torch" not in sys.modules


def test_upload_checks_both_roots_and_does_not_execute_source(settings: Settings) -> None:
    gateway = DeeplatformGateway(settings)
    conflict = b"from core.register.registryhub import R\n@R.model.register('CPMLP')\nclass Duplicate: pass\n"
    with pytest.raises(DomainError) as duplicate:
        gateway.upload("model", "duplicate.py", conflict)
    assert duplicate.value.symbol == "conflict"
    content = b"raise RuntimeError('must not execute on upload')\nfrom core.register.registryhub import R\n@R.model.register('UploadedOnly')\nclass Model: pass\n"
    result = gateway.upload("model", "custom.py", content)
    assert result["activation"] == "next_experiment"
    assert any(item["type"] == "uploadedonly" for item in gateway.components())
    assert not (settings.provider_root / "components/uploaded/model/custom.py").exists()


def test_custom_split_is_rejected_before_provider_execution(settings: Settings) -> None:
    gateway = DeeplatformGateway(settings)
    config = {
        "mate": {"seed": 42, "device": "cpu", "experiment": "demo"},
        "task": {"type": "BatteryLifeRun"},
        "datafactory": {"type": "BatteryLifeDatasetFactory", "params": {"dataset": "custom"}},
    }
    with pytest.raises(DomainError) as error:
        gateway.validate(
            config,
            {
                "kind": "train",
                "splits": {
                    "split": {
                        "provider_split": {
                            "dataset": "custom",
                            "train": ["a.pkl"],
                            "val": [],
                            "test": [],
                        }
                    }
                },
            },
        )
    assert error.value.symbol == "integration_precondition_failed"


def test_real_provider_parameter_description_does_not_construct_components(settings: Settings):
    script = """
import json, sys
sys.path.insert(0, sys.argv[1])
from core.register.catalog import get_component_schema
class Model:
    def __init__(self, required, optional=7):
        raise AssertionError("description constructed a model")
class Task:
    def __init__(self, context, hook_manager=None, epochs=3):
        raise AssertionError("description constructed a task")
class Registry:
    def __init__(self, name): self.name = name
    def get(self, name): return Model if self.name == 'model' else Task
class Hub:
    def get(self, name): return Registry(name)
print(json.dumps([get_component_schema(scope, 'sample', discover=False, register_hub=Hub()) for scope in ('model','task')]))
assert 'torch' not in sys.modules
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(settings.provider_root)],
        env=os.environ | {"PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    model, task = json.loads(result.stdout)
    assert model["required"] == ["required"] and model["defaults"] == {"optional": 7}
    assert {item["source"] for item in task["injected_params"]} == {"context", "hook_manager"}
    assert task["defaults"] == {"epochs": 3} and task["configurable"]
