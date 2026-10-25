"""Transactional ownership and execution state for the in-process scheduler."""

from batteryland.db.contracts import Record, UnitOfWorkFactory


class SchedulerStateService:
    def __init__(self, units: UnitOfWorkFactory) -> None:
        self.units = units

    def heartbeat(self, node_id: str, resources: Record) -> Record:
        with self.units() as unit:
            return unit.workers.heartbeat(node_id, resources)

    def nodes(self) -> list[Record]:
        with self.units() as unit:
            return unit.workers.nodes()

    def claim(
        self, identity: str, revision: int, node_id: str, device: str, request_id: str
    ) -> tuple[Record, bool]:
        with self.units() as unit:
            return unit.workers.claim(identity, revision, node_id, device, request_id)

    def active(self, node_id: str) -> list[Record]:
        with self.units() as unit:
            return unit.workers.active(node_id)

    def ensure_owner(self, identity: str, token: str) -> None:
        with self.units() as unit:
            unit.workers.ensure_owner(identity, token)

    def event(
        self, identity: str, event_id: str, token: str, revision: int, kind: str, data: Record
    ) -> Record:
        with self.units() as unit:
            return unit.workers.event(identity, event_id, token, revision, kind, data)
