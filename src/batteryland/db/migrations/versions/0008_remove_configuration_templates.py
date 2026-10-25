"""Remove template storage without rebuilding the referenced experiments table."""

from alembic import op

revision = "0008_remove_configuration_templates"
down_revision = "0007_validated_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("templates")
    # SQLite rebuilds experiments to drop this unused nullable column. Dropping
    # the original table fires ON DELETE CASCADE on validated inputs and runs.
    # Keep the orphaned column until a migration can remove it without data loss.


def downgrade() -> None:
    raise RuntimeError("Configuration-template storage is not restored by downgrade")
