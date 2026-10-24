"""Store versioned document bodies in SQLite JSON columns."""

import sqlalchemy as sa
from alembic import op

revision = "0002_sqlite_document_payload"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_versions", sa.Column("payload", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("document_versions") as batch:
        batch.drop_column("payload")
