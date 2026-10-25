from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from batteryland.common.errors import DomainError
from batteryland.datasets.repository import page_of
from batteryland.db.contracts import Record
from batteryland.db.models import ArtifactRow, ComponentRow


def artifact_value(row: ArtifactRow) -> Record:
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "experiment_id",
            "component_id",
            "origin",
            "kind",
            "name",
            "relative_key",
            "sha256",
            "size",
            "availability",
            "is_directory",
            "created_at",
        )
    }


class SqlArtifactRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, identity: str) -> Record:
        row = self.session.get(ArtifactRow, identity)
        if row is None:
            raise DomainError("not_found", "Artifact not found")
        return artifact_value(row)

    def add(self, value: Record) -> Record:
        row = ArtifactRow(**value)
        self.session.add(row)
        self.session.flush()
        return artifact_value(row)

    def upsert(self, value: Record) -> Record:
        row = self.session.scalar(
            select(ArtifactRow).where(
                ArtifactRow.experiment_id == value["experiment_id"],
                ArtifactRow.relative_key == value["relative_key"],
            )
        )
        if row is None:
            return self.add(value)
        if any(
            getattr(row, key) != value.get(key)
            for key in ("kind", "origin", "name", "component_id")
        ):
            raise DomainError("conflict", "Artifact identity already has different metadata")
        for key in ("sha256", "size", "availability"):
            setattr(row, key, value[key])
        self.session.flush()
        return artifact_value(row)

    @staticmethod
    def _component(row: ComponentRow) -> Record:
        return {
            "id": row.id,
            "provider_commit": row.provider_commit,
            "scope": row.scope,
            "type": row.type,
            "source_hash": row.source_hash,
            "origin": row.origin,
            "resource_ref": row.resource_ref,
            "schema": row.descriptor or None,
        }

    def sync_components(self, values: list[Record]) -> list[Record]:
        result = []
        for value in values:
            identity = str(
                uuid5(NAMESPACE_URL, f"{value['provider_commit']}:{value['scope']}:{value['type']}")
            )
            row = self.session.get(ComponentRow, identity)
            if row is None:
                row = ComponentRow(
                    id=identity,
                    provider_commit=value["provider_commit"],
                    scope=value["scope"],
                    type=value["type"],
                    source_hash=value.get("source_hash"),
                    origin=value["origin"],
                    resource_ref=f"{value['origin']}:{value['path']}",
                    descriptor=value.get("schema") or {},
                )
                self.session.add(row)
            else:
                # The catalog tracks current source; saved experiment snapshots retain their hashes.
                content_changed = row.source_hash != value.get("source_hash")
                row.source_hash = value.get("source_hash")
                row.origin = value["origin"]
                row.resource_ref = f"{value['origin']}:{value['path']}"
                if content_changed:
                    row.descriptor = value.get("schema") or {}
                elif value.get("schema"):
                    row.descriptor = value["schema"]
            self.session.flush()
            result.append(self._component(row))
        return result

    def component(self, identity: str) -> Record:
        row = self.session.get(ComponentRow, identity)
        if row is None:
            raise DomainError("not_found", "Component not found")
        return self._component(row)

    def checkpoints(self, filters: Record, page: int, page_size: int) -> Record:
        statement = select(ArtifactRow).where(ArtifactRow.kind == "checkpoint")
        if filters.get("component_id"):
            statement = statement.where(ArtifactRow.component_id == filters["component_id"])
        if filters.get("source_experiment_id"):
            statement = statement.where(
                ArtifactRow.experiment_id == filters["source_experiment_id"]
            )
        return page_of(
            self.session,
            statement.order_by(ArtifactRow.created_at.desc(), ArtifactRow.id.desc()),
            artifact_value,
            page,
            page_size,
        )

    def for_experiment(self, identity: str) -> list[Record]:
        return [
            artifact_value(row)
            for row in self.session.scalars(
                select(ArtifactRow)
                .where(ArtifactRow.experiment_id == identity)
                .order_by(ArtifactRow.relative_key)
            )
        ]
