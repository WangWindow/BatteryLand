import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from batteryland.common.errors import DomainError
from batteryland.experiments.receipt import issue_receipt, verify_receipt


def test_receipt_binds_exact_input_and_provider_identity():
    config = "mate:\n  device: auto\n"
    split = '{"dataset":"demo","train":["a.pkl"],"val":["b.pkl"],"test":["c.pkl"]}'
    receipt = issue_receipt(config, split, "commit-a", ["model:abc"], "shared-secret")

    verified = verify_receipt(receipt, config, split, "shared-secret")
    assert verified["config_sha256"] == hashlib.sha256(config.encode()).hexdigest()
    assert verified["split_sha256"] == hashlib.sha256(split.encode()).hexdigest()
    assert verified["provider_commit"] == "commit-a"
    with pytest.raises(DomainError, match="Validation receipt"):
        verify_receipt(receipt, config + "\n", split, "shared-secret")
    with pytest.raises(DomainError, match="Validation receipt"):
        verify_receipt(receipt, config, split, "other-secret")


def test_expired_receipt_is_rejected():
    issued = datetime.now(UTC) - timedelta(hours=2)
    receipt = issue_receipt("{}", "{}", "commit", [], "secret", issued_at=issued)
    with pytest.raises(DomainError, match="expired"):
        verify_receipt(receipt, "{}", "{}", "secret")
