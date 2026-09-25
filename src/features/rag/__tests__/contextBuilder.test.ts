import { describe, expect, it } from 'vitest';
import { buildRagContext, serializeRagContext, type SemanticAnchorInput } from '../contextBuilder';
import type { SpatialHit } from '../spatialContext';

const anchorA: SemanticAnchorInput = {
  element_id: 'A',
  element_type: 'text',
  similarity: 0.9,
  matched_chunks: [
    { chunk_id: 'c0', chunk_index: 0, text: 'Gauss chunk', similarity: 0.9 },
  ],
  geometry: { x: 0, y: 0, width: 100, height: 40 },
  text: 'Gauss full text about flux and charge.',
};

const hitB: SpatialHit = {
  element_id: 'B',
  element_type: 'text',
  anchor_element_id: 'A',
  distance: 40,
  geometry: { x: 120, y: 0, width: 100, height: 40 },
  text: 'Spherical symmetry note.',
};

const hitC: SpatialHit = {
  element_id: 'C',
  element_type: 'text',
  anchor_element_id: 'A',
  distance: 110,
  geometry: { x: 0, y: 80, width: 100, height: 40 },
  text: 'Electric flux measures field through a surface.',
};

const hitFar: SpatialHit = {
  element_id: 'D',
  element_type: 'text',
  anchor_element_id: 'A',
  distance: 300,
  geometry: { x: 800, y: 800, width: 100, height: 40 },
  text: 'Faraday induction.',
};

describe('buildRagContext', () => {
  it('always keeps semantic anchors and adds spatial nearest-first', () => {
    const ctx = buildRagContext({
      query: 'spherical symmetry',
      semanticAnchors: [anchorA],
      spatialHits: [hitFar, hitC, hitB],
      maxElements: 10,
      maxCharacters: 50_000,
    });
    expect(ctx.stats.semantic_anchor_count).toBe(1);
    expect(ctx.spatialElements.map((e) => e.element_id)).toEqual(['B', 'C', 'D']);
    expect(ctx.allElements[0]?.element_id).toBe('A');
    expect(ctx.allElements[0]?.similarity).toBe(0.9);
    expect(ctx.allElements[0]?.text).toContain('Gauss full text');
  });

  it('dedupes spatial hit that is also an anchor and keeps both provenances', () => {
    const spatialSelf: SpatialHit = {
      element_id: 'A',
      element_type: 'text',
      anchor_element_id: 'other',
      distance: 0,
      geometry: anchorA.geometry,
      text: anchorA.text,
    };
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [spatialSelf, hitB],
      maxElements: 10,
      maxCharacters: 50_000,
    });
    expect(ctx.stats.total_unique_elements).toBe(2);
    const a = ctx.semanticAnchors[0]!;
    expect(a.inclusion).toBe('both');
    expect(a.sources.some((s) => s.type === 'spatial')).toBe(true);
    expect(a.sources.some((s) => s.type === 'semantic')).toBe(true);
  });

  it('merges duplicate spatial hits across anchors keeping nearest', () => {
    const viaOther: SpatialHit = {
      ...hitB,
      anchor_element_id: 'Z',
      distance: 260,
    };
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [hitB, viaOther],
      maxElements: 10,
      maxCharacters: 50_000,
    });
    const b = ctx.spatialElements.find((e) => e.element_id === 'B')!;
    expect(b.nearest_distance).toBe(40);
    expect(b.sources).toHaveLength(2);
  });

  it('respects MAX_CONTEXT_ELEMENTS while retaining anchors', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [hitB, hitC, hitFar],
      maxElements: 2,
      maxCharacters: 50_000,
    });
    expect(ctx.semanticAnchors).toHaveLength(1);
    expect(ctx.spatialElements).toHaveLength(1);
    expect(ctx.spatialElements[0]?.element_id).toBe('B');
    expect(ctx.stats.truncated_by_element_budget).toBe(true);
  });

  it('respects MAX_CONTEXT_CHARACTERS nearest-first', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [hitB, hitC],
      maxElements: 10,
      // anchor text length + only room for B, not C
      maxCharacters: anchorA.text.length + hitB.text.length,
    });
    expect(ctx.spatialElements.map((e) => e.element_id)).toEqual(['B']);
    expect(ctx.stats.truncated_by_character_budget).toBe(true);
  });

  it('radius-equivalent empty spatial → anchors only', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [],
    });
    expect(ctx.stats.spatial_addition_count).toBe(0);
    expect(ctx.allElements).toHaveLength(1);
  });

  it('serializes deterministically with provenance', () => {
    const ctx = buildRagContext({
      query: 'Explain Gauss',
      semanticAnchors: [anchorA],
      spatialHits: [hitB],
    });
    const s = serializeRagContext(ctx.query, ctx.allElements);
    expect(s).toContain('CANVAS CONTEXT');
    expect(s).toContain('ID: A');
    expect(s).toContain('SOURCE: semantic');
    expect(s).toContain('SIMILARITY: 0.9000');
    expect(s).toContain('ID: B');
    expect(s).toContain('SOURCE: spatial');
    expect(s).toContain('NEAR: A');
    expect(s).toContain('Gauss full text');
    expect(s).toBe(ctx.serialized);
  });
});
