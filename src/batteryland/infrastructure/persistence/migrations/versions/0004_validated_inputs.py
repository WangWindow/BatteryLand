"""Store original validated input alongside parsed query data."""

import sqlalchemy as sa
from alembic import op

revision = "0004_validated_inputs"
down_revision = "0003_dataset_statistics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "validated_inputs",
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("config_text", sa.String(), nullable=False),
        sa.Column("split_text", sa.String(), nullable=False),
        sa.Column("config_sha256", sa.String(), nullable=False),
        sa.Column("split_sha256", sa.String(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("split", sa.JSON(), nullable=False),
        sa.Column("receipt", sa.JSON(), nullable=False),
        sa.Column("provider_commit", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["experiment_id"], ["experiments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("experiment_id", "version"),
    )
    op.create_index("ix_validated_input_head", "validated_inputs", ["experiment_id", "version"])


def downgrade() -> None:
    op.drop_index("ix_validated_input_head", "validated_inputs")
    op.drop_table("validated_inputs")
