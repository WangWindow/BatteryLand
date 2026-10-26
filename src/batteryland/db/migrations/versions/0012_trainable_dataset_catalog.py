"""Use versioned splits as the only catalog for trainable datasets."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0012_trainable_dataset_catalog"
down_revision = "0011_catalog_logical"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("splits") as batch:
        batch.add_column(sa.Column("origin", sa.String(), server_default="created", nullable=False))
        batch.add_column(sa.Column("source_ref", sa.String(), nullable=True))
        batch.add_column(sa.Column("source_hash", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("execution_ready", sa.Boolean(), server_default="1", nullable=False)
        )
        batch.add_column(sa.Column("counts", sa.JSON(), server_default="{}", nullable=False))
        batch.add_column(sa.Column("resolution", sa.JSON(), server_default="{}", nullable=False))
        batch.create_unique_constraint("uq_splits_source_ref", ["source_ref"])

    connection = op.get_bind()
    rows = list(connection.execute(sa.text("SELECT id, head_document_id FROM splits")).mappings())
    for row in rows:
        counts = {
            partition: connection.scalar(
                sa.text(
                    "SELECT count(*) FROM split_members "
                    "WHERE document_id = :document_id AND partition = :partition"
                ),
                {"document_id": row["head_document_id"], "partition": partition},
            )
            or 0
            for partition in ("train", "val", "test")
        }
        connection.execute(
            sa.text("UPDATE splits SET counts = :counts WHERE id = :id"),
            {"id": row["id"], "counts": json.dumps(counts)},
        )

    op.drop_index("ix_named_group_member_battery", table_name="named_group_members")
    op.drop_table("named_group_members")
    op.drop_table("named_groups")


def downgrade() -> None:
    raise RuntimeError(
        "Trainable dataset migration cannot be downgraded without losing catalog data"
    )
