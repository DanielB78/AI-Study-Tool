import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../../../types/canvas';
import { useCanvasStore } from '../../../../../store/canvasStore';
import { ragSync } from '../../../../rag/ragSync';
import { executeCanvasOperations } from '../../executor';
import { createLiveAgentExecutorTarget } from '../../liveExecutor';
import { parseCanvasAgentResponse } from '../../parser';
import type { RelationshipGridLayoutSpec } from '../../operations';
import {
  normalizeUndirectedRelations,
  optimiseRelationshipGrid,
  topologicalOrder,
} from '../relationshipOptimiser';
import { resolveGridPlan } from '../resolveGridPlan';
import { maxColumnsForObjectCount } from '../gridReflow';
import { CANVAS_AGENT_DOCUMENT_ID, CANVAS_AGENT_MODE } from '../../prompts/loadAgentPrompt';

function resetCanvas() {
  useCanvasStore.setState({
    document: createEmptyDocument(),
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
    activeTool: 'select',
    editingTextId: null,
    editingShapeLabelId: null,
    past: [],
    future: [],
    historySuspended: false,
    marquee: null,
    draftPoints: null,
    draftShape: null,
    clipboard: [],
    snapGuides: [],
  });
}

const basePlacement = { mode: 'viewport_default' as const };

function readingIndex(
  row: number,
  col: number,
  columns: number,
): number {
  return row * columns + col;
}

describe('High-mode document identity', () => {
  it('exposes canvas_agent_high as active High mode', () => {
    expect(CANVAS_AGENT_DOCUMENT_ID).toBe('canvas_agent_high');
    expect(CANVAS_AGENT_MODE).toBe('high');
  });
});

describe('relationship normalisation + prerequisites', () => {
  it('merges symmetric relations with max strength', () => {
    const edges = normalizeUndirectedRelations([
      {
        ref: 'a',
        section: 's',
        relations: [{ ref: 'b', strength: 0.9 }],
      },
      {
        ref: 'b',
        section: 's',
        relations: [{ ref: 'a', strength: 0.85 }],
      },
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ a: 'a', b: 'b', strength: 0.9 });
  });

  it('rejects self-links and >3 relations at parse time', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'create_text', ref: 'a', text: 'A' },
            { type: 'create_text', ref: 'b', text: 'B' },
          ],
          layout: {
            type: 'relationship_grid',
            placement: basePlacement,
            sections: [{ id: 's', order: 0 }],
            items: [
              {
                ref: 'a',
                section: 's',
                relations: [{ ref: 'a', strength: 0.5 }],
              },
              { ref: 'b', section: 's' },
            ],
          },
        }),
        { allowedElementIds: new Set(), elementTypes: new Map() },
      ),
    ).toThrow(/itself/);

    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'create_text', ref: 'a', text: 'A' },
            { type: 'create_text', ref: 'b', text: 'B' },
            { type: 'create_text', ref: 'c', text: 'C' },
            { type: 'create_text', ref: 'd', text: 'D' },
            { type: 'create_text', ref: 'e', text: 'E' },
          ],
          layout: {
            type: 'relationship_grid',
            placement: basePlacement,
            sections: [{ id: 's', order: 0 }],
            items: [
              {
                ref: 'a',
                section: 's',
                relations: [
                  { ref: 'b', strength: 0.5 },
                  { ref: 'c', strength: 0.5 },
                  { ref: 'd', strength: 0.5 },
                  { ref: 'e', strength: 0.5 },
                ],
              },
              { ref: 'b', section: 's' },
              { ref: 'c', section: 's' },
              { ref: 'd', section: 's' },
              { ref: 'e', section: 's' },
            ],
          },
        }),
        { allowedElementIds: new Set(), elementTypes: new Map() },
      ),
    ).toThrow(/at most 3/);
  });

  it('detects prerequisite cycles', () => {
    expect(() =>
      topologicalOrder(['a', 'b', 'c'], new Map([
        ['a', ['c']],
        ['b', ['a']],
        ['c', ['b']],
      ])),
    ).toThrow(/cycle/i);
  });

  it('rejects strength outside 0–1', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'create_text', ref: 'a', text: 'A' },
            { type: 'create_text', ref: 'b', text: 'B' },
          ],
          layout: {
            type: 'relationship_grid',
            placement: basePlacement,
            sections: [{ id: 's', order: 0 }],
            items: [
              {
                ref: 'a',
                section: 's',
                relations: [{ ref: 'b', strength: 1.5 }],
              },
              { ref: 'b', section: 's' },
            ],
          },
        }),
        { allowedElementIds: new Set(), elementTypes: new Map() },
      ),
    ).toThrow(/strength/);
  });
});

describe('prerequisite ordering hard constraint', () => {
  it('keeps A→B→C→D reading order despite competing semantic links', () => {
    const layout: RelationshipGridLayoutSpec = {
      type: 'relationship_grid',
      placement: basePlacement,
      sections: [
        { id: 'fundamentals', order: 0 },
        { id: 'maths', order: 1 },
        { id: 'apps', order: 2 },
      ],
      items: [
        {
          ref: 'a',
          section: 'fundamentals',
          preferred_order: 0,
          relations: [{ ref: 'd', strength: 0.99 }],
        },
        {
          ref: 'b',
          section: 'fundamentals',
          preferred_order: 1,
          requires: ['a'],
        },
        {
          ref: 'c',
          section: 'maths',
          preferred_order: 2,
          requires: ['b'],
          relations: [{ ref: 'a', strength: 0.2 }],
        },
        {
          ref: 'd',
          section: 'apps',
          preferred_order: 3,
          requires: ['c'],
        },
      ],
    };
    const result = optimiseRelationshipGrid(layout);
    const byRef = Object.fromEntries(result.grid.items.map((i) => [i.ref, i]));
    const cols = result.grid.columns;
    const idx = (ref: string) =>
      readingIndex(byRef[ref]!.row, byRef[ref]!.column, cols);
    expect(idx('a')).toBeLessThan(idx('b'));
    expect(idx('b')).toBeLessThan(idx('c'));
    expect(idx('c')).toBeLessThan(idx('d'));
    // Section order preserved: fundamentals before maths before apps
    expect(byRef.a!.row).toBeLessThanOrEqual(byRef.c!.row);
    expect(byRef.c!.row).toBeLessThanOrEqual(byRef.d!.row);
  });
});

describe('topic grouping', () => {
  it('keeps section bands contiguous and ordered', () => {
    const layout: RelationshipGridLayoutSpec = {
      type: 'relationship_grid',
      placement: basePlacement,
      sections: [
        { id: 's0', order: 0, title: 'Fundamentals' },
        { id: 's1', order: 1, title: 'Derivation' },
        { id: 's2', order: 2, title: 'Applications' },
      ],
      items: [
        { ref: 'a', section: 's0', preferred_order: 0 },
        { ref: 'b', section: 's0', preferred_order: 1, relations: [{ ref: 'a', strength: 0.9 }] },
        { ref: 'c', section: 's1', preferred_order: 0, requires: ['b'] },
        { ref: 'd', section: 's1', preferred_order: 1, relations: [{ ref: 'c', strength: 0.95 }] },
        { ref: 'e', section: 's2', preferred_order: 0, requires: ['c'] },
        { ref: 'f', section: 's2', preferred_order: 1 },
      ],
    };
    const result = optimiseRelationshipGrid(layout);
    const byRef = Object.fromEntries(result.grid.items.map((i) => [i.ref, i]));
    const maxS0 = Math.max(byRef.a!.row, byRef.b!.row);
    const minS1 = Math.min(byRef.c!.row, byRef.d!.row);
    const maxS1 = Math.max(byRef.c!.row, byRef.d!.row);
    const minS2 = Math.min(byRef.e!.row, byRef.f!.row);
    expect(maxS0).toBeLessThan(minS1);
    expect(maxS1).toBeLessThan(minS2);
  });
});

describe('optimisation effectiveness', () => {
  it('does not increase total cost vs initial pack', () => {
    const layout: RelationshipGridLayoutSpec = {
      type: 'relationship_grid',
      placement: basePlacement,
      sections: [{ id: 's', order: 0 }],
      items: [
        { ref: 'a', section: 's', preferred_order: 0, relations: [{ ref: 'b', strength: 0.95 }] },
        { ref: 'b', section: 's', preferred_order: 1, relations: [{ ref: 'a', strength: 0.95 }] },
        { ref: 'c', section: 's', preferred_order: 2, relations: [{ ref: 'd', strength: 0.9 }] },
        { ref: 'd', section: 's', preferred_order: 3, relations: [{ ref: 'c', strength: 0.9 }] },
        { ref: 'e', section: 's', preferred_order: 4 },
      ],
    };
    const result = optimiseRelationshipGrid(layout);
    expect(result.finalCost).toBeLessThanOrEqual(result.initialCost + 1e-9);
    expect(result.grid.columns).toBeLessThanOrEqual(maxColumnsForObjectCount(5));
  });
});

describe('grid integration via relationship_grid', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([1, 3, 5, 7, 10] as const)(
    'respects dynamic max columns for N=%i',
    (n) => {
      const refs = Array.from({ length: n }, (_, i) => `t${i}`);
      const plan = {
        operations: refs.map((ref) => ({
          type: 'create_text' as const,
          ref,
          text: `Note ${ref}`,
          placement: basePlacement,
        })),
        layout: {
          type: 'relationship_grid' as const,
          placement: basePlacement,
          sections: [{ id: 'main', order: 0 }],
          items: refs.map((ref, i) => ({
            ref,
            section: 'main',
            preferred_order: i,
          })),
        },
      };
      const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
      expect(result.layoutDebug?.columns).toBeLessThanOrEqual(
        maxColumnsForObjectCount(n),
      );
      expect(result.layoutDebug?.collisionFree).toBe(true);
      expect(result.createdIds).toHaveLength(n);
    },
  );

  it('end-to-end relationship_grid plan is atomic and undoable', () => {
    const json = {
      operations: [
        { type: 'create_text', ref: 'intro', text: 'Introduction to the oscillator.' },
        {
          type: 'create_equation',
          ref: 'eq',
          latex: 'H=\\frac{p^2}{2m}+\\frac{1}{2}m\\omega^2 x^2',
        },
        {
          type: 'create_text',
          ref: 'levels',
          text: 'Energy levels are quantised: E_n = ħω(n+1/2).',
        },
        {
          type: 'create_graph',
          ref: 'graph',
          expressions: [
            {
              expression: '0.5*x**2',
              visible: true,
              domain_min: null,
              domain_max: null,
            },
          ],
          points: [],
          viewport: { x_min: -5, x_max: 5, y_min: -1, y_max: 10 },
          settings: {
            title: 'Potential',
            x_axis_label: 'x',
            y_axis_label: 'V',
            show_grid: true,
            show_x_axis: true,
            show_y_axis: true,
          },
        },
        {
          type: 'create_text',
          ref: 'example',
          text: 'Worked example: ground-state energy scale.',
        },
      ],
      layout: {
        type: 'relationship_grid',
        placement: basePlacement,
        sections: [
          { id: 'fundamentals', order: 0, title: 'Fundamentals' },
          { id: 'maths', order: 1, title: 'Mathematics' },
          { id: 'apps', order: 2, title: 'Applications' },
        ],
        items: [
          {
            ref: 'intro',
            section: 'fundamentals',
            preferred_order: 0,
            relations: [{ ref: 'eq', strength: 0.9 }],
          },
          {
            ref: 'eq',
            section: 'fundamentals',
            preferred_order: 1,
            requires: ['intro'],
            relations: [
              { ref: 'levels', strength: 0.95 },
              { ref: 'graph', strength: 0.85 },
            ],
          },
          {
            ref: 'levels',
            section: 'maths',
            preferred_order: 2,
            requires: ['eq'],
            relations: [{ ref: 'graph', strength: 0.9 }],
          },
          {
            ref: 'graph',
            section: 'maths',
            preferred_order: 3,
            requires: ['eq'],
            relations: [{ ref: 'example', strength: 0.7 }],
          },
          {
            ref: 'example',
            section: 'apps',
            preferred_order: 4,
            requires: ['levels'],
            relations: [{ ref: 'eq', strength: 0.8 }],
          },
        ],
      },
    };

    const parsed = parseCanvasAgentResponse(JSON.stringify(json), {
      allowedElementIds: new Set(),
      elementTypes: new Map(),
    });
    expect(parsed.layout?.type).toBe('relationship_grid');

    const result = executeCanvasOperations(parsed, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.relationshipOptimiser).toBeTruthy();
    expect(result.layoutDebug?.collisionFree).toBe(true);
    expect(result.layoutDebug?.columns).toBeLessThanOrEqual(3);
    expect(result.createdIds.length).toBeGreaterThanOrEqual(5);

    const meta = result.layoutDebug!.relationshipOptimiser!;
    expect(meta.finalCost).toBeLessThanOrEqual(meta.initialCost + 1e-9);
    expect(meta.edges.length).toBeGreaterThan(0);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });

  it('resolveGridPlan attaches relationship debug and valid geometry', () => {
    const layout: RelationshipGridLayoutSpec = {
      type: 'relationship_grid',
      placement: basePlacement,
      sections: [{ id: 's', order: 0 }],
      items: [
        { ref: 'a', section: 's', preferred_order: 0, relations: [{ ref: 'b', strength: 0.9 }] },
        { ref: 'b', section: 's', preferred_order: 1, requires: ['a'] },
        { ref: 'c', section: 's', preferred_order: 2 },
      ],
    };
    const resolved = resolveGridPlan({
      layout,
      operations: [
        { type: 'create_text', ref: 'a', text: 'A', placement: basePlacement },
        { type: 'create_text', ref: 'b', text: 'B', placement: basePlacement },
        { type: 'create_text', ref: 'c', text: 'C', placement: basePlacement },
      ],
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
    });
    expect(resolved.debug.relationshipOptimiser?.itemMeta).toHaveLength(3);
    expect(resolved.byRef.size).toBe(3);
    expect(resolved.debug.collisionFree).toBe(true);
  });
});
