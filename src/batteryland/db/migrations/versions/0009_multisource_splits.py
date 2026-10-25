"""Allow a versioned split to reference batteries from multiple sources."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0009_multisource_splits"
down_revision = "0008_remove_configuration_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    heads = {
        row["head_document_id"]: row["source_id"]
        for row in connection.execute(sa.text("SELECT head_document_id, source_id FROM splits"))
        .mappings()
    }
    documents = list(
        connection.execute(
            sa.text(
                "SELECT id, payload FROM document_versions "
                "WHERE kind = 'split' ORDER BY owner_id, version"
            )
        ).mappings()
    )

    op.create_table(
        "split_sources",
        sa.Column("document_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.String(length=36), nullable=False),
        sa.Column("source_revision", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"], ["document_versions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["source_id"], ["data_sources.id"]),
        sa.PrimaryKeyConstraint("document_id", "source_id"),
    )
    op.create_index("ix_split_source", "split_sources", ["source_id", "document_id"])

    for document in documents:
        payload = document["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        source_id = payload.get("source_id") if isinstance(payload, dict) else None
        if source_id is None:
            source_id = heads.get(document["id"])
        if source_id is None:
            continue
        revision_value = payload.get("source_revision", 1) if isinstance(payload, dict) else 1
        connection.execute(
            sa.text(
                "INSERT INTO split_sources (document_id, source_id, source_revision) "
                "VALUES (:document_id, :source_id, :source_revision)"
            ),
            {
                "document_id": document["id"],
                "source_id": source_id,
                "source_revision": revision_value,
            },
        )

    op.create_table(
        "splits_new",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("head_document_id", sa.String(length=36), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.String(),
            server_default=sa.text("(strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["head_document_id"], ["document_versions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    connection.execute(
        sa.text(
            "INSERT INTO splits_new (name, head_document_id, revision, id, created_at) "
            "SELECT name, head_document_id, revision, id, created_at FROM splits"
        )
    )
    op.drop_table("splits")
    op.rename_table("splits_new", "splits")


def downgrade() -> None:
    raise RuntimeError("Multi-source split records cannot be downgraded without data loss")
