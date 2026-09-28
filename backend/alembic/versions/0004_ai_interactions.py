"""create ai_interactions table for interaction memory

Revision ID: 0004_ai_interactions
Revises: 0003_embedding_vector_768
Create Date: 2026-09-28

Notes:
- Stores applied AI canvas interactions with optional Vector(768) embeddings
  (same dimension as rag_chunks / EmbeddingGemma).
- Embeddings remain NULL until an embedding provider is configured.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "0004_ai_interactions"
down_revision: Union[str, None] = "0003_embedding_vector_768"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "ai_interactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("board_id", sa.String(length=128), nullable=False),
        sa.Column("user_prompt", sa.Text(), nullable=False),
        sa.Column("action_summary", sa.Text(), nullable=False),
        sa.Column("transaction_id", sa.String(length=128), nullable=False),
        sa.Column(
            "affected_element_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_element_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "updated_element_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "operations_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="applied",
        ),
        sa.Column("embedding", Vector(768), nullable=True),
        sa.Column("embedding_model", sa.String(length=256), nullable=True),
        sa.Column("embedding_provider", sa.String(length=64), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_ai_interactions_board_id", "ai_interactions", ["board_id"])
    op.create_index(
        "ix_ai_interactions_transaction_id",
        "ai_interactions",
        ["transaction_id"],
    )
    op.create_index(
        "ix_ai_interactions_board_created_at",
        "ai_interactions",
        ["board_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_interactions_board_created_at", table_name="ai_interactions")
    op.drop_index("ix_ai_interactions_transaction_id", table_name="ai_interactions")
    op.drop_index("ix_ai_interactions_board_id", table_name="ai_interactions")
    op.drop_table("ai_interactions")
