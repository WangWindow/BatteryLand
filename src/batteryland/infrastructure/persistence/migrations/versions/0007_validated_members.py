"""Materialize member lookup and partition counts for existing validated drafts."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0007_validated_members"
down_revision = "0006_catalog_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("validated_inputs", sa.Column("split_counts", sa.JSON(), nullable=True))
    op.create_table(
        "validated_split_members",
        sa.Column("experiment_id", sa.String(length=36), primary_key=True),
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("partition", sa.String(), primary_key=True),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
        sa.Column("file_name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["experiment_id", "version"],
            ["validated_inputs.experiment_id", "validated_inputs.version"],
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("partition IN ('train','val','test')"),
    )
    op.create_index("ix_validated_member_file", "validated_split_members", ["file_name"])
    connection = op.get_bind()
    rows = list(
        connection.execute(
            sa.text("SELECT experiment_id, version, split FROM validated_inputs")
        ).mappings()
    )
    for row in rows:
        split = json.loads(row["split"]) if isinstance(row["split"], str) else row["split"]
        counts = {partition: len(split[partition]) for partition in ("train", "val", "test")}
        connection.execute(
            sa.text(
                "UPDATE validated_inputs SET split_counts=:counts "
                "WHERE experiment_id=:experiment_id AND version=:version"
            ),
            {
                "counts": json.dumps(counts),
                "experiment_id": row["experiment_id"],
                "version": row["version"],
            },
        )
        for partition in ("train", "val", "test"):
            for ordinal, file_name in enumerate(split[partition]):
                connection.execute(
                    sa.text(
                        "INSERT INTO validated_split_members "
                        "(experiment_id,version,partition,ordinal,file_name) "
                        "VALUES (:experiment_id,:version,:partition,:ordinal,:file_name)"
                    ),
                    {
                        "experiment_id": row["experiment_id"],
                        "version": row["version"],
                        "partition": partition,
                        "ordinal": ordinal,
                        "file_name": file_name,
                    },
                )


def downgrade() -> None:
    op.drop_index("ix_validated_member_file", "validated_split_members")
    op.drop_table("validated_split_members")
    op.drop_column("validated_inputs", "split_counts")
