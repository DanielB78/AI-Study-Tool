import { describe, expect, it } from 'vitest';
import {
  allExpansionChildIds,
  buildSemanticTrees,
  semanticHitsForContext,
  topExpansionChildIds,
  type SemanticExpandResponse,
} from '../semanticExpansion';
import { buildRagContext, type SemanticAnchorInput } from '../contextBuilder';
import type { SpatialHit } from '../spatialContext';

function makeResponse(
  overrides: Partial<SemanticExpandResponse> &
    Pick<SemanticExpandResponse, 'edges' | 'root_anchor_ids'>,
): SemanticExpandResponse {
  const ids = new Set<string>([
    ...overrides.root_anchor_ids,
    ...overrides.edges.flatMap((e) => [
      e.parent_element_id,
      e.child_element_id,
      e.root_anchor_element_id,
    ]),
  ]);
  return {
    board_id: 'b1',
    depth: 2,
    max_neighbours: 5,
    embedding_model: 'test',
    supported_element_types: ['text', 'equation'],
    unique_element_ids: Array.from(
      new Set(overrides.edges.map((e) => e.child_element_id)),
    ),
    elements: Array.from(ids).map((id) => ({
      element_id: id,
      element_type: 'text',
      preview: `preview-${id}`,
      geometry: { x: 0, y: 0, width: 10, height: 10 },
    })),
    ...overrides,
  };
}

describe('buildSemanticTrees', () => {
  it('depth 1: A → B, C (max neighbours semantics reflected in edges)', () => {
    const response = makeResponse({
      root_anchor_ids: ['A'],
      depth: 1,
      edges: [
        {
          parent_element_id: 'A',
          child_element_id: 'B',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.9,
        },
        {
          parent_element_id: 'A',
          child_element_id: 'C',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.8,
        },
      ],
    });
    const trees = buildSemanticTrees(response);
    expect(trees).toHaveLength(1);
    expect(trees[0]!.element_id).toBe('A');
    expect(trees[0]!.children.map((c) => c.element_id)).toEqual(['B', 'C']);
    expect(trees[0]!.children[0]!.similarity).toBe(0.9);
    expect(trees[0]!.children[1]!.gap_from_previous).toBeCloseTo(0.1);
  });

  it('depth 2 tree shape A→B→D/E and A→C', () => {
    const response = makeResponse({
      root_anchor_ids: ['A'],
      edges: [
        {
          parent_element_id: 'A',
          child_element_id: 'B',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.9,
        },
        {
          parent_element_id: 'A',
          child_element_id: 'C',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.8,
        },
        {
          parent_element_id: 'B',
          child_element_id: 'D',
          root_anchor_element_id: 'A',
          depth: 2,
          similarity: 0.85,
        },
        {
          parent_element_id: 'B',
          child_element_id: 'E',
          root_anchor_element_id: 'A',
          depth: 2,
          similarity: 0.82,
        },
      ],
    });
    const tree = buildSemanticTrees(response)[0]!;
    const b = tree.children.find((c) => c.element_id === 'B')!;
    expect(b.children.map((c) => c.element_id)).toEqual(['D', 'E']);
    expect(tree.children.find((c) => c.element_id === 'C')!.children).toEqual([]);
  });

  it('multiple roots may both show C', () => {
    const response = makeResponse({
      root_anchor_ids: ['A', 'B'],
      edges: [
        {
          parent_element_id: 'A',
          child_element_id: 'C',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.77,
        },
        {
          parent_element_id: 'B',
          child_element_id: 'C',
          root_anchor_element_id: 'B',
          depth: 1,
          similarity: 0.74,
        },
      ],
    });
    const trees = buildSemanticTrees(response);
    expect(trees[0]!.children[0]!.element_id).toBe('C');
    expect(trees[1]!.children[0]!.element_id).toBe('C');
  });
});

describe('semanticHitsForContext', () => {
  const response = makeResponse({
    root_anchor_ids: ['A'],
    edges: [
      {
        parent_element_id: 'A',
        child_element_id: 'B',
        root_anchor_element_id: 'A',
        depth: 1,
        similarity: 0.9,
      },
      {
        parent_element_id: 'B',
        child_element_id: 'C',
        root_anchor_element_id: 'A',
        depth: 2,
        similarity: 0.85,
      },
    ],
  });

  it('includes depth-2 only when parent is included', () => {
    const withB = semanticHitsForContext(
      response,
      new Set(['B', 'C']),
      () => null,
    );
    expect(withB.map((h) => h.element_id).sort()).toEqual(['B', 'C']);

    const withoutB = semanticHitsForContext(
      response,
      new Set(['C']), // B unchecked — C not reachable through B
      () => null,
    );
    expect(withoutB).toEqual([]);
  });

  it('uses live canvas text when resolver provides it', () => {
    const hits = semanticHitsForContext(response, new Set(['B']), (id) =>
      id === 'B'
        ? {
            text: 'LIVE B TEXT',
            type: 'text',
            geometry: { x: 1, y: 2, width: 3, height: 4 },
          }
        : null,
    );
    expect(hits[0]!.text).toBe('LIVE B TEXT');
  });
});

describe('context merge toggles + dedupe', () => {
  const anchorA: SemanticAnchorInput = {
    element_id: 'A',
    element_type: 'text',
    similarity: 0.95,
    matched_chunks: [
      { chunk_id: 'c0', chunk_index: 0, text: 'chunk', similarity: 0.95 },
    ],
    geometry: { x: 0, y: 0, width: 10, height: 10 },
    text: 'Anchor A full',
  };

  const spatialC: SpatialHit = {
    element_id: 'C',
    element_type: 'text',
    anchor_element_id: 'A',
    distance: 50,
    geometry: { x: 20, y: 0, width: 10, height: 10 },
    text: 'Spatial C',
  };

  it('semantic only when spatial hits empty', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [],
      semanticNeighborHits: [
        {
          element_id: 'B',
          element_type: 'text',
          text: 'Neighbor B',
          geometry: { x: 0, y: 20, width: 10, height: 10 },
          parent_element_id: 'A',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.84,
        },
      ],
    });
    expect(ctx.stats.spatial_addition_count).toBe(0);
    expect(ctx.stats.unique_semantic_addition_count).toBe(1);
    expect(ctx.semanticNeighborElements.map((e) => e.element_id)).toEqual(['B']);
  });

  it('spatial only when semantic neighbor hits empty', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [spatialC],
      semanticNeighborHits: [],
    });
    expect(ctx.stats.spatial_addition_count).toBe(1);
    expect(ctx.stats.unique_semantic_addition_count).toBe(0);
  });

  it('dedupes element that is both spatial and semantic neighbor', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [spatialC],
      semanticNeighborHits: [
        {
          element_id: 'C',
          element_type: 'text',
          text: 'Semantic C live',
          geometry: spatialC.geometry,
          parent_element_id: 'A',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.77,
        },
      ],
    });
    expect(ctx.stats.total_unique_elements).toBe(2); // A + C once
    const c = ctx.allElements.find((e) => e.element_id === 'C')!;
    expect(c.sources.some((s) => s.type === 'spatial')).toBe(true);
    expect(c.sources.some((s) => s.type === 'semantic_neighbor')).toBe(true);
    expect(c.inclusion).toBe('both');
  });

  it('preserves dual provenance for multi-root neighbor', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorA],
      spatialHits: [],
      semanticNeighborHits: [
        {
          element_id: 'C',
          element_type: 'text',
          text: 'C',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          parent_element_id: 'A',
          root_anchor_element_id: 'A',
          depth: 1,
          similarity: 0.77,
        },
        {
          element_id: 'C',
          element_type: 'text',
          text: 'C',
          geometry: { x: 0, y: 0, width: 1, height: 1 },
          parent_element_id: 'B',
          root_anchor_element_id: 'B',
          depth: 1,
          similarity: 0.74,
        },
      ],
    });
    expect(ctx.semanticNeighborElements).toHaveLength(1);
    const sources = ctx.semanticNeighborElements[0]!.sources.filter(
      (s) => s.type === 'semantic_neighbor',
    );
    expect(sources).toHaveLength(2);
  });
});

describe('convenience selectors', () => {
  const response = makeResponse({
    root_anchor_ids: ['A'],
    edges: [
      {
        parent_element_id: 'A',
        child_element_id: 'B',
        root_anchor_element_id: 'A',
        depth: 1,
        similarity: 0.9,
      },
      {
        parent_element_id: 'A',
        child_element_id: 'C',
        root_anchor_element_id: 'A',
        depth: 1,
        similarity: 0.5,
      },
      {
        parent_element_id: 'A',
        child_element_id: 'D',
        root_anchor_element_id: 'A',
        depth: 1,
        similarity: 0.7,
      },
    ],
  });

  it('allExpansionChildIds unique', () => {
    expect(allExpansionChildIds(response).sort()).toEqual(['B', 'C', 'D']);
  });

  it('topExpansionChildIds by best similarity', () => {
    expect(topExpansionChildIds(response, 2)).toEqual(['B', 'D']);
  });
});
