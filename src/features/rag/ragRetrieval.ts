import type { TextElement } from '../../types/canvas';
import { RAG_API_BASE_URL } from './config';

export interface RetrieveRequest {
  board_id: string;
  prompt: string;
  top_k?: number;
  min_similarity?: number | null;
}

export interface MatchedChunk {
  chunk_id: string;
  chunk_index: number;
  text: string;
  similarity: number;
}

export interface RetrievedCandidate {
  element_id: string;
  element_type: string;
  score: number;
  matched_chunks: MatchedChunk[];
  geometry: { x: number; y: number; width: number; height: number };
}

export interface RetrieveResponse {
  board_id: string;
  query_chunks: number;
  query_chunk_texts: string[];
  embedding_model: string;
  embedding_provider: string;
  similarity_metric: string;
  top_k: number;
  min_similarity: number | null;
  candidates: RetrievedCandidate[];
}

export interface RagRetrievalService {
  retrieve(request: RetrieveRequest): Promise<RetrieveResponse>;
}

export function createRagRetrievalService(
  baseUrl: string = RAG_API_BASE_URL,
): RagRetrievalService {
  return {
    async retrieve(request) {
      const res = await fetch(`${baseUrl}/api/rag/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: request.board_id,
          prompt: request.prompt,
          ...(request.top_k !== undefined ? { top_k: request.top_k } : {}),
          ...(request.min_similarity !== undefined
            ? { min_similarity: request.min_similarity }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RAG retrieve failed (${res.status}): ${body}`);
      }
      return (await res.json()) as RetrieveResponse;
    },
  };
}

export const ragRetrievalService: RagRetrievalService = createRagRetrievalService();

/**
 * Development helper: call retrieve and log ranked candidates.
 * Not wired into the production Ask AI → LLM path yet.
 */
export async function debugRetrieve(
  boardId: string,
  prompt: string,
  resolveElement?: (id: string) => TextElement | undefined,
): Promise<RetrieveResponse> {
  const result = await ragRetrievalService.retrieve({ board_id: boardId, prompt });
  console.info('[rag:retrieve]', {
    query_chunks: result.query_chunks,
    model: result.embedding_model,
    min_similarity: result.min_similarity,
    candidates: result.candidates.map((c) => ({
      element_id: c.element_id,
      score: c.score,
      chunks: c.matched_chunks.map((m) => ({
        chunk_index: m.chunk_index,
        similarity: m.similarity,
        text: m.text.slice(0, 120),
      })),
      canvasText: resolveElement?.(c.element_id)?.text?.slice(0, 120),
    })),
  });
  return result;
}
