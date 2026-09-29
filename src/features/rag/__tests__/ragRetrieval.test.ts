import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRagRetrievalService, debugRetrieve } from '../ragRetrieval';

describe('ragRetrievalService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs to /api/rag/retrieve', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          board_id: 'b1',
          query_chunks: 1,
          query_chunk_texts: ['gauss'],
          embedding_model: 'det',
          embedding_provider: 'deterministic',
          similarity_metric: 'cosine',
          top_k: 20,
          min_similarity: null,
          candidates: [
            {
              element_id: 'el-1',
              element_type: 'text',
              score: 0.9,
              matched_chunks: [
                { chunk_id: 'c1', chunk_index: 0, text: 'flux', similarity: 0.9 },
              ],
              geometry: { x: 1, y: 2, width: 3, height: 4 },
            },
          ],
          prompt_intent: {
            classified_intent: 'general',
            top_score: 0.8,
            second_score: 0.5,
            score_margin: 0.3,
            embedding_model: 'det',
            embedding_provider: 'deterministic',
            scores: [
              {
                intent: 'general',
                similarity: 0.8,
                description: 'general proto',
                display_name: 'General',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const svc = createRagRetrievalService('http://example.test');
    const result = await svc.retrieve({ board_id: 'b1', prompt: 'gauss' });
    expect(result.candidates[0]?.element_id).toBe('el-1');
    expect(result.min_similarity).toBeNull();
    expect(result.prompt_intent?.classified_intent).toBe('general');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/api/rag/retrieve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('debugRetrieve logs without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            board_id: 'b1',
            query_chunks: 1,
            query_chunk_texts: ['q'],
            embedding_model: 'm',
            embedding_provider: 'p',
            similarity_metric: 'cosine',
            top_k: 5,
            min_similarity: null,
            candidates: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await debugRetrieve('b1', 'prompt');
    expect(info).toHaveBeenCalled();
  });
});
