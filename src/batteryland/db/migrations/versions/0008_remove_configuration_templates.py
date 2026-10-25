"""Remove the template workflow; saved configurations are validated experiments."""

import sqlalchemy as sa
from alembic import op

revision = "0008_remove_configuration_templates"
down_revision = "0007_validated_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("templates")
    with op.batch_alter_table(
        "experiments",
        naming_convention={
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
        },
        table_args=(
            sa.CheckConstraint("kind IN ('train','evaluate','transfer')"),
            sa.CheckConstraint(
                "state IN ('draft','queued','starting','running','stopping','succeeded','failed',"
                "'cancelled','stopped','needs_reconciliation')"
            ),
        ),
    ) as batch_op:
        batch_op.drop_constraint(
            "fk_experiments_template_document_id_document_versions", type_="foreignkey"
        )
        batch_op.drop_column("template_document_id")


def downgrade() -> None:
    raise RuntimeError("Configuration-template storage is not restored by downgrade")
