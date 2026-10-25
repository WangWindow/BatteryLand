"""Opt-in custom split acceptance through the isolated DeepPlatform runner."""

import json
import os
import time
from pathlib import Path

import pytest
import yaml

from batteryland.config import DEFAULT_TRAINING_PYTHON, Settings
from batteryland.training.gateway import DeeplatformGateway
from batteryland.training.materializer import ExecutionMaterializer
from batteryland.training.resources import BatteryFileResolver

ROOT = Path(__file__).resolve().parents[2]
PROVIDER = ROOT / "src/deeplatform"
SOURCE = Path("/data/BatteryLife_Processed")


@pytest.mark.training
def test_custom_batterylife_split_runs_in_isolated_provider(tmp_path: Path):
    if not SOURCE.is_dir() or not DEFAULT_TRAINING_PYTHON.is_file():
        pytest.skip("Custom split acceptance requires the configured BatteryLife data and runtime")

    settings = Settings(
        data_dir=tmp_path / "backend",
        source_roots={"battery-life": SOURCE},
        provider_root=PROVIDER,
        training_python=Path(os.path.abspath(DEFAULT_TRAINING_PYTHON)),
    )
    gateway = DeeplatformGateway(settings)

    split = json.loads((PROVIDER / "datasets/batteryLife/data_split/CALCE.json").read_text())
    split["train"] = split["train"][:2]
    split["val"] = split["val"][:1]
    split["test"] = split["test"][:1]
    config = yaml.safe_load((PROVIDER / "configs/calce_seed2021.yaml").read_text())
    config["mate"].update(device="cpu", epochs=1, experiment="custom-split-acceptance")
    config["datafactory"].update(type="BatteryLandBatteryLifeDatasetFactory")
    config["datafactory"]["params"].update(batch_size=1, num_workers=0)
    assert gateway.validate_structure(config).get("valid")

    experiment_id = "custom-split-acceptance"
    input_directory = settings.data_dir / "inputs" / experiment_id
    config["datafactory"]["params"]["split_file"] = str((input_directory / "split.json").resolve())
    members = [name for partition in ("train", "val", "test") for name in split[partition]]
    resources = {
        "kind": "train",
        "splits": {
            "split": {
                "ref": {"id": "provider", "version": 1},
                "provider_split": split,
                **BatteryFileResolver(settings.source_roots).resolve(members),
            }
        },
    }
    snapshot = {
        "native_config": config,
        "resources": resources,
        "provider_commit": gateway.identity(),
        "components": gateway.components(),
        "requested_device": "cpu",
    }
    materialized = ExecutionMaterializer(settings.data_dir).materialize(
        experiment_id, "custom-split-acceptance-intent", snapshot
    )
    process = gateway.spawn(gateway.prepare(materialized))

    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        observation = gateway.observe(process)
        if not observation["alive"]:
            break
        time.sleep(0.5)
    else:
        raise AssertionError("Custom split training did not finish within four minutes")

    run_directory = Path(process["directory"])
    status = json.loads((run_directory / "status.json").read_text())
    log = (run_directory / "console.log").read_text(errors="replace")[-8000:]
    assert status.get("status") == "completed", log
    saved_config = yaml.safe_load((run_directory / "config.yaml").read_text())
    assert saved_config["mate"]["device"] == "cpu"
    assert saved_config["datafactory"]["type"] == "BatteryLandBatteryLifeDatasetFactory"
    assert saved_config["datafactory"]["params"]["split_file"] == str(
        settings.data_dir / "inputs" / experiment_id / "split.json"
    )
    assert json.loads((input_directory / "split.json").read_text()) == split
