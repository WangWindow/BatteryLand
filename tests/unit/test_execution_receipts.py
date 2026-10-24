import json
import shutil
from pathlib import Path

import pytest

from batteryland.domain.errors import DomainError
from batteryland.infrastructure.training.materializer import ExecutionMaterializer


@pytest.mark.parametrize("mismatch", ["intent", "manifest", "config"])
def test_recovery_binds_receipts_to_intent_and_manifest(tmp_path: Path, mismatch: str):
    files = ExecutionMaterializer(tmp_path)
    snapshot = {
        "native_config": {"mate": {"device": "cpu"}},
        "resources": {"splits": {}},
        "provider_commit": "test",
    }
    materialized = files.materialize("experiment", "original-intent", snapshot)
    directory = tmp_path / "runs" / "experiment"
    directory.mkdir(parents=True)
    shutil.copyfile(materialized["config_path"], directory / "config.yaml")
    receipt = {
        "experiment_id": "experiment",
        "intent_id": "another-intent" if mismatch == "intent" else "original-intent",
        "directory": str(directory),
        "directory_ref": "runs/experiment",
        "input_manifest_sha256": "wrong"
        if mismatch == "manifest"
        else materialized["input_manifest_sha256"],
        "provider_config_sha256": "wrong"
        if mismatch == "config"
        else materialized["config_sha256"],
    }
    files.record_receipt("experiment", "prepare", receipt)
    files.record_receipt("experiment", "process", receipt)
    with pytest.raises(DomainError, match="identity|manifest|intent|checksum"):
        files.recover_receipts("experiment", "original-intent")
    assert materialized["input_manifest_sha256"]
    assert (
        json.loads(Path(materialized["manifest_path"]).read_text())["intent_id"]
        == "original-intent"
    )
