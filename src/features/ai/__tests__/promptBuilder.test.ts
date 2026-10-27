import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRagContext, type SemanticAnchorInput } from '../../rag/contextBuilder';
import type { SpatialHit } from '../../rag/spatialContext';
import { createConceptSummaryStructure } from '../../structures/factory';
import { buildLlmPrompt } from '../llm/promptBuilder';
import {
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
  CANVAS_EDITOR_SYSTEM_PROMPT,
} from '../agent/prompts/loadAgentPrompt';
import { CANVAS_AGENT_OUTPUT_CONTRACT } from '../agent/operations';
import {
  CONTENT_FIRST_SYSTEM_PROMPT,
  setAiGenerationModeOverride,
} from '../contentFirst';

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

const context = buildRagContext({
  query: "Explain why Gauss's law is useful for spherical symmetry.",
  semanticAnchors: [anchorA],
  spatialHits: [hitB],
});

describe('buildLlmPrompt (operations mode)', () => {
  beforeEach(() => setAiGenerationModeOverride('operations'));
  afterEach(() => setAiGenerationModeOverride(null));

  const built = () =>
    buildLlmPrompt({
      userPrompt: "Explain why Gauss's law is useful for spherical symmetry.",
      ragContext: context,
    });

  it('includes Canvas Editor Agent system instructions', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('SYSTEM INSTRUCTIONS');
    expect(b.finalLlmPrompt).toContain('editing planner for an infinite study canvas');
    expect(b.systemInstructions).toBe(CANVAS_EDITOR_SYSTEM_PROMPT.trim());
  });

  it('documents GraphMathSyntax and forbids LaTeX for graph expressions', () => {
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('GRAPH EXPRESSION FORMAT');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('GRAPH EXPRESSIONS ARE NOT LATEX');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('x**2');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('Explicit `*` required');
  });

  it('includes create_graph in available actions and output contract', () => {
    const b = built();
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('create_graph');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('GRAPH CREATION');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('GRAPH EDITING');
    expect(CANVAS_EDITOR_SYSTEM_PROMPT).toContain('add_graph_expression');
    expect(b.finalLlmPrompt).toContain('create_graph');
    expect(CANVAS_AGENT_OUTPUT_CONTRACT).toContain('create_graph');
    expect(CANVAS_AGENT_OUTPUT_CONTRACT).toContain('add_graph_expression');
    expect(CANVAS_AGENT_OUTPUT_CONTRACT).toContain('x**2');
  });

  it('includes OUTPUT CONTRACT for structured operations', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('OUTPUT CONTRACT');
    expect(b.finalLlmPrompt).toContain(CANVAS_AGENT_OUTPUT_CONTRACT.slice(0, 40));
    expect(b.finalLlmPrompt).toContain('create_text');
    expect(b.finalLlmPrompt).toContain('update_text');
  });

  it('includes canvas context with full textbox text (not only chunk)', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('CANVAS CONTEXT');
    expect(b.finalLlmPrompt).toContain('FULL TEXT.');
    expect(b.finalLlmPrompt).not.toContain('chunk only');
  });

  it('includes original user prompt separately', () => {
    const b = built();
    expect(b.userPrompt).toBe(
      "Explain why Gauss's law is useful for spherical symmetry.",
    );
    expect(b.finalLlmPrompt).toContain('USER REQUEST');
    expect(b.finalLlmPrompt).toContain(b.userPrompt);
  });

  it('includes semantic provenance', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('ID: textbox_18');
    expect(b.finalLlmPrompt).toContain('SIMILARITY:');
    expect(b.finalLlmPrompt).toContain('0.8600');
  });

  it('includes spatial provenance', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('ID: textbox_22');
    expect(b.finalLlmPrompt).toContain('SPATIAL ANCHOR:');
    expect(b.finalLlmPrompt).toContain('DISTANCE:');
    expect(b.finalLlmPrompt).toContain('143.2');
  });

  it('includes response instructions for JSON-only output', () => {
    const b = built();
    expect(b.finalLlmPrompt).toContain('RESPONSE INSTRUCTIONS');
    expect(b.finalLlmPrompt).toContain(
      CANVAS_EDITOR_RESPONSE_INSTRUCTIONS.split('\n')[0]!,
    );
  });

  it('is deterministic', () => {
    const again = buildLlmPrompt({
      userPrompt: "Explain why Gauss's law is useful for spherical symmetry.",
      ragContext: context,
    });
    expect(again.finalLlmPrompt).toBe(built().finalLlmPrompt);
  });

  it('orders elements anchors then spatial', () => {
    const b = built();
    const i18 = b.finalLlmPrompt.indexOf('ID: textbox_18');
    const i22 = b.finalLlmPrompt.indexOf('ID: textbox_22');
    expect(i18).toBeGreaterThan(-1);
    expect(i22).toBeGreaterThan(i18);
  });

  it('keeps userPrompt / system / context fields separate', () => {
    const b = built();
    expect(b.userPrompt).not.toContain('SYSTEM INSTRUCTIONS');
    expect(b.ragContextSection).toContain('CANVAS CONTEXT');
    expect(b.ragContextSection).not.toContain('USER REQUEST');
    expect(b.systemInstructions).not.toContain('FULL TEXT.');
  });

  it('includes No Structure section by default (separate from canvas context)', () => {
    const b = built();
    expect(b.noteStructureSection).toContain('No Structure');
    expect(b.finalLlmPrompt).toContain('SELECTED NOTE STRUCTURE');
    expect(b.finalLlmPrompt).toContain('Do not emit create_structured_note');
    expect(b.ragContextSection).not.toContain('SELECTED NOTE STRUCTURE');
  });

  it('includes selected structure schema separately from RAG', () => {
    const structure = createConceptSummaryStructure();
    const withStructure = buildLlmPrompt({
      userPrompt: "Explain Gauss's law",
      ragContext: context,
      selectedStructure: structure,
    });
    expect(withStructure.noteStructureSection).toContain(structure.id);
    expect(withStructure.noteStructureSection).toContain('Concept Summary');
    expect(withStructure.noteStructureSection).toContain('FIELD ID: equation');
    expect(withStructure.finalLlmPrompt).toContain('create_structured_note');
    expect(withStructure.ragContextSection).not.toContain(structure.id);
  });
});

describe('buildLlmPrompt (content-first default)', () => {
  beforeEach(() => setAiGenerationModeOverride('content_first'));
  afterEach(() => setAiGenerationModeOverride(null));

  it('uses the Markdown content-author system prompt, not JSON ops', () => {
    const built = buildLlmPrompt({
      userPrompt: 'Explain simple harmonic motion.',
      ragContext: context,
    });
    expect(built.systemInstructions).toBe(CONTENT_FIRST_SYSTEM_PROMPT.trim());
    expect(built.finalLlmPrompt).toContain('Canvas Content Author');
    expect(built.finalLlmPrompt).toContain('Markdown educational content only');
    expect(built.finalLlmPrompt).toContain(':::graph');
    expect(built.finalLlmPrompt).not.toContain('editing planner for an infinite study canvas');
    expect(built.finalLlmPrompt).not.toContain(CANVAS_AGENT_OUTPUT_CONTRACT.slice(0, 40));
  });
});
