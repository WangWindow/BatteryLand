"""Persist synchronized asset metadata and user-defined logical datasets."""

import sqlalchemy as sa
from alembic import op

revision = "0011_catalog_logical"
down_revision = "0010_validated_split_reference"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("batteries") as batch:
        batch.add_column(sa.Column("file_size_bytes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("modified_at_ns", sa.BigInteger(), nullable=True))

    op.create_table(
        "catalog_scans",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("state", sa.String(), server_default="idle", nullable=False),
        sa.Column("generation", sa.Integer(), server_default="0", nullable=False),
        sa.Column("file_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("source_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("started_at", sa.String(), nullable=True),
        sa.Column("completed_at", sa.String(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
    )
    op.create_table(
        "logical_datasets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("description", sa.String(), server_default="", nullable=False),
        sa.Column("source_snapshot", sa.JSON(), nullable=False),
    )
    op.create_table(
        "logical_dataset_members",
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("battery_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["logical_datasets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["battery_id"], ["batteries.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "ordinal"),
        sa.UniqueConstraint("dataset_id", "battery_id"),
    )
    op.create_index(
        "ix_logical_dataset_member_battery", "logical_dataset_members", ["battery_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_logical_dataset_member_battery", "logical_dataset_members")
    op.drop_table("logical_dataset_members")
    op.drop_table("logical_datasets")
    op.drop_table("catalog_scans")
    with op.batch_alter_table("batteries") as batch:
        batch.drop_column("modified_at_ns")
        batch.drop_column("file_size_bytes")
