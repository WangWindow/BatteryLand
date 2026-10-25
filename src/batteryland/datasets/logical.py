"""Saved, filesystem-independent selections of registered batteries."""

from collections.abc import Sequence
from uuid import uuid4

from batteryland.common.errors import DomainError
from batteryland.datasets.selections import resolve_source_selections
from batteryland.db.contracts import Record, UnitOfWorkFactory


class LogicalDatasetService:
    def __init__(self, units: UnitOfWorkFactory) -> None:
        self.units = units

    def preview(self, selections: Sequence[Record], page: int, page_size: int) -> Record:
        with self.units() as unit:
            identities, sources, batteries = resolve_source_selections(unit, selections)
        start = (page - 1) * page_size
        return {
            "items": batteries[start : start + page_size],
            "total": len(identities),
            "sources": sources,
            "page": page,
            "page_size": page_size,
        }

    def create(self, name: str, description: str, selections: Sequence[Record]) -> Record:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise DomainError("invalid_input", "Logical dataset name is required")
        with self.units() as unit:
            identities, sources, _ = resolve_source_selections(unit, selections)
            return unit.logical_datasets.create(
                str(uuid4()), cleaned_name, description.strip(), sources, identities
            )

    def list(self, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.logical_datasets.list(page, page_size)

    def get(self, identity: str) -> Record:
        with self.units() as unit:
            return unit.logical_datasets.get(identity)

    def members(self, identity: str, page: int, page_size: int) -> Record:
        with self.units() as unit:
            return unit.logical_datasets.members(identity, page, page_size)

    def delete(self, identity: str) -> Record:
        with self.units() as unit:
            unit.logical_datasets.delete(identity)
        return {"deleted": True}
