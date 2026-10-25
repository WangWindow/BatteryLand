"""Persist statistics for immutable split document versions."""

import sqlalchemy as sa
from alembic import op

revision = "0003_dataset_statistics"
down_revision = "0002_sqlite_document_payload"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dataset_statistics",
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("summary", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["document_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("document_id"),
    )


def downgrade() -> None:
    op.drop_table("dataset_statistics")
