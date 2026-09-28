import { describe, expect, it } from 'vitest';
import { buildRagContext } from '../../rag/contextBuilder';
import { buildAgentContext } from '../agentContextBuilder';
import type { InteractionView } from '../interactionMemoryApi';

function makeInteraction(
  id: string,
  overrides: Partial<InteractionView> = {},
): InteractionView {
  return {
    id,
    board_id: 'board-1',
    user_prompt: `prompt ${id}`,
    action_summary: `summary ${id}`,
    transaction_id: `tx-${id}`,
    affected_element_ids: [],
    created_element_ids: [],
    updated_element_ids: [],
    status: 'applied',
    has_embedding: false,
    embedding_model: null,
    content_hash: null,
    created_at: null,
    updated_at: null,
    similarity: null,
    provenance: null,
    ...overrides,
  };
}

describe('buildAgentContext', () => {
  const canvasContext = buildRagContext({
    query: 'test',
    semanticAnchors: [],
    spatialHits: [],
  });

  it('deduplicates historical interactions that also appear in recent', () => {
    const shared = makeInteraction('ix-1', { provenance: 'recent' });
    const onlyHist = makeInteraction('ix-2', {
      provenance: 'historical',
      similarity: 0.7,
    });
    const ctx = buildAgentContext({
      userPrompt: 'refer to that',
      recentInteractions: [shared],
      historicalInteractions: [
        { ...shared, provenance: 'historical', similarity: 0.9 },
        onlyHist,
      ],
      canvasContext,
      existingElementIds: ['a', 'b'],
    });

    expect(ctx.recentInteractions).toHaveLength(1);
    expect(ctx.recentInteractions[0]!.id).toBe('ix-1');
    expect(ctx.relevantHistoricalInteractions).toHaveLength(1);
    expect(ctx.relevantHistoricalInteractions[0]!.id).toBe('ix-2');
  });

  it('preserves recent order and existing element ids', () => {
    const a = makeInteraction('a');
    const b = makeInteraction('b');
    const ctx = buildAgentContext({
      userPrompt: '  hello  ',
      recentInteractions: [a, b],
      historicalInteractions: [],
      canvasContext,
      existingElementIds: ['el-1'],
    });
    expect(ctx.currentUserRequest).toBe('hello');
    expect(ctx.recentInteractions.map((i) => i.id)).toEqual(['a', 'b']);
    expect(ctx.existingElementIds.has('el-1')).toBe(true);
  });
});
