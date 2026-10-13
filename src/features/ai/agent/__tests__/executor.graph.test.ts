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
import type { CreateGraphOperation } from '../operations';
import { DEFAULT_GRAPH_HEIGHT, DEFAULT_GRAPH_WIDTH } from '../../../graphs/types';

function resetCanvas() {
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: [
        {
          id: 'textbox_18',
          type: 'text',
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
          text: 'Simple harmonic motion is described by x(t)=A cos(ωt).',
          fontSize: 16,
          fontFamily: 'sans',
          fontWeight: 'normal',
          fontItalic: false,
          underline: false,
          strikethrough: false,
          color: '#000',
          alignment: 'left',
          lineHeight: 1.3,
          backgroundColor: '#fff',
          padding: 12,
          cornerRadius: 8,
        } satisfies TextElement,
      ],
    },
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

function sampleCreateGraph(
  overrides: Partial<CreateGraphOperation> = {},
): CreateGraphOperation {
  return {
    type: 'create_graph',
    expressions: [
      {
        expression: 'x**2',
        visible: true,
        domain_min: null,
        domain_max: null,
      },
    ],
    points: [],
    viewport: { x_min: -10, x_max: 10, y_min: -10, y_max: 10 },
    settings: {
      title: null,
      x_axis_label: null,
      y_axis_label: null,
      show_grid: true,
      show_x_axis: true,
      show_y_axis: true,
    },
    placement: { mode: 'viewport_default' },
    ...overrides,
  };
}

describe('executeCanvasOperations — create_graph', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a real interactive GraphElement with canonical expressions', () => {
    const result = executeCanvasOperations(
      [sampleCreateGraph()],
      createLiveAgentExecutorTarget(),
    );
    expect(result.createdIds).toHaveLength(1);
    const created = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === result.createdIds[0]);
    expect(created?.type).toBe('graph');
    if (created?.type !== 'graph') return;
    expect(created.width).toBe(DEFAULT_GRAPH_WIDTH);
    expect(created.height).toBe(DEFAULT_GRAPH_HEIGHT);
    expect(created.expressions).toHaveLength(1);
    expect(created.expressions[0]?.sourceText).toBe('x**2');
    expect(created.metadata.operation).toBe('create_graph');
    expect(created.metadata.createdBy).toBe('ai');
  });

  it('creates one graph with multiple curves and custom viewport/settings', () => {
    const result = executeCanvasOperations(
      [
        sampleCreateGraph({
          expressions: [
            { expression: 'sin(x)', visible: true, domain_min: null, domain_max: null },
            { expression: 'cos(x)', visible: true, domain_min: null, domain_max: null },
            { expression: 'x/2', visible: true, domain_min: null, domain_max: null },
          ],
          viewport: { x_min: -10, x_max: 10, y_min: -2, y_max: 2 },
          settings: {
            title: 'Trig comparison',
            x_axis_label: 'Time',
            y_axis_label: 'Displacement',
            show_grid: false,
            show_x_axis: true,
            show_y_axis: true,
          },
        }),
      ],
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === result.createdIds[0]) as GraphElement;
    expect(graph.expressions.map((e) => e.sourceText)).toEqual([
      'sin(x)',
      'cos(x)',
      'x/2',
    ]);
    expect(graph.viewport).toEqual({ xMin: -10, xMax: 10, yMin: -2, yMax: 2 });
    expect(graph.settings.title).toBe('Trig comparison');
    expect(graph.settings.showGrid).toBe(false);
    expect(graph.settings.xAxisLabel).toBe('Time');
    expect(graph.settings.yAxisLabel).toBe('Displacement');
  });

  it('places relative to an anchor and supports undo as one transaction', () => {
    executeCanvasOperations(
      [
        sampleCreateGraph({
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_18',
            relation: 'right_of',
          },
        }),
      ],
      createLiveAgentExecutorTarget(),
    );
    expect(useCanvasStore.getState().document.elements).toHaveLength(2);
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'graph')!;
    const anchor = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === 'textbox_18')!;
    expect(graph.x).toBeGreaterThan(anchor.x + anchor.width);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    expect(useCanvasStore.getState().document.elements[0]?.type).toBe('text');
  });

  it('stores explicit points when requested', () => {
    const result = executeCanvasOperations(
      [
        sampleCreateGraph({
          points: [{ x: 2, y: 4, label: 'A', visible: true }],
        }),
      ],
      createLiveAgentExecutorTarget(),
    );
    const graph = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === result.createdIds[0]) as GraphElement;
    expect(graph.points).toHaveLength(1);
    expect(graph.points[0]?.label).toBe('A');
    expect(graph.points[0]?.x).toBe(2);
    expect(graph.points[0]?.y).toBe(4);
  });

  it('resolves create_graph ref for add_graph_caption target_ref', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_graph',
            ref: 'pendulum_graph',
            expressions: [
              {
                expression: '0.5*exp(-0.18*x)*cos(2.393*x)',
                visible: true,
                domain_min: 0,
                domain_max: 20,
              },
              {
                expression:
                  '0.5*exp(-0.18*x)*cos(2.393*x) + 0.316*sin(2*x - 0.388)',
                visible: true,
                domain_min: 0,
                domain_max: 20,
              },
            ],
            points: [],
            viewport: {
              x_min: 0,
              x_max: 20,
              y_min: -0.9,
              y_max: 0.9,
            },
            settings: {
              title: 'Pendulum Motion: Damping and Driving Forces',
              x_axis_label: 'Time (s)',
              y_axis_label: 'Angular displacement (rad)',
              show_grid: true,
              show_x_axis: true,
              show_y_axis: true,
            },
            placement: { mode: 'viewport_default' },
          },
          {
            type: 'add_graph_caption',
            target_ref: 'pendulum_graph',
            text: 'Small-angle approximation. Curve 1 damps; Curve 2 is driven.',
          },
        ],
      }),
      { allowedElementIds: new Set() },
    );

    const result = executeCanvasOperations(
      plan,
      createLiveAgentExecutorTarget(),
    );
    expect(result.createdIds.length).toBeGreaterThanOrEqual(2);

    const els = useCanvasStore.getState().document.elements;
    const graph = els.find((e) => e.type === 'graph') as GraphElement;
    const caption = els.find(
      (e): e is TextElement =>
        e.type === 'text' && e.componentType === 'caption',
    );
    expect(graph).toBeTruthy();
    expect(graph.expressions).toHaveLength(2);
    expect(caption).toBeTruthy();
    expect(caption!.componentMeta?.associatedElementId).toBe(graph.id);
    expect(caption!.text).toContain('Small-angle approximation');
  });
});
