import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type GraphElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { createGraphElement, createEmptyGraphExpression, createGraphPoint } from '../../../graphs/createGraphElement';
import { parseCanvasAgentResponse } from '../parser';

function seedGraph(): GraphElement {
  const g = createGraphElement({ x: 0, y: 0, zIndex: 1 });
  const e1 = { ...createEmptyGraphExpression(0, 'x**2'), id: 'expr_1' };
  const e2 = { ...createEmptyGraphExpression(1, 'sin(x)'), id: 'expr_2' };
  const p1 = { ...createGraphPoint(1, 1, 'P'), id: 'point_1' };
  return {
    ...g,
    id: 'graph_1',
    expressions: [e1, e2],
    points: [p1],
  };
}

function resetWithGraph(graph: GraphElement = seedGraph()) {
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: [graph],
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

const parseCtx = {
  allowedElementIds: new Set(['graph_1']),
  elementTypes: new Map([['graph_1', 'graph']]),
  graphExpressionIds: new Map([['graph_1', new Set(['expr_1', 'expr_2'])]]),
  graphPointIds: new Map([['graph_1', new Set(['point_1'])]]),
};

describe('executeCanvasOperations — graph edits', () => {
  beforeEach(() => {
    resetWithGraph();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds / updates / hides / removes curves with PATCH semantics', () => {
    const parsed = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_graph_expression',
            graph_id: 'graph_1',
            expression: { expression: 'x**3', visible: true },
          },
          {
            type: 'update_graph_expression',
            graph_id: 'graph_1',
            expression_id: 'expr_1',
            expression: 'x**2 + 2*x + 1',
          },
          {
            type: 'set_graph_expression_visibility',
            graph_id: 'graph_1',
            expression_id: 'expr_1',
            visible: false,
          },
          {
            type: 'remove_graph_expression',
            graph_id: 'graph_1',
            expression_id: 'expr_2',
          },
        ],
      }),
      parseCtx,
    );
    executeCanvasOperations(parsed.operations, createLiveAgentExecutorTarget());
    const g = useCanvasStore.getState().document.elements[0] as GraphElement;
    expect(g.expressions.map((e) => e.sourceText)).toEqual([
      'x**2 + 2*x + 1',
      'x**3',
    ]);
    expect(g.expressions[0]?.visible).toBe(false);
    expect(g.expressions.some((e) => e.id === 'expr_2')).toBe(false);
    expect(g.settings.showGrid).toBe(true); // unchanged
  });

  it('updates viewport and settings without touching expressions', () => {
    const parsed = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'update_graph_viewport',
            graph_id: 'graph_1',
            x_min: -5,
            x_max: 5,
          },
          {
            type: 'update_graph_settings',
            graph_id: 'graph_1',
            title: 'Projectile Motion',
            show_grid: false,
          },
        ],
      }),
      parseCtx,
    );
    executeCanvasOperations(parsed.operations, createLiveAgentExecutorTarget());
    const g = useCanvasStore.getState().document.elements[0] as GraphElement;
    expect(g.viewport).toEqual({ xMin: -5, xMax: 5, yMin: -10, yMax: 10 });
    expect(g.settings.title).toBe('Projectile Motion');
    expect(g.settings.showGrid).toBe(false);
    expect(g.expressions).toHaveLength(2);
  });

  it('adds and removes points; undoes as one transaction', () => {
    const parsed = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_graph_point',
            graph_id: 'graph_1',
            x: 2,
            y: 4,
            label: 'A',
          },
          {
            type: 'remove_graph_point',
            graph_id: 'graph_1',
            point_id: 'point_1',
          },
        ],
      }),
      parseCtx,
    );
    executeCanvasOperations(parsed.operations, createLiveAgentExecutorTarget());
    const g = useCanvasStore.getState().document.elements[0] as GraphElement;
    expect(g.points).toHaveLength(1);
    expect(g.points[0]?.label).toBe('A');
    expect(g.points[0]?.x).toBe(2);

    useCanvasStore.getState().undo();
    const undone = useCanvasStore.getState().document.elements[0] as GraphElement;
    expect(undone.points).toHaveLength(1);
    expect(undone.points[0]?.id).toBe('point_1');
  });
});
