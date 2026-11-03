from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import AiInteraction
from ..rag.embeddings.base import EmbeddingVector


def _as_list(vec: EmbeddingVector | None) -> list[float] | None:
    if vec is None:
        return None
    return [float(x) for x in vec]


class AiInteractionRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        *,
        board_id: str,
        user_prompt: str,
        action_summary: str,
        transaction_id: str,
        affected_element_ids: Sequence[str],
        created_element_ids: Sequence[str],
        updated_element_ids: Sequence[str],
        metadata: dict[str, Any] | None,
        status: str,
        prompt_embedding: EmbeddingVector | None,
        summary_embedding: EmbeddingVector | None,
        embedding_model: str | None,
        embedding_provider: str | None,
        content_hash: str | None,
    ) -> AiInteraction:
        row = AiInteraction(
            id=uuid.uuid4(),
            board_id=board_id,
            user_prompt=user_prompt,
            action_summary=action_summary,
            transaction_id=transaction_id,
            affected_element_ids=list(affected_element_ids),
            created_element_ids=list(created_element_ids),
            updated_element_ids=list(updated_element_ids),
            metadata_json=metadata,
            status=status,
            prompt_embedding=_as_list(prompt_embedding),
            summary_embedding=_as_list(summary_embedding),
            embedding_model=embedding_model,
            embedding_provider=embedding_provider,
            content_hash=content_hash,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def list_for_board(self, board_id: str) -> list[AiInteraction]:
        stmt = (
            select(AiInteraction)
            .where(AiInteraction.board_id == board_id)
            .order_by(AiInteraction.created_at.asc())
        )
        return list(self.session.scalars(stmt).all())

    def list_embedded_for_board(
        self,
        board_id: str,
        *,
        embedding_model: str,
    ) -> list[AiInteraction]:
        """Rows with both embeddings present under the active model."""
        stmt = (
            select(AiInteraction)
            .where(
                AiInteraction.board_id == board_id,
                AiInteraction.prompt_embedding.is_not(None),
                AiInteraction.summary_embedding.is_not(None),
                AiInteraction.embedding_model == embedding_model,
                AiInteraction.status == "applied",
            )
            .order_by(AiInteraction.created_at.asc())
        )
        return list(self.session.scalars(stmt).all())

    def update_embeddings(
        self,
        row: AiInteraction,
        *,
        prompt_embedding: EmbeddingVector,
        summary_embedding: EmbeddingVector,
        embedding_model: str,
        embedding_provider: str,
        content_hash: str,
    ) -> None:
        row.prompt_embedding = _as_list(prompt_embedding)
        row.summary_embedding = _as_list(summary_embedding)
        row.embedding_model = embedding_model
        row.embedding_provider = embedding_provider
        row.content_hash = content_hash
        row.updated_at = datetime.now(timezone.utc)
        self.session.flush()
