import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '../../../types/canvas';
import {
  createEmptyGraphExpression,
  createGraphElement,
} from '../../graphs/createGraphElement';
import { createBaseFields } from '../../../utils/ids';
import { buildRagContext } from '../contextBuilder';
import { resolveExplicitSelection } from '../explicitSelection';
import {
  canvasElementsAsSpatial,
  findElementsWithinRadius,
  isSpatiallyEligible,
  toSpatialElementRecord,
} from '../spatialContext';
import { formatGraphElementForContext, toGraphContextItem } from '../graphContext';

function makeText(id: string, x: number, y: number, text: string) {
  return {
    ...createBaseFields({ x, y, width: 120, height: 40, zIndex: 1 }),
    id,
    type: 'text' as const,
    text,
    fontSize: 16,
    fontFamily: 'sans',
    fontWeight: 'normal' as const,
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left' as const,
    lineHeight: 1.2,
    backgroundColor: '#fff',
    padding: 8,
    cornerRadius: 4,
  };
}

describe('graph RAG context — no embeddings, selection/spatial only', () => {
  it('marks graphs spatially eligible without embedding content', () => {
    const g = createGraphElement({ x: 0, y: 0, zIndex: 1 });
    expect(isSpatiallyEligible({ ...g, type: 'graph' })).toBe(true);
    const rec = toSpatialElementRecord('board', {
      ...g,
      expressions: [createEmptyGraphExpression(0, 'x**2')],
    });
    expect(rec?.element_type).toBe('graph');
    expect(rec).not.toHaveProperty('embedding');
  });

  it('explicit selection includes structured graph state', () => {
    const g = {
      ...createGraphElement({ x: 10, y: 20, zIndex: 1 }),
      id: 'graph_12',
      expressions: [{ ...createEmptyGraphExpression(0, 'x**2'), id: 'expr_1' }],
    };
    const sels = resolveExplicitSelection([g.id], [g]);
    expect(sels).toHaveLength(1);
    expect(sels[0]?.element_type).toBe('graph');
    expect(sels[0]?.has_readable_content).toBe(true);
    expect(sels[0]?.text).toContain('GRAPH ELEMENT');
    expect(sels[0]?.text).toContain('expr_1');
    expect(sels[0]?.text).toContain('x**2');
    expect(sels[0]?.text).not.toMatch(/base64|screenshot|sampled/i);
  });

  it('spatial expansion includes nearby graphs and excludes far ones', () => {
    const text = makeText('textbox_1', 0, 0, 'Quadratic functions');
    const near = {
      ...createGraphElement({ x: 80, y: 0, zIndex: 2 }),
      id: 'graph_1',
      expressions: [{ ...createEmptyGraphExpression(0, 'x**2'), id: 'expr_1' }],
    };
    const far = {
      ...createGraphElement({ x: 2000, y: 0, zIndex: 3 }),
      id: 'graph_2',
      expressions: [{ ...createEmptyGraphExpression(0, 'x**3'), id: 'expr_2' }],
    };
    const spatial = canvasElementsAsSpatial([text, near, far]);
    const hits = findElementsWithinRadius(
      spatial.find((e) => e.id === 'textbox_1')!,
      spatial,
      200,
    );
    const ids = hits.map((h) => h.element_id);
    expect(ids).toContain('graph_1');
    expect(ids).not.toContain('graph_2');
  });

  it('buildRagContext serializes graph without screenshots/samples', () => {
    const g = {
      ...createGraphElement({ x: 100, y: 0, zIndex: 1 }),
      id: 'graph_12',
      expressions: [
        { ...createEmptyGraphExpression(0, 'x**2'), id: 'expr_1' },
        { ...createEmptyGraphExpression(1, 'sin(x)'), id: 'expr_2' },
      ],
    };
    const text = formatGraphElementForContext(g);
    const ctx = buildRagContext({
      query: 'Add x cubed.',
      explicitSelections: [
        {
          element_id: g.id,
          element_type: 'graph',
          text,
          has_readable_content: true,
          geometry: { x: g.x, y: g.y, width: g.width, height: g.height },
        },
      ],
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(ctx.stats.explicit_selection_count).toBe(1);
    expect(ctx.serialized).toContain('graph_12');
    expect(ctx.serialized).toContain('x**2');
    expect(ctx.serialized).toContain('expr_1');
    expect(ctx.serialized).not.toMatch(/base64|screenshot|sampled curve|fl_chart/i);
    expect(ctx.allElements[0]?.element_type).toBe('graph');
  });

  it('toGraphContextItem exposes only configured fields', () => {
    const g = {
      ...createGraphElement({ x: 0, y: 0, zIndex: 1 }),
      id: 'graph_9',
      expressions: [{ ...createEmptyGraphExpression(0, '1/x'), id: 'e1' }],
      settings: {
        title: 'Reciprocal',
        xAxisLabel: 'x',
        yAxisLabel: 'y',
        showGrid: false,
        showXAxis: true,
        showYAxis: true,
      },
    };
    const item = toGraphContextItem(g);
    expect(item.expressions[0]).toEqual({
      id: 'e1',
      expression: '1/x',
      visible: true,
      domain_min: null,
      domain_max: null,
    });
    expect(item.settings.title).toBe('Reciprocal');
    expect(item.settings.show_grid).toBe(false);
    expect(Object.keys(item)).toEqual([
      'element_id',
      'element_type',
      'expressions',
      'points',
      'viewport',
      'settings',
      'world_bounds',
    ]);
  });

  it('does not put graphs into empty documents as semantic content', () => {
    const doc = createEmptyDocument();
    expect(doc.elements).toEqual([]);
  });
});
