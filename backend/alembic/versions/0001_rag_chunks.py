"""create rag_chunks table

Revision ID: 0001_rag_chunks
Revises:
Create Date: 2026-09-24
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_rag_chunks"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rag_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("board_id", sa.String(length=128), nullable=False),
        sa.Column("element_id", sa.String(length=128), nullable=False),
        sa.Column("element_type", sa.String(length=64), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("start_char", sa.Integer(), nullable=False),
        sa.Column("end_char", sa.Integer(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("width", sa.Float(), nullable=False),
        sa.Column("height", sa.Float(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("element_revision", sa.String(length=128), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
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
        sa.UniqueConstraint(
            "board_id",
            "element_id",
            "chunk_index",
            name="uq_rag_chunks_board_element_index",
        ),
    )
    op.create_index("ix_rag_chunks_board_id", "rag_chunks", ["board_id"])
    op.create_index("ix_rag_chunks_element_id", "rag_chunks", ["element_id"])
    op.create_index(
        "ix_rag_chunks_board_element",
        "rag_chunks",
        ["board_id", "element_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_rag_chunks_board_element", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_element_id", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_board_id", table_name="rag_chunks")
    op.drop_table("rag_chunks")
