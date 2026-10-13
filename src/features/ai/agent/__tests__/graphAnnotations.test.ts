/**
 * Native GraphElement annotations — legend, regions, point labels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type GraphElement,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { parseCanvasAgentResponse } from '../parser';
import {
  applyGraphAnnotationOperation,
  createGraphRegion,
  parseGraphAnnotationOperation,
} from '../graphAnnotationOperations';
import { createGraphElement, createEmptyGraphExpression } from '../../../graphs/createGraphElement';
import {
  expressionDisplayLabel,
  shouldShowLegend,
} from '../../../graphs/types';
import { plainTextToRichText } from '../../../text/richText';
import { ensureBlockIds } from '../../../text/textFeatures';
import { migrateDocument } from '../../../../persistence/migrate';

function seedText(): TextElement {
  const text = 'Displacement and velocity.';
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText: ensureBlockIds(plainTextToRichText(text)),
    componentType: 'main_text',
    componentMeta: { placementMode: 'auto' },
    x: 100,
    y: 100,
    width: 360,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 15,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.45,
    backgroundColor: null,
    padding: 12,
    cornerRadius: 0,
  };
}

function ctx(extraIds: string[] = []) {
  return {
    allowedElementIds: new Set(['text_12', ...extraIds]),
    elementTypes: new Map<string, string>([
      ['text_12', 'text'],
      ...extraIds.map((id) => [id, 'graph'] as const),
    ]),
  };
}

function makeTwoCurveGraph(): GraphElement {
  const g = createGraphElement({ x: 0, y: 0, zIndex: 2 });
  return {
    ...g,
    id: 'graph_12',
    expressions: [
      { ...createEmptyGraphExpression(0, 'sin(x)'), id: 'curve_1', label: '' },
      { ...createEmptyGraphExpression(1, 'cos(x)'), id: 'curve_2', label: '' },
    ],
  };
}

beforeEach(() => {
  vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: [seedText()],
    },
    selectedIds: [],
    past: [],
    future: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('legend helpers', () => {
  it('auto-hides for one curve and shows for multiple', () => {
    const one = [createEmptyGraphExpression(0, 'sin(x)')];
    const two = [
      createEmptyGraphExpression(0, 'sin(x)'),
      createEmptyGraphExpression(1, 'cos(x)'),
    ];
    expect(shouldShowLegend({ ...makeTwoCurveGraph().settings, legendVisibility: 'auto' }, one)).toBe(
      false,
    );
    expect(shouldShowLegend({ ...makeTwoCurveGraph().settings, legendVisibility: 'auto' }, two)).toBe(
      true,
    );
    expect(shouldShowLegend({ ...makeTwoCurveGraph().settings, legendVisibility: 'show' }, one)).toBe(
      true,
    );
    expect(shouldShowLegend({ ...makeTwoCurveGraph().settings, legendVisibility: 'hide' }, two)).toBe(
      false,
    );
  });

  it('expressionDisplayLabel prefers label over source', () => {
    const expr = { ...createEmptyGraphExpression(0, 'sin(x)'), label: 'Displacement' };
    expect(expressionDisplayLabel(expr)).toBe('Displacement');
    expect(expressionDisplayLabel({ ...expr, label: '' })).toBe('sin(x)');
  });
});

describe('parse + apply annotation ops', () => {
  it('parses set_graph_legend and set_graph_curve_label', () => {
    const legend = parseGraphAnnotationOperation({
      type: 'set_graph_legend',
      target_element_id: 'graph_12',
      visibility: 'show',
    });
    expect(legend).toEqual({
      type: 'set_graph_legend',
      target_element_id: 'graph_12',
      graph_id: 'graph_12',
      visibility: 'show',
    });
    const label = parseGraphAnnotationOperation({
      type: 'set_graph_curve_label',
      target_element_id: 'graph_12',
      expression_id: 'curve_1',
      label: 'Displacement',
    });
    expect(label.type).toBe('set_graph_curve_label');
  });

  it('applies legend and curve labels without changing math', () => {
    let g = makeTwoCurveGraph();
    g = applyGraphAnnotationOperation(g, {
      type: 'set_graph_legend',
      target_element_id: g.id,
      visibility: 'show',
    });
    expect(g.settings.legendVisibility).toBe('show');
    g = applyGraphAnnotationOperation(g, {
      type: 'set_graph_curve_label',
      target_element_id: g.id,
      expression_id: 'curve_1',
      label: 'Displacement',
    });
    expect(g.expressions[0]!.label).toBe('Displacement');
    expect(g.expressions[0]!.sourceText).toBe('sin(x)');
  });

  it('adds x_interval, rectangle, and curve_segment regions', () => {
    let g = makeTwoCurveGraph();
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: {
        type: 'x_interval',
        x_min: 1,
        x_max: 3,
        label: 'Approx',
      },
    });
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: {
        type: 'rectangle',
        x_min: 1,
        x_max: 3,
        y_min: 0,
        y_max: 2,
        label: 'ROI',
      },
    });
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: {
        type: 'curve_segment',
        expression_id: 'curve_1',
        x_min: 0,
        x_max: Math.PI,
        label: 'Increasing',
      },
    });
    expect(g.regions).toHaveLength(3);
    expect(g.regions[0]!.type).toBe('x_interval');
    expect(g.regions[1]!.type).toBe('rectangle');
    expect(g.regions[1]!.yMin).toBe(0);
    expect(g.regions[2]!.expressionId).toBe('curve_1');
  });

  it('normalizes reversed bounds and skips exact duplicates', () => {
    const region = createGraphRegion({
      type: 'x_interval',
      x_min: 5,
      x_max: 1,
      label: 'band',
    });
    expect(region.xMin).toBe(1);
    expect(region.xMax).toBe(5);

    let g = makeTwoCurveGraph();
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: { type: 'x_interval', x_min: 1, x_max: 3, label: 'A' },
    });
    const firstId = g.regions[0]!.id;
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: { type: 'x_interval', x_min: 3, x_max: 1, label: 'B' },
    });
    expect(g.regions).toHaveLength(1);
    expect(g.regions[0]!.id).toBe(firstId);
  });

  it('updates and removes regions by id', () => {
    let g = makeTwoCurveGraph();
    g = applyGraphAnnotationOperation(g, {
      type: 'add_graph_region',
      target_element_id: g.id,
      region: { type: 'x_interval', x_min: 1, x_max: 3, label: 'A' },
    });
    const id = g.regions[0]!.id;
    g = applyGraphAnnotationOperation(g, {
      type: 'update_graph_region',
      target_element_id: g.id,
      region_id: id,
      label: 'Updated',
      x_min: 2,
      x_max: 4,
    });
    expect(g.regions[0]!.label).toBe('Updated');
    expect(g.regions[0]!.xMin).toBe(2);
    g = applyGraphAnnotationOperation(g, {
      type: 'remove_graph_region',
      target_element_id: g.id,
      region_id: id,
    });
    expect(g.regions).toHaveLength(0);
  });

  it('rejects unknown expression_id for curve_segment', () => {
    const g = makeTwoCurveGraph();
    expect(() =>
      applyGraphAnnotationOperation(g, {
        type: 'add_graph_region',
        target_element_id: g.id,
        region: {
          type: 'curve_segment',
          expression_id: 'missing',
          x_min: 0,
          x_max: 1,
        },
      }),
    ).toThrow(/Unknown expression_id/);
  });
});

describe('agent pipeline', () => {
  it('set_graph_legend and set_graph_curve_label via executor', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g',
              expressions: [
                { expression: 'sin(x)', visible: true, label: 'Displacement' },
                { expression: 'cos(x)', visible: true },
              ],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    expect(graph.expressions[0]!.label).toBe('Displacement');

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'set_graph_legend',
              target_element_id: graph.id,
              visibility: 'show',
            },
            {
              type: 'set_graph_curve_label',
              target_element_id: graph.id,
              expression_id: graph.expressions[1]!.id,
              label: 'Velocity',
            },
          ],
        }),
        ctx([graph.id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    expect(updated.settings.legendVisibility).toBe('show');
    expect(updated.expressions[1]!.label).toBe('Velocity');
    expect(updated.expressions[1]!.sourceText).toBe('cos(x)');
  });

  it('add_graph_region stacks multiple native regions', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              ref: 'g',
              expressions: [{ expression: 'sin(x)', visible: true }],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    const exprId = graph.expressions[0]!.id;

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_region',
              target_element_id: graph.id,
              region: {
                type: 'x_interval',
                x_min: 1,
                x_max: 3,
                label: 'Approx',
              },
            },
            {
              type: 'add_graph_region',
              target_element_id: graph.id,
              region: {
                type: 'curve_segment',
                expression_id: exprId,
                x_min: 0,
                x_max: 3.14,
                label: 'Rising',
              },
            },
          ],
        }),
        ctx([graph.id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    expect(updated.regions).toHaveLength(2);
    expect(updated.regions.map((r) => r.type)).toEqual([
      'x_interval',
      'curve_segment',
    ]);
  });

  it('annotate_graph_point upserts rather than duplicating', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              expressions: [{ expression: 'sin(x)', visible: true }],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;
    const exprId = graph.expressions[0]!.id;

    const annotate = (label: string) =>
      executeCanvasOperations(
        parseCanvasAgentResponse(
          JSON.stringify({
            operations: [
              {
                type: 'annotate_graph_point',
                target_element_id: graph.id,
                expression_id: exprId,
                x: 1.5708,
                label,
              },
            ],
          }),
          ctx([graph.id]),
        ),
        createLiveAgentExecutorTarget(),
      );

    annotate('Maximum');
    annotate('Peak');
    const updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    expect(updated.points).toHaveLength(1);
    expect(updated.points[0]!.label).toBe('Peak');
  });

  it('remove_graph_region deletes one region without clearing others', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_to_text',
              target_element_id: 'text_12',
              expressions: [{ expression: 'x', visible: true }],
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph') as GraphElement;

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_region',
              target_element_id: graph.id,
              region: { type: 'x_interval', x_min: 0, x_max: 1, label: 'A' },
            },
            {
              type: 'add_graph_region',
              target_element_id: graph.id,
              region: { type: 'x_interval', x_min: 2, x_max: 4, label: 'B' },
            },
          ],
        }),
        ctx([graph.id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    let updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    const removeId = updated.regions[0]!.id;
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'remove_graph_region',
              target_element_id: graph.id,
              region_id: removeId,
            },
          ],
        }),
        ctx([graph.id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    updated = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === graph.id) as GraphElement;
    expect(updated.regions).toHaveLength(1);
    expect(updated.regions[0]!.label).toBe('B');
  });
});

describe('migration', () => {
  it('defaults label, legendVisibility, and regions for legacy graphs', () => {
    const doc = migrateDocument({
      version: 6,
      id: 'board',
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [
        {
          type: 'graph',
          id: 'g1',
          x: 0,
          y: 0,
          width: 200,
          height: 160,
          expressions: [
            {
              id: 'e1',
              sourceText: 'sin(x)',
              visible: true,
              style: { color: '#2563eb', strokeWidth: 2 },
            },
          ],
          points: [],
          viewport: {},
          settings: { title: 'Legacy' },
        },
      ],
    });
    expect(doc).not.toBeNull();
    const g = doc!.elements[0] as GraphElement;
    expect(g.expressions[0]!.label).toBe('');
    expect(g.settings.legendVisibility).toBe('auto');
    expect(g.regions).toEqual([]);
    expect(doc!.version).toBe(8);
  });
});
