"""Persist worker ownership, resources and idempotent execution events."""

import sqlalchemy as sa
from alembic import op

revision = "0005_worker_protocol"
down_revision = "0004_validated_inputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("executions", sa.Column("owner_node", sa.String(), nullable=True))
    op.add_column("executions", sa.Column("claim_request_id", sa.String(), nullable=True))
    op.add_column("executions", sa.Column("claim_token", sa.String(), nullable=True))
    op.add_column("executions", sa.Column("actual_device", sa.String(), nullable=True))
    op.add_column("executions", sa.Column("actual_gpu_uuid", sa.String(), nullable=True))
    op.create_index("uq_execution_claim_request", "executions", ["claim_request_id"], unique=True)
    op.create_index("uq_execution_claim_token", "executions", ["claim_token"], unique=True)
    op.create_table(
        "worker_nodes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("last_seen_at", sa.String(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
    )
    op.create_table(
        "resource_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column(
            "node_id", sa.String(length=36), sa.ForeignKey("worker_nodes.id"), nullable=False
        ),
        sa.Column("resources", sa.JSON(), nullable=False),
    )
    op.create_index("ix_resource_node_time", "resource_snapshots", ["node_id", "created_at"])
    op.create_table(
        "execution_events",
        sa.Column(
            "experiment_id",
            sa.String(length=36),
            sa.ForeignKey("experiments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("event_id", sa.String(length=36), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("claim_token", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("execution_events")
    op.drop_index("ix_resource_node_time", "resource_snapshots")
    op.drop_table("resource_snapshots")
    op.drop_table("worker_nodes")
    op.drop_index("uq_execution_claim_token", "executions")
    op.drop_index("uq_execution_claim_request", "executions")
    for name in (
        "actual_gpu_uuid",
        "actual_device",
        "claim_token",
        "claim_request_id",
        "owner_node",
    ):
        op.drop_column("executions", name)
