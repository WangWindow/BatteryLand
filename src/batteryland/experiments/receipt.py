"""Bind provider validation to the exact bytes accepted by the data service."""

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime
from typing import Any

from batteryland.common.errors import DomainError

RECEIPT_TTL_SECONDS = 3600


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _signature(claims: dict[str, Any], secret: str) -> str:
    content = json.dumps(claims, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hmac.new(secret.encode("utf-8"), content.encode("utf-8"), hashlib.sha256).hexdigest()


def issue_receipt(
    config_text: str,
    split_text: str,
    provider_commit: str,
    component_versions: list[str],
    secret: str,
    *,
    issued_at: datetime | None = None,
    execution_supported: bool = True,
) -> dict[str, Any]:
    if not secret:
        raise ValueError("Validation signing secret must be configured")
    claims = {
        "schema_version": 1,
        "config_sha256": _digest(config_text),
        "split_sha256": _digest(split_text),
        "provider_commit": provider_commit,
        "component_versions": sorted(component_versions),
        "issued_at": int((issued_at or datetime.now(UTC)).timestamp()),
        "execution_supported": execution_supported,
    }
    return claims | {"signature": _signature(claims, secret)}


def verify_receipt(
    receipt: dict[str, Any],
    config_text: str,
    split_text: str,
    secret: str,
    *,
    now: datetime | None = None,
    max_age_seconds: int | None = RECEIPT_TTL_SECONDS,
) -> dict[str, Any]:
    if not secret:
        raise DomainError("provider_unavailable", "Validation secret is not configured")
    claims = {key: value for key, value in receipt.items() if key != "signature"}
    signature = receipt.get("signature")
    if (
        set(claims)
        != {
            "schema_version",
            "config_sha256",
            "split_sha256",
            "provider_commit",
            "component_versions",
            "issued_at",
            "execution_supported",
        }
        or claims.get("schema_version") != 1
        or not isinstance(claims.get("issued_at"), int)
        or not isinstance(claims.get("provider_commit"), str)
        or not isinstance(claims.get("execution_supported"), bool)
        or not isinstance(claims.get("config_sha256"), str)
        or not isinstance(claims.get("split_sha256"), str)
        or not isinstance(claims.get("component_versions"), list)
        or not all(isinstance(item, str) for item in claims["component_versions"])
        or not isinstance(signature, str)
        or re.fullmatch(r"[0-9a-f]{64}", signature) is None
        or not hmac.compare_digest(signature, _signature(claims, secret))
        or not hmac.compare_digest(claims["config_sha256"], _digest(config_text))
        or not hmac.compare_digest(claims["split_sha256"], _digest(split_text))
    ):
        raise DomainError("invalid_input", "Validation receipt does not match the input")
    age = int((now or datetime.now(UTC)).timestamp()) - claims["issued_at"]
    if age < -60 or max_age_seconds is not None and age > max_age_seconds:
        raise DomainError("invalid_input", "Validation receipt has expired")
    return claims
