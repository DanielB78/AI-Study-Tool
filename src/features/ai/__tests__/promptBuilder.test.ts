import { describe, expect, it } from 'vitest';
import { buildRagContext, type SemanticAnchorInput } from '../../rag/contextBuilder';
import type { SpatialHit } from '../../rag/spatialContext';
import { buildLlmPrompt } from '../llm/promptBuilder';
import {
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
  CANVAS_EDITOR_SYSTEM_PROMPT,
} from '../agent/prompts/loadAgentPrompt';
import { CANVAS_AGENT_OUTPUT_CONTRACT } from '../agent/operations';

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
    query: "Explain why Gauss's law is useful for spherical symmetry.",
    semanticAnchors: [anchorA],
    spatialHits: [hitB],
  });

  const built = buildLlmPrompt({
    userPrompt: "Explain why Gauss's law is useful for spherical symmetry.",
    ragContext: context,
  });

  it('includes Canvas Editor Agent system instructions', () => {
    expect(built.finalLlmPrompt).toContain('SYSTEM INSTRUCTIONS');
    expect(built.finalLlmPrompt).toContain('editing planner for an infinite study canvas');
    expect(built.systemInstructions).toBe(CANVAS_EDITOR_SYSTEM_PROMPT.trim());
  });

  it('includes OUTPUT CONTRACT for structured operations', () => {
    expect(built.finalLlmPrompt).toContain('OUTPUT CONTRACT');
    expect(built.finalLlmPrompt).toContain(CANVAS_AGENT_OUTPUT_CONTRACT.slice(0, 40));
    expect(built.finalLlmPrompt).toContain('create_text');
    expect(built.finalLlmPrompt).toContain('update_text');
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
    expect(built.finalLlmPrompt).toContain('SIMILARITY:');
    expect(built.finalLlmPrompt).toContain('0.8600');
  });

  it('includes spatial provenance', () => {
    expect(built.finalLlmPrompt).toContain('ID: textbox_22');
    expect(built.finalLlmPrompt).toContain('SPATIAL ANCHOR:');
    expect(built.finalLlmPrompt).toContain('DISTANCE:');
    expect(built.finalLlmPrompt).toContain('143.2');
  });

  it('includes response instructions for JSON-only output', () => {
    expect(built.finalLlmPrompt).toContain('RESPONSE INSTRUCTIONS');
    expect(built.finalLlmPrompt).toContain(
      CANVAS_EDITOR_RESPONSE_INSTRUCTIONS.split('\n')[0]!,
    );
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

  it('includes RECENT INTERACTIONS section even when empty', () => {
    expect(built.finalLlmPrompt).toContain('RECENT INTERACTIONS');
    expect(built.recentInteractionsSection).toContain('RECENT INTERACTIONS');
    expect(built.recentInteractionsSection).toContain('(none)');
  });

  it('includes RELEVANT HISTORICAL INTERACTIONS section even when empty', () => {
    expect(built.finalLlmPrompt).toContain('RELEVANT HISTORICAL INTERACTIONS');
    expect(built.historicalInteractionsSection).toContain('(none selected)');
  });

  it('keeps userPrompt / system / context fields separate', () => {
    expect(built.userPrompt).not.toContain('SYSTEM INSTRUCTIONS');
    expect(built.ragContextSection).toContain('CANVAS CONTEXT');
    expect(built.ragContextSection).not.toContain('USER REQUEST');
    // Canvas content must not be folded into trusted system instructions.
    expect(built.systemInstructions).not.toContain('FULL TEXT.');
  });
});
