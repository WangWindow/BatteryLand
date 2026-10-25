"""Initial business identities, versions and query projections."""

import sqlalchemy as sa
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:

    op.create_table(
        "components",
        sa.Column("provider_commit", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("source_hash", sa.String(), nullable=True),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("resource_ref", sa.String(), nullable=True),
        sa.Column("descriptor", sa.JSON(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_commit", "scope", "type"),
    )
    op.create_table(
        "data_sources",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("root_alias", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("availability", sa.String(), server_default="unchecked", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "document_versions",
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "owner_id", "version"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_table(
        "queue_sequence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "batteries",
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("file_name", sa.String(), nullable=False),
        sa.Column("relative_key", sa.String(), server_default="", nullable=False),
        sa.Column("parent_battery_id", sa.String(length=36), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("availability", sa.String(), server_default="unchecked", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["parent_battery_id"],
            ["batteries.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "file_name"),
    )
    op.create_index("ix_battery_parent", "batteries", ["parent_battery_id"], unique=False)
    op.create_index("ix_battery_source", "batteries", ["source_id"], unique=False)
    op.create_table(
        "experiments",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), server_default="train", nullable=False),
        sa.Column("state", sa.String(), server_default="draft", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("draft_document_id", sa.String(length=36), nullable=False),
        sa.Column("frozen_document_id", sa.String(length=36), nullable=True),
        sa.Column("split_document_id", sa.String(length=36), nullable=True),
        sa.Column("source_split_document_id", sa.String(length=36), nullable=True),
        sa.Column("target_split_document_id", sa.String(length=36), nullable=True),
        sa.Column("template_document_id", sa.String(length=36), nullable=True),
        sa.Column("checkpoint_id", sa.String(length=36), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('train','evaluate','transfer')"),
        sa.CheckConstraint(
            "state IN ('draft','queued','starting','running','stopping','succeeded','failed','cancelled','stopped','needs_reconciliation')"
        ),
        sa.ForeignKeyConstraint(
            ["checkpoint_id"], ["artifacts.id"], name="fk_experiment_checkpoint", use_alter=True
        ),
        sa.ForeignKeyConstraint(
            ["draft_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["frozen_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_split_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["split_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["target_split_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["template_document_id"],
            ["document_versions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_experiment_state_created", "experiments", ["state", "created_at"], unique=False
    )
    op.create_table(
        "splits",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("head_document_id", sa.String(length=36), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["head_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["data_sources.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "name"),
    )
    op.create_table(
        "templates",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("head_document_id", sa.String(length=36), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["head_document_id"],
            ["document_versions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "artifacts",
        sa.Column("experiment_id", sa.String(length=36), nullable=True),
        sa.Column("component_id", sa.String(length=36), nullable=True),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("relative_key", sa.String(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=True),
        sa.Column("size", sa.Integer(), nullable=True),
        sa.Column("availability", sa.String(), nullable=False),
        sa.Column("is_directory", sa.Boolean(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["component_id"],
            ["components.id"],
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("experiment_id", "relative_key"),
    )
    op.create_table(
        "executions",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("intent_id", sa.String(), nullable=False),
        sa.Column("queue_order", sa.Integer(), nullable=False),
        sa.Column("queued_at", sa.String(), nullable=False),
        sa.Column("requested_device", sa.String(), nullable=False),
        sa.Column("effective_device", sa.String(), nullable=True),
        sa.Column("prepared", sa.JSON(), nullable=True),
        sa.Column("receipt", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.String(), nullable=True),
        sa.Column("finished_at", sa.String(), nullable=True),
        sa.Column("stop_requested_at", sa.String(), nullable=True),
        sa.Column("stop_stage", sa.String(), nullable=True),
        sa.Column("stop_deadline", sa.Double(), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("experiment_id"),
        sa.UniqueConstraint("intent_id"),
        sa.UniqueConstraint("queue_order"),
    )
    op.create_table(
        "experiment_queries",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(), nullable=True),
        sa.Column("split_id", sa.String(), nullable=True),
        sa.Column("model_type", sa.String(), nullable=True),
        sa.Column("task_type", sa.String(), nullable=True),
        sa.Column("requested_device", sa.String(), nullable=True),
        sa.Column("source_domain", sa.String(), nullable=True),
        sa.Column("target_domain", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("experiment_id"),
    )
    op.create_index(
        "ix_experiment_domains",
        "experiment_queries",
        ["source_domain", "target_domain"],
        unique=False,
    )
    op.create_index(
        "ix_experiment_query_model_type",
        "experiment_queries",
        ["model_type", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_experiment_query_requested_device",
        "experiment_queries",
        ["requested_device", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_experiment_query_source_id",
        "experiment_queries",
        ["source_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_experiment_query_split_id",
        "experiment_queries",
        ["split_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_experiment_query_task_type",
        "experiment_queries",
        ["task_type", "created_at"],
        unique=False,
    )
    op.create_table(
        "ingestion_cursors",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("artifact_kind", sa.String(), nullable=False),
        sa.Column("file_identity", sa.String(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("byte_offset", sa.Integer(), nullable=False),
        sa.Column("source_hash", sa.String(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("experiment_id", "artifact_kind"),
    )
    op.create_table(
        "split_members",
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("battery_id", sa.String(length=36), nullable=False),
        sa.Column("partition", sa.String(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.CheckConstraint("partition IN ('train','val','test')"),
        sa.ForeignKeyConstraint(
            ["battery_id"],
            ["batteries.id"],
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["document_versions.id"],
        ),
        sa.PrimaryKeyConstraint("document_id", "battery_id"),
    )
    op.create_index("ix_member_battery", "split_members", ["battery_id"], unique=False)
    op.create_index(
        "ix_split_partition", "split_members", ["document_id", "partition", "ordinal"], unique=False
    )
    op.create_table(
        "metrics",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("record_type", sa.String(), nullable=False),
        sa.Column("source_document_id", sa.String(length=36), nullable=True),
        sa.Column("source_artifact_id", sa.String(length=36), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("record_offset", sa.Integer(), nullable=False),
        sa.Column("epoch", sa.Integer(), nullable=True),
        sa.Column("stage", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("value", sa.Double(), nullable=True),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("granularity", sa.String(), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["artifacts.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_document_id"],
            ["document_versions.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "experiment_id",
            "record_type",
            "source_artifact_id",
            "generation",
            "record_offset",
            "stage",
            "name",
        ),
    )
    op.create_index(
        "ix_metric_query",
        "metrics",
        ["experiment_id", "record_type", "stage", "epoch", "name"],
        unique=False,
    )
    op.create_table(
        "results",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("head_document_id", sa.String(length=36), nullable=True),
        sa.Column("source_artifact_id", sa.String(length=36), nullable=True),
        sa.Column("import_status", sa.String(), nullable=False),
        sa.Column("error", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["head_document_id"],
            ["document_versions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_artifact_id"],
            ["artifacts.id"],
        ),
        sa.PrimaryKeyConstraint("experiment_id"),
    )


def downgrade() -> None:

    op.drop_table("results")
    op.drop_index("ix_metric_query", table_name="metrics")
    op.drop_table("metrics")
    op.drop_index("ix_split_partition", table_name="split_members")
    op.drop_index("ix_member_battery", table_name="split_members")
    op.drop_table("split_members")
    op.drop_table("ingestion_cursors")
    op.drop_index("ix_experiment_query_task_type", table_name="experiment_queries")
    op.drop_index("ix_experiment_query_split_id", table_name="experiment_queries")
    op.drop_index("ix_experiment_query_source_id", table_name="experiment_queries")
    op.drop_index("ix_experiment_query_requested_device", table_name="experiment_queries")
    op.drop_index("ix_experiment_query_model_type", table_name="experiment_queries")
    op.drop_index("ix_experiment_domains", table_name="experiment_queries")
    op.drop_table("experiment_queries")
    op.drop_table("executions")
    op.drop_table("artifacts")
    op.drop_table("templates")
    op.drop_table("splits")
    op.drop_index("ix_experiment_state_created", table_name="experiments")
    op.drop_table("experiments")
    op.drop_index("ix_battery_source", table_name="batteries")
    op.drop_index("ix_battery_parent", table_name="batteries")
    op.drop_table("batteries")
    op.drop_table("queue_sequence")
    op.drop_table("document_versions")
    op.drop_table("data_sources")
    op.drop_table("components")
