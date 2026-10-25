"""Store the saved split version used to validate each experiment draft."""

import sqlalchemy as sa
from alembic import op

revision = "0010_validated_split_reference"
down_revision = "0009_multisource_splits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("validated_inputs") as batch_op:
        batch_op.add_column(sa.Column("split_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("split_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("validated_inputs") as batch_op:
        batch_op.drop_column("split_version")
        batch_op.drop_column("split_id")
