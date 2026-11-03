/**
 * HTTP client for AI interaction memory (prompt + summary embeddings).
 */

export type InteractionMatchedField = 'prompt' | 'summary' | 'both';

export interface InteractionView {
  id: string;
  board_id: string;
  user_prompt: string;
  action_summary: string;
  transaction_id: string;
  affected_element_ids: string[];
  created_element_ids: string[];
  updated_element_ids: string[];
  status: string;
  has_prompt_embedding: boolean;
  has_summary_embedding: boolean;
  embedding_model: string | null;
  content_hash: string | null;
  created_at: string | null;
  updated_at: string | null;
  similarity?: number | null;
  prompt_similarity?: number | null;
  summary_similarity?: number | null;
  matched_field?: InteractionMatchedField | null;
}

export interface InteractionRecordRequest {
  board_id: string;
  user_prompt: string;
  action_summary: string;
  transaction_id: string;
  affected_element_ids?: string[];
  created_element_ids?: string[];
  updated_element_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface InteractionRecordResponse {
  id: string;
  board_id: string;
  transaction_id: string;
  action_summary: string;
  status: string;
  embeddings_written: boolean;
  embedding_model: string | null;
}

export interface InteractionRetrieveRequest {
  prompt: string;
  top_k?: number;
  min_similarity?: number | null;
}

export interface InteractionRetrieveResponse {
  board_id: string;
  matches: InteractionView[];
  embedding_model: string | null;
  embedding_provider: string | null;
  top_k: number;
  min_similarity: number | null;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: unknown; message?: string };
    if (typeof data.message === 'string') return data.message;
    if (typeof data.detail === 'string') return data.detail;
    return res.statusText || `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export const interactionMemoryApi = {
  async record(
    body: InteractionRecordRequest,
  ): Promise<InteractionRecordResponse> {
    const res = await fetch('/api/interactions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(await readError(res));
    }
    return (await res.json()) as InteractionRecordResponse;
  },

  async retrieve(
    boardId: string,
    body: InteractionRetrieveRequest,
  ): Promise<InteractionRetrieveResponse> {
    const res = await fetch(
      `/api/interactions/boards/${encodeURIComponent(boardId)}/retrieve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(await readError(res));
    }
    return (await res.json()) as InteractionRetrieveResponse;
  },
};
