"""enable pgvector + embedding columns on rag_chunks

Revision ID: 0002_rag_embeddings
Revises: 0001_rag_chunks
Create Date: 2026-09-24

Notes:
- Enables the pgvector extension for a future vector(N) + ANN migration.
- Stores embeddings as double precision[] so we do NOT hard-code a dimension
  before EMBEDDING_MODEL is chosen.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_rag_embeddings"
down_revision: Union[str, None] = "0001_rag_chunks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column(
        "rag_chunks",
        sa.Column("embedding", postgresql.ARRAY(sa.Float()), nullable=True),
    )
    op.add_column(
        "rag_chunks",
        sa.Column("embedding_model", sa.String(length=256), nullable=True),
    )
    op.add_column(
        "rag_chunks",
        sa.Column("embedding_provider", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "rag_chunks",
        sa.Column("embedding_content_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "rag_chunks",
        sa.Column("embedding_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rag_chunks", "embedding_updated_at")
    op.drop_column("rag_chunks", "embedding_content_hash")
    op.drop_column("rag_chunks", "embedding_provider")
    op.drop_column("rag_chunks", "embedding_model")
    op.drop_column("rag_chunks", "embedding")
    # Extension left installed (safe); uncomment to drop:
    # op.execute("DROP EXTENSION IF EXISTS vector")
