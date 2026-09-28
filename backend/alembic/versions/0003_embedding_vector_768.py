"""migrate rag_chunks.embedding to pgvector vector(768)

Revision ID: 0003_embedding_vector_768
Revises: 0002_rag_embeddings
Create Date: 2026-09-28

Notes:
- EMBEDDING_MODEL is now google/embeddinggemma-300m (768-d).
- Clears embeddings whose length is not 768 (treat as stale).
- Converts float[] → vector(768). Existing NULL embeddings stay NULL
  until board/element rebuild.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0003_embedding_vector_768"
down_revision: Union[str, None] = "0002_rag_embeddings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # Stale / wrong-dimension vectors cannot cast cleanly — null them out.
    op.execute(
        """
        UPDATE rag_chunks
        SET
          embedding = NULL,
          embedding_model = NULL,
          embedding_provider = NULL,
          embedding_content_hash = NULL,
          embedding_updated_at = NULL
        WHERE embedding IS NOT NULL
          AND COALESCE(array_length(embedding, 1), 0) <> 768
        """
    )
    op.execute(
        """
        ALTER TABLE rag_chunks
        ALTER COLUMN embedding TYPE vector(768)
        USING CASE
          WHEN embedding IS NULL THEN NULL
          ELSE embedding::vector(768)
        END
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE rag_chunks
        ALTER COLUMN embedding TYPE double precision[]
        USING CASE
          WHEN embedding IS NULL THEN NULL
          ELSE embedding::double precision[]
        END
        """
    )
