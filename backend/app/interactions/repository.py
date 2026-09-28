from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import AiInteraction
from ..rag.embeddings.base import EmbeddingVector
from ..rag.repository import embedding_as_list


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
        affected_element_ids: list[str],
        created_element_ids: list[str],
        updated_element_ids: list[str],
        operations_json: list,
        status: str = "applied",
        embedding: Sequence[float] | None = None,
        embedding_model: str | None = None,
        embedding_provider: str | None = None,
        content_hash: str | None = None,
    ) -> AiInteraction:
        row = AiInteraction(
            board_id=board_id,
            user_prompt=user_prompt,
            action_summary=action_summary,
            transaction_id=transaction_id,
            affected_element_ids=list(affected_element_ids),
            created_element_ids=list(created_element_ids),
            updated_element_ids=list(updated_element_ids),
            operations_json=list(operations_json),
            status=status,
            embedding=list(embedding) if embedding is not None else None,
            embedding_model=embedding_model if embedding is not None else None,
            embedding_provider=embedding_provider if embedding is not None else None,
            content_hash=content_hash,
        )
        self.session.add(row)
        self.session.flush()
        return row

    def list_recent_for_board(self, board_id: str, *, limit: int) -> list[AiInteraction]:
        """Newest first."""
        if limit <= 0:
            return []
        stmt = (
            select(AiInteraction)
            .where(AiInteraction.board_id == board_id)
            .order_by(AiInteraction.created_at.desc(), AiInteraction.id.desc())
            .limit(limit)
        )
        return list(self.session.scalars(stmt).all())

    def list_for_board(self, board_id: str) -> list[AiInteraction]:
        stmt = (
            select(AiInteraction)
            .where(AiInteraction.board_id == board_id)
            .order_by(AiInteraction.created_at.desc(), AiInteraction.id.desc())
        )
        return list(self.session.scalars(stmt).all())

    def list_embedded_for_board(
        self,
        board_id: str,
        *,
        embedding_model: str,
    ) -> list[AiInteraction]:
        """Interactions eligible for semantic search under the active model."""
        stmt = (
            select(AiInteraction)
            .where(
                AiInteraction.board_id == board_id,
                AiInteraction.embedding.is_not(None),
                AiInteraction.embedding_model == embedding_model,
            )
            .order_by(AiInteraction.created_at.desc(), AiInteraction.id.desc())
        )
        return list(self.session.scalars(stmt).all())

    def get_by_ids(self, board_id: str, ids: Sequence[str | UUID]) -> list[AiInteraction]:
        if not ids:
            return []
        parsed: list[UUID] = []
        for raw in ids:
            if isinstance(raw, UUID):
                parsed.append(raw)
            else:
                try:
                    parsed.append(UUID(str(raw)))
                except ValueError:
                    continue
        if not parsed:
            return []
        stmt = select(AiInteraction).where(
            AiInteraction.board_id == board_id,
            AiInteraction.id.in_(parsed),
        )
        return list(self.session.scalars(stmt).all())

    def update_status_by_transaction(
        self,
        board_id: str,
        transaction_id: str,
        status: str,
    ) -> AiInteraction | None:
        stmt = (
            select(AiInteraction)
            .where(
                AiInteraction.board_id == board_id,
                AiInteraction.transaction_id == transaction_id,
            )
            .order_by(AiInteraction.created_at.desc())
            .limit(1)
        )
        row = self.session.scalars(stmt).first()
        if row is None:
            return None
        row.status = status
        row.updated_at = datetime.now(timezone.utc)
        self.session.flush()
        return row

    def list_needing_reembed(
        self,
        board_id: str,
        *,
        embedding_model: str,
        content_hashes: dict[str, str] | None = None,
    ) -> list[AiInteraction]:
        """Rows missing an embedding, on a different model, or with stale content_hash.

        When ``content_hashes`` is provided (id → expected hash), also include rows
        whose stored content_hash differs. Otherwise return NULL / wrong-model rows.
        """
        rows = self.list_for_board(board_id)
        needing: list[AiInteraction] = []
        for row in rows:
            if row.embedding is None or row.embedding_model != embedding_model:
                needing.append(row)
                continue
            if content_hashes is not None:
                expected = content_hashes.get(str(row.id))
                if expected is not None and row.content_hash != expected:
                    needing.append(row)
        return needing

    def update_embedding(
        self,
        row: AiInteraction,
        vector: EmbeddingVector,
        *,
        embedding_model: str,
        embedding_provider: str,
        content_hash: str,
    ) -> None:
        row.embedding = list(vector)
        row.embedding_model = embedding_model
        row.embedding_provider = embedding_provider
        row.content_hash = content_hash
        row.updated_at = datetime.now(timezone.utc)


def interaction_embedding_as_list(value) -> list[float] | None:
    return embedding_as_list(value)
