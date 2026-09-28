/**
 * Frontend client for AI Interaction Memory API.
 */

import { RAG_API_BASE_URL } from '../rag/config';

export type InteractionStatus = 'applied' | 'undone' | 'redone';
export type InteractionProvenance = 'recent' | 'historical' | 'selected';

export interface InteractionView {
  id: string;
  board_id: string;
  user_prompt: string;
  action_summary: string;
  transaction_id: string;
  affected_element_ids: string[];
  created_element_ids: string[];
  updated_element_ids: string[];
  status: InteractionStatus;
  has_embedding: boolean;
  embedding_model: string | null;
  content_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
  similarity: number | null;
  provenance: InteractionProvenance | null;
}

export interface InteractionRetrieveResult {
  board_id: string;
  recent: InteractionView[];
  historical: InteractionView[];
  embedding_model: string | null;
  embedding_provider: string | null;
  recent_count: number;
  top_k: number;
  min_similarity: number | null;
}

export interface RecordInteractionInput {
  board_id: string;
  user_prompt: string;
  transaction_id: string;
  operations: unknown[];
  affected_element_ids: string[];
  created_element_ids: string[];
  updated_element_ids: string[];
  element_previews?: Record<string, string>;
  action_summary?: string;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message || body?.detail || res.statusText;
  } catch {
    return res.statusText;
  }
}

export const interactionMemoryApi = {
  async record(input: RecordInteractionInput): Promise<{ id: string; action_summary: string }> {
    const res = await fetch(`${RAG_API_BASE_URL}/api/interactions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async listRecent(boardId: string, limit?: number): Promise<InteractionView[]> {
    const q = limit != null ? `?limit=${limit}` : '';
    const res = await fetch(
      `${RAG_API_BASE_URL}/api/interactions/boards/${encodeURIComponent(boardId)}/recent${q}`,
    );
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async retrieve(
    boardId: string,
    body: {
      prompt: string;
      recent_count?: number;
      top_k?: number;
      selected_historical_ids?: string[];
    },
  ): Promise<InteractionRetrieveResult> {
    const res = await fetch(
      `${RAG_API_BASE_URL}/api/interactions/boards/${encodeURIComponent(boardId)}/retrieve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async setTransactionStatus(
    boardId: string,
    transactionId: string,
    status: InteractionStatus,
  ): Promise<InteractionView> {
    const res = await fetch(
      `${RAG_API_BASE_URL}/api/interactions/boards/${encodeURIComponent(boardId)}/transactions/${encodeURIComponent(transactionId)}/status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  },

  async detectUndoIntent(prompt: string): Promise<'undo' | 'redo' | null> {
    const res = await fetch(`${RAG_API_BASE_URL}/api/interactions/intent/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(await readError(res));
    const data = (await res.json()) as { intent: 'undo' | 'redo' | null };
    return data.intent;
  },
};
