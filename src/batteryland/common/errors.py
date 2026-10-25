"""Business failures independent of HTTP and storage implementations."""

from typing import Any


class DomainError(Exception):
    def __init__(self, symbol: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.symbol = symbol
        self.message = message
        self.details = details or {}
