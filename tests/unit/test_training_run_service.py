from pathlib import Path

import pytest

from batteryland.common.errors import DomainError
from batteryland.config import Settings
from batteryland.experiments.receipt import issue_receipt
from batteryland.training.runs import StartCommand, TrainingRunService

COMMIT = "6b4c76d6e639ddaf9db9c15bf04771179a68d988"
SECRET = "local-validation-secret"
CONFIG = """mate:
  seed: 7
  device: auto
  experiment: custom
datafactory:
  type: BatteryLandBatteryLifeDatasetFactory
  params:
    dataset: custom
"""
SPLIT = '{"dataset":"custom","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'
COMPONENTS = [
    {
        "scope": "datafactory",
        "type": "batterylandbatterylifedatasetfactory",
        "source_hash": "adapter-hash",
    }
]


class GatewayStub:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.runtime = settings.data_dir / "plugins"
        self.prepared_config = None

    def identity(self):
        return COMMIT

    def validate_structure(self, config):
        return {"valid": True, "components": COMPONENTS}

    def components(self):
        return COMPONENTS

    def prepare(self, materialized):
        self.prepared_config = materialized["snapshot"]["native_config"]
        path = Path(materialized["splits"]["split"]["path"])
        assert self.prepared_config["datafactory"]["params"]["split_file"] == str(path)
        assert path.read_text(encoding="utf-8") == (
            '{"dataset": "custom", "train": ["a.pkl"], "val": ["b.pkl"], "test": ["c.pkl"]}'
        )
        directory = self.settings.data_dir / "runs" / materialized["experiment_id"]
        return {
            "experiment_id": materialized["experiment_id"],
            "intent_id": materialized["intent_id"],
            "directory": str(directory),
            "directory_ref": str(directory.relative_to(self.settings.data_dir)),
            "provider_config_sha256": materialized["config_sha256"],
            "input_manifest_sha256": materialized["input_manifest_sha256"],
        }

    def spawn(self, prepared):
        return {
            "experiment_id": prepared["experiment_id"],
            "intent_id": prepared["intent_id"],
        }


def create_service(tmp_path: Path):
    root = tmp_path / "pool"
    root.mkdir()
    for name in ("a.pkl", "b.pkl", "c.pkl"):
        (root / name).write_bytes(name.encode())
    settings = Settings(
        data_dir=tmp_path / "platform",
        source_roots={"pool": root},
        validation_secret=SECRET,
    )
    gateway = GatewayStub(settings)
    return TrainingRunService(settings, gateway), gateway


def test_custom_split_validation_signs_execution_supported_inputs(tmp_path: Path):
    service, _ = create_service(tmp_path)

    result = service.validate(CONFIG, SPLIT)

    assert result["execution_supported"] is True
    assert result["limitations"] == []
    assert result["receipt"]["execution_supported"] is True


def test_custom_split_requires_matching_config_dataset(tmp_path: Path):
    service, _ = create_service(tmp_path)
    mismatched = CONFIG.replace("dataset: custom", "dataset: another")

    with pytest.raises(DomainError, match="match the split dataset") as error:
        service.validate(mismatched, SPLIT)

    assert error.value.symbol == "invalid_input"


def test_start_materializes_the_custom_split_path_for_one_experiment(tmp_path: Path):
    service, gateway = create_service(tmp_path)
    receipt = issue_receipt(
        CONFIG,
        SPLIT,
        COMMIT,
        ["datafactory:batterylandbatterylifedatasetfactory:adapter-hash"],
        SECRET,
    )

    result = service.start(
        StartCommand(
            experiment_id="experiment-1",
            intent_id="intent-1",
            resolved_device="cuda:0",
            config_text=CONFIG,
            split_text=SPLIT,
            receipt=receipt,
        )
    )

    split_path = service.settings.data_dir / "inputs/experiment-1/split.json"
    assert gateway.prepared_config is not None
    assert gateway.prepared_config["datafactory"]["params"]["split_file"] == str(split_path)
    assert split_path.stat().st_mode & 0o222 == 0
    assert result == {"experiment_id": "experiment-1", "intent_id": "intent-1"}
