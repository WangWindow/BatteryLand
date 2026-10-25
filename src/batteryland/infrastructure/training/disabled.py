"""Refuse local training operations in the data service process."""

from batteryland.application.ports.persistence import Record
from batteryland.domain.errors import DomainError


class DisabledTrainingGateway:
    @staticmethod
    def _unsupported() -> None:
        raise DomainError("unsupported_capability", "Training is owned by the independent service")

    def validate(self, config: Record, resources: Record) -> Record:
        self._unsupported()
        return {}

    def prepare(self, materialized: Record) -> Record:
        self._unsupported()
        return {}

    def spawn(self, prepared: Record) -> Record:
        self._unsupported()
        return {}

    def observe(self, receipt: Record) -> Record:
        self._unsupported()
        return {}

    def signal(self, receipt: Record, stage: str) -> Record:
        self._unsupported()
        return {}
