import { describe, expect, it } from 'vitest';
import {
  extractElementContextContent,
  resolveExplicitSelection,
  snapshotEditorSelection,
} from '../explicitSelection';
import { buildRagContext, type SemanticAnchorInput } from '../contextBuilder';
import type { SpatialHit } from '../spatialContext';
import type { CanvasElement, TextElement } from '../../../types/canvas';

function makeText(
  id: string,
  text: string,
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id,
    type: 'text',
    text,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 0,
    opacity: 1,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    metadata: {},
    fontSize: 16,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left',
    lineHeight: 1.3,
    backgroundColor: null,
    padding: 8,
    cornerRadius: 0,
    ...overrides,
  };
}

describe('explicitSelection helpers', () => {
  it('snapshots editor selection as a copy', () => {
    const live = ['a', 'b'];
    const snap = snapshotEditorSelection(live);
    live.push('c');
    expect(snap).toEqual(['a', 'b']);
  });

  it('resolves text elements from CanvasDocument', () => {
    const elements: CanvasElement[] = [
      makeText('tb1', 'Gauss law'),
      makeText('tb2', 'Other'),
    ];
    const resolved = resolveExplicitSelection(['tb1', 'missing'], elements);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.element_id).toBe('tb1');
    expect(resolved[0]!.text).toBe('Gauss law');
    expect(resolved[0]!.has_readable_content).toBe(true);
  });

  it('does not invent content for drawings', () => {
    const drawing = {
      id: 'd1',
      type: 'drawing' as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      rotation: 0,
      zIndex: 0,
      opacity: 1,
      locked: false,
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      points: [0, 0, 1, 1],
      color: '#000',
      strokeWidth: 2,
      strokeStyle: 'solid' as const,
    };
    const content = extractElementContextContent(drawing);
    expect(content.text).toBe('');
    expect(content.has_readable_content).toBe(false);
  });
});

describe('buildRagContext explicit selection', () => {
  const anchorA: SemanticAnchorInput = {
    element_id: 'A',
    element_type: 'text',
    similarity: 0.9,
    matched_chunks: [
      { chunk_id: 'c0', chunk_index: 0, text: 'chunk A', similarity: 0.9 },
    ],
    geometry: { x: 0, y: 0, width: 100, height: 40 },
    text: 'Anchor A full',
  };

  it('includes selected element even when not in semantic results', () => {
    const ctx = buildRagContext({
      query: 'Make this shorter.',
      explicitSelections: [
        {
          element_id: 'SEL',
          element_type: 'text',
          text: 'Selected unrelated note',
          geometry: { x: 10, y: 10, width: 80, height: 30 },
          has_readable_content: true,
        },
      ],
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(ctx.stats.explicit_selection_count).toBe(1);
    expect(ctx.allElements.map((e) => e.element_id)).toEqual(['SEL']);
    expect(ctx.explicitlySelectedElements[0]!.sources[0]!.type).toBe(
      'explicit_selection',
    );
  });

  it('supports multi-selection', () => {
    const ctx = buildRagContext({
      query: 'Check these',
      explicitSelections: [
        {
          element_id: 't1',
          element_type: 'text',
          text: 'one',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          has_readable_content: true,
        },
        {
          element_id: 't2',
          element_type: 'text',
          text: 'two',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          has_readable_content: true,
        },
        {
          element_id: 't3',
          element_type: 'text',
          text: 'three',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          has_readable_content: true,
        },
      ],
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(ctx.explicitlySelectedElements.map((e) => e.element_id)).toEqual([
      't1',
      't2',
      't3',
    ]);
  });

  it('dedupes selected element that is also a semantic anchor', () => {
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [
        {
          element_id: 'A',
          element_type: 'text',
          text: 'Anchor A full',
          geometry: anchorA.geometry,
          has_readable_content: true,
        },
      ],
      semanticAnchors: [anchorA],
      spatialHits: [],
    });
    expect(ctx.stats.total_unique_elements).toBe(1);
    const a = ctx.allElements[0]!;
    expect(a.sources.some((s) => s.type === 'explicit_selection')).toBe(true);
    expect(a.sources.some((s) => s.type === 'semantic')).toBe(true);
    expect(a.inclusion).toBe('both');
  });

  it('keeps explicit selection when budget trims spatial additions', () => {
    const spatialHits: SpatialHit[] = Array.from({ length: 8 }, (_, i) => ({
      element_id: `S${i}`,
      element_type: 'text',
      anchor_element_id: 'A',
      distance: i + 1,
      geometry: { x: i * 10, y: 0, width: 10, height: 10 },
      text: `spatial ${i} `.repeat(20),
    }));
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [
        {
          element_id: 'SEL',
          element_type: 'text',
          text: 'Must keep selected',
          geometry: { x: 0, y: 0, width: 10, height: 10 },
          has_readable_content: true,
        },
      ],
      semanticAnchors: [anchorA],
      spatialHits,
      maxElements: 3,
      maxCharacters: 50_000,
    });
    expect(ctx.allElements.some((e) => e.element_id === 'SEL')).toBe(true);
    expect(ctx.allElements.some((e) => e.element_id === 'A')).toBe(true);
    expect(ctx.stats.total_unique_elements).toBeLessThanOrEqual(3);
    expect(ctx.stats.truncated_by_element_budget).toBe(true);
  });

  it('no selection leaves ordinary RAG behaviour', () => {
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [],
      semanticAnchors: [anchorA],
      spatialHits: [],
    });
    expect(ctx.stats.explicit_selection_count).toBe(0);
    expect(ctx.allElements.map((e) => e.element_id)).toEqual(['A']);
  });

  it('serialized context puts explicit selection first', () => {
    const ctx = buildRagContext({
      query: 'Explain this',
      explicitSelections: [
        {
          element_id: 'SEL',
          element_type: 'text',
          text: 'Selected body',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          has_readable_content: true,
        },
      ],
      semanticAnchors: [anchorA],
      spatialHits: [],
    });
    expect(ctx.serialized).toContain('EXPLICITLY SELECTED CANVAS ELEMENTS');
    expect(ctx.serialized).toContain('RETRIEVED SUPPORTING CONTEXT');
    const explicitIdx = ctx.serialized.indexOf('EXPLICITLY SELECTED');
    const supportIdx = ctx.serialized.indexOf('RETRIEVED SUPPORTING');
    expect(explicitIdx).toBeLessThan(supportIdx);
  });
});
