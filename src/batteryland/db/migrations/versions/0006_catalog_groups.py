"""Preserve original folder identity and provider-named split membership."""

import sqlalchemy as sa
from alembic import op

revision = "0006_catalog_groups"
down_revision = "0005_worker_protocol"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_sources", sa.Column("group_prefix", sa.String(), server_default="", nullable=False)
    )
    op.create_table(
        "named_groups",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("manifest_sha256", sa.String(), nullable=False),
        sa.Column("document", sa.JSON(), nullable=False),
        sa.Column("counts", sa.JSON(), nullable=False),
    )
    op.create_table(
        "named_group_members",
        sa.Column(
            "group_id",
            sa.String(length=36),
            sa.ForeignKey("named_groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("partition", sa.String(), primary_key=True),
        sa.Column("ordinal", sa.Integer(), primary_key=True),
        sa.Column("file_name", sa.String(), nullable=False),
        sa.Column("battery_id", sa.String(length=36), sa.ForeignKey("batteries.id"), nullable=True),
        sa.Column("match_status", sa.String(), nullable=False),
        sa.Column("candidate_count", sa.Integer(), nullable=False),
        sa.CheckConstraint("partition IN ('train','val','test')"),
        sa.CheckConstraint("match_status IN ('matched','missing','ambiguous')"),
    )
    op.create_index("ix_named_group_member_battery", "named_group_members", ["battery_id"])


def downgrade() -> None:
    op.drop_index("ix_named_group_member_battery", "named_group_members")
    op.drop_table("named_group_members")
    op.drop_table("named_groups")
    op.drop_column("data_sources", "group_prefix")
