"""Keep historical write routes available only to explicit migration/test clients."""

from fastapi import Request

from batteryland.domain.errors import DomainError


def require_legacy_writes(request: Request) -> None:
    if not request.app.state.legacy_writes_enabled:
        raise DomainError(
            "unsupported_capability",
            "Use provider validation and the validated experiment workflow",
        )
