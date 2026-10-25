"""Relational identity, state, and rebuildable query projections."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id() -> str:
    return str(uuid4())


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class Identity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    created_at: Mapped[str] = mapped_column(
        default=utc_now, server_default=text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    )


class DataSourceRow(Identity, Base):
    __tablename__ = "data_sources"
    name: Mapped[str] = mapped_column(unique=True)
    root_alias: Mapped[str]
    group_prefix: Mapped[str] = mapped_column(default="", server_default="")
    revision: Mapped[int] = mapped_column(default=1, server_default="1")
    availability: Mapped[str] = mapped_column(default="unchecked", server_default="unchecked")


class BatteryRow(Identity, Base):
    __tablename__ = "batteries"
    __table_args__ = (
        UniqueConstraint("source_id", "file_name"),
        Index("ix_battery_source", "source_id"),
        Index("ix_battery_parent", "parent_battery_id"),
    )
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.id"))
    file_name: Mapped[str]
    relative_key: Mapped[str] = mapped_column(default="", server_default="")
    parent_battery_id: Mapped[str | None] = mapped_column(ForeignKey("batteries.id"))
    attributes: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict, server_default="{}"
    )
    availability: Mapped[str] = mapped_column(default="unchecked", server_default="unchecked")


class NamedGroupRow(Identity, Base):
    __tablename__ = "named_groups"
    name: Mapped[str] = mapped_column(unique=True)
    manifest_sha256: Mapped[str]
    document: Mapped[dict[str, Any]] = mapped_column(JSON)
    counts: Mapped[dict[str, Any]] = mapped_column(JSON)


class NamedGroupMemberRow(Base):
    __tablename__ = "named_group_members"
    __table_args__ = (
        CheckConstraint("partition IN ('train','val','test')"),
        CheckConstraint("match_status IN ('matched','missing','ambiguous')"),
        Index("ix_named_group_member_battery", "battery_id"),
    )
    group_id: Mapped[str] = mapped_column(
        ForeignKey("named_groups.id", ondelete="CASCADE"), primary_key=True
    )
    partition: Mapped[str] = mapped_column(primary_key=True)
    ordinal: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str]
    battery_id: Mapped[str | None] = mapped_column(ForeignKey("batteries.id"))
    match_status: Mapped[str]
    candidate_count: Mapped[int]


class DocumentRow(Identity, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("kind", "owner_id", "version"),)
    kind: Mapped[str]
    owner_id: Mapped[str]
    version: Mapped[int]
    schema_version: Mapped[int] = mapped_column(default=1, server_default="1")
    sha256: Mapped[str]
    storage_key: Mapped[str] = mapped_column(unique=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class SplitRow(Identity, Base):
    __tablename__ = "splits"
    __table_args__ = (UniqueConstraint("source_id", "name"),)
    name: Mapped[str]
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.id"))
    head_document_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    revision: Mapped[int] = mapped_column(default=1, server_default="1")


class SplitMemberRow(Base):
    __tablename__ = "split_members"
    __table_args__ = (
        CheckConstraint("partition IN ('train','val','test')"),
        Index("ix_split_partition", "document_id", "partition", "ordinal"),
        Index("ix_member_battery", "battery_id"),
    )
    document_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"), primary_key=True)
    battery_id: Mapped[str] = mapped_column(ForeignKey("batteries.id"), primary_key=True)
    partition: Mapped[str]
    ordinal: Mapped[int]


class DatasetStatisticsRow(Base):
    __tablename__ = "dataset_statistics"
    document_id: Mapped[str] = mapped_column(
        ForeignKey("document_versions.id", ondelete="CASCADE"), primary_key=True
    )
    schema_version: Mapped[int] = mapped_column(default=1, server_default="1")
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)


class TemplateRow(Identity, Base):
    __tablename__ = "templates"
    name: Mapped[str] = mapped_column(unique=True)
    head_document_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    revision: Mapped[int] = mapped_column(default=1, server_default="1")


class ExperimentRow(Identity, Base):
    __tablename__ = "experiments"
    __table_args__ = (
        CheckConstraint("kind IN ('train','evaluate','transfer')"),
        CheckConstraint(
            "state IN ('draft','queued','starting','running','stopping','succeeded','failed',"
            "'cancelled','stopped','needs_reconciliation')"
        ),
        Index("ix_experiment_state_created", "state", "created_at"),
    )
    name: Mapped[str]
    kind: Mapped[str] = mapped_column(default="train", server_default="train")
    state: Mapped[str] = mapped_column(default="draft", server_default="draft")
    revision: Mapped[int] = mapped_column(default=1, server_default="1")
    draft_document_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    frozen_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    split_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    source_split_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    target_split_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    template_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    checkpoint_id: Mapped[str | None] = mapped_column(
        ForeignKey("artifacts.id", use_alter=True, name="fk_experiment_checkpoint")
    )


class ExperimentQueryRow(Base):
    __tablename__ = "experiment_queries"
    __table_args__ = tuple(
        Index(f"ix_experiment_query_{field}", field, "created_at")
        for field in ("source_id", "split_id", "model_type", "task_type", "requested_device")
    ) + (Index("ix_experiment_domains", "source_domain", "target_domain"),)
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), primary_key=True
    )
    document_id: Mapped[str] = mapped_column(ForeignKey("document_versions.id"))
    source_id: Mapped[str | None]
    split_id: Mapped[str | None]
    model_type: Mapped[str | None]
    task_type: Mapped[str | None]
    requested_device: Mapped[str | None]
    source_domain: Mapped[str | None]
    target_domain: Mapped[str | None]
    created_at: Mapped[str]


class ValidatedInputRow(Base):
    __tablename__ = "validated_inputs"
    __table_args__ = (Index("ix_validated_input_head", "experiment_id", "version"),)
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), primary_key=True
    )
    version: Mapped[int] = mapped_column(primary_key=True)
    config_text: Mapped[str]
    split_text: Mapped[str]
    config_sha256: Mapped[str]
    split_sha256: Mapped[str]
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    split: Mapped[dict[str, Any]] = mapped_column(JSON)
    split_counts: Mapped[dict[str, int] | None] = mapped_column(JSON)
    receipt: Mapped[dict[str, Any]] = mapped_column(JSON)
    provider_commit: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utc_now)


class ValidatedSplitMemberRow(Base):
    __tablename__ = "validated_split_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["experiment_id", "version"],
            ["validated_inputs.experiment_id", "validated_inputs.version"],
            ondelete="CASCADE",
        ),
        CheckConstraint("partition IN ('train','val','test')"),
        Index("ix_validated_member_file", "file_name"),
    )
    experiment_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    partition: Mapped[str] = mapped_column(primary_key=True)
    ordinal: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str]


class ExecutionRow(Base):
    __tablename__ = "executions"
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), primary_key=True
    )
    intent_id: Mapped[str] = mapped_column(unique=True)
    queue_order: Mapped[int] = mapped_column(unique=True)
    queued_at: Mapped[str] = mapped_column(default=utc_now)
    requested_device: Mapped[str]
    effective_device: Mapped[str | None]
    prepared: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    receipt: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    started_at: Mapped[str | None]
    finished_at: Mapped[str | None]
    stop_requested_at: Mapped[str | None]
    stop_stage: Mapped[str | None]
    stop_deadline: Mapped[float | None]
    exit_code: Mapped[int | None]
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    owner_node: Mapped[str | None]
    claim_request_id: Mapped[str | None] = mapped_column(unique=True)
    claim_token: Mapped[str | None] = mapped_column(unique=True)
    actual_device: Mapped[str | None]
    actual_gpu_uuid: Mapped[str | None]


class WorkerNodeRow(Base):
    __tablename__ = "worker_nodes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    last_seen_at: Mapped[str]
    resources: Mapped[dict[str, Any]] = mapped_column(JSON)


class ResourceSnapshotRow(Identity, Base):
    __tablename__ = "resource_snapshots"
    __table_args__ = (Index("ix_resource_node_time", "node_id", "created_at"),)
    node_id: Mapped[str] = mapped_column(ForeignKey("worker_nodes.id"))
    resources: Mapped[dict[str, Any]] = mapped_column(JSON)


class ExecutionEventRow(Base):
    __tablename__ = "execution_events"
    __table_args__ = (UniqueConstraint("experiment_id", "event_id"),)
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str]
    claim_token: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=utc_now)


class ComponentRow(Identity, Base):
    __tablename__ = "components"
    __table_args__ = (UniqueConstraint("provider_commit", "scope", "type"),)
    provider_commit: Mapped[str]
    scope: Mapped[str]
    type: Mapped[str]
    source_hash: Mapped[str | None]
    origin: Mapped[str]
    resource_ref: Mapped[str | None]
    descriptor: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ArtifactRow(Identity, Base):
    __tablename__ = "artifacts"
    __table_args__ = (UniqueConstraint("experiment_id", "relative_key"),)
    experiment_id: Mapped[str | None] = mapped_column(
        ForeignKey("experiments.id", ondelete="SET NULL")
    )
    component_id: Mapped[str | None] = mapped_column(ForeignKey("components.id"))
    origin: Mapped[str]
    kind: Mapped[str]
    name: Mapped[str]
    relative_key: Mapped[str]
    sha256: Mapped[str | None]
    size: Mapped[int | None]
    availability: Mapped[str] = mapped_column(default="available")
    is_directory: Mapped[bool] = mapped_column(default=False)


class ResultRow(Base):
    __tablename__ = "results"
    experiment_id: Mapped[str] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), primary_key=True
    )
    head_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    source_artifact_id: Mapped[str | None] = mapped_column(ForeignKey("artifacts.id"))
    import_status: Mapped[str] = mapped_column(default="unavailable")
    error: Mapped[str | None]


class MetricRow(Identity, Base):
    __tablename__ = "metrics"
    __table_args__ = (
        UniqueConstraint(
            "experiment_id",
            "record_type",
            "source_artifact_id",
            "generation",
            "record_offset",
            "stage",
            "name",
        ),
        Index("ix_metric_query", "experiment_id", "record_type", "stage", "epoch", "name"),
    )
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    record_type: Mapped[str]
    source_document_id: Mapped[str | None] = mapped_column(ForeignKey("document_versions.id"))
    source_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    generation: Mapped[int]
    record_offset: Mapped[int]
    epoch: Mapped[int | None]
    stage: Mapped[str]
    name: Mapped[str]
    value: Mapped[float | None]
    unit: Mapped[str]
    granularity: Mapped[str]


class IngestionCursorRow(Identity, Base):
    __tablename__ = "ingestion_cursors"
    __table_args__ = (UniqueConstraint("experiment_id", "artifact_kind"),)
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"))
    artifact_kind: Mapped[str]
    file_identity: Mapped[str]
    generation: Mapped[int] = mapped_column(default=1)
    byte_offset: Mapped[int] = mapped_column(default=0)
    source_hash: Mapped[str | None]
    revision: Mapped[int] = mapped_column(default=1)


class QueueSequenceRow(Base):
    __tablename__ = "queue_sequence"
    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[int] = mapped_column(default=0)
