import { describe, expect, it } from 'vitest';
import { buildRagContext, type SemanticAnchorInput } from '../../rag/contextBuilder';
import type { SpatialHit } from '../../rag/spatialContext';
import { buildLlmPrompt } from '../llm/promptBuilder';
import { RAG_SYSTEM_INSTRUCTIONS, RAG_RESPONSE_INSTRUCTIONS } from '../prompts/instructions';

const anchorA: SemanticAnchorInput = {
  element_id: 'textbox_18',
  element_type: 'text',
  similarity: 0.86,
  matched_chunks: [
    { chunk_id: 'c0', chunk_index: 0, text: 'chunk only', similarity: 0.86 },
  ],
  geometry: { x: 10, y: 20, width: 100, height: 40 },
  text: "Gauss's law relates electric flux to enclosed charge. FULL TEXT.",
};

const hitB: SpatialHit = {
  element_id: 'textbox_22',
  element_type: 'text',
  anchor_element_id: 'textbox_18',
  distance: 143.2,
  geometry: { x: 200, y: 20, width: 100, height: 40 },
  text: 'For spherical symmetry the field is constant on a shell.',
};

describe('buildLlmPrompt', () => {
  const context = buildRagContext({
    query: 'Explain why Gauss\'s law is useful for spherical symmetry.',
    semanticAnchors: [anchorA],
    spatialHits: [hitB],
  });

  const built = buildLlmPrompt({
    userPrompt: 'Explain why Gauss\'s law is useful for spherical symmetry.',
    ragContext: context,
  });

  it('includes system instructions', () => {
    expect(built.finalLlmPrompt).toContain('SYSTEM INSTRUCTIONS');
    expect(built.finalLlmPrompt).toContain('infinite study canvas');
    expect(built.systemInstructions).toBe(RAG_SYSTEM_INSTRUCTIONS);
  });

  it('includes canvas context with full textbox text (not only chunk)', () => {
    expect(built.finalLlmPrompt).toContain('CANVAS CONTEXT');
    expect(built.finalLlmPrompt).toContain('FULL TEXT.');
    expect(built.finalLlmPrompt).not.toContain('chunk only');
  });

  it('includes original user prompt separately', () => {
    expect(built.userPrompt).toBe(
      "Explain why Gauss's law is useful for spherical symmetry.",
    );
    expect(built.finalLlmPrompt).toContain('USER REQUEST');
    expect(built.finalLlmPrompt).toContain(built.userPrompt);
  });

  it('includes semantic provenance', () => {
    expect(built.finalLlmPrompt).toContain('ID: textbox_18');
    expect(built.finalLlmPrompt).toContain('SEMANTIC SIMILARITY:');
    expect(built.finalLlmPrompt).toContain('0.8600');
  });

  it('includes spatial provenance', () => {
    expect(built.finalLlmPrompt).toContain('ID: textbox_22');
    expect(built.finalLlmPrompt).toContain('SPATIAL ANCHOR:');
    expect(built.finalLlmPrompt).toContain('textbox_18');
    expect(built.finalLlmPrompt).toContain('DISTANCE:');
    expect(built.finalLlmPrompt).toContain('143.2');
  });

  it('includes response instructions', () => {
    expect(built.finalLlmPrompt).toContain('RESPONSE INSTRUCTIONS');
    expect(built.finalLlmPrompt).toContain(RAG_RESPONSE_INSTRUCTIONS.split('\n')[0]!);
  });

  it('is deterministic', () => {
    const again = buildLlmPrompt({
      userPrompt: "Explain why Gauss's law is useful for spherical symmetry.",
      ragContext: context,
    });
    expect(again.finalLlmPrompt).toBe(built.finalLlmPrompt);
  });

  it('orders elements anchors then spatial', () => {
    const i18 = built.finalLlmPrompt.indexOf('ID: textbox_18');
    const i22 = built.finalLlmPrompt.indexOf('ID: textbox_22');
    expect(i18).toBeGreaterThan(-1);
    expect(i22).toBeGreaterThan(i18);
  });

  it('keeps userPrompt / system / context fields separate', () => {
    expect(built.userPrompt).not.toContain('SYSTEM INSTRUCTIONS');
    expect(built.ragContextSection).toContain('CANVAS CONTEXT');
    expect(built.ragContextSection).not.toContain('USER REQUEST');
  });
});
