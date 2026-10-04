import { describe, expect, it } from 'vitest';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
} from '../parser';
import type { CreateGraphOperation } from '../operations';

const ctx = {
  allowedElementIds: new Set(['textbox_18', 'graph_1']),
  elementTypes: new Map([
    ['textbox_18', 'text'],
    ['graph_1', 'graph'],
  ]),
};

function makeGraphOp(overrides: Record<string, unknown> = {}) {
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

describe('parseCanvasAgentResponse — create_graph', () => {
  it('parses a basic graph of x**2 with defaults', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({ operations: [makeGraphOp()] }),
      ctx,
    );
    expect(res.operations).toHaveLength(1);
    const op = res.operations[0] as CreateGraphOperation;
    expect(op.type).toBe('create_graph');
    expect(op.expressions[0]?.expression).toBe('x**2');
    expect(op.viewport).toEqual({
      x_min: -10,
      x_max: 10,
      y_min: -10,
      y_max: 10,
    });
    expect(op.settings.show_grid).toBe(true);
  });

  it('parses multiple curves in one create_graph', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          makeGraphOp({
            expressions: [
              { expression: 'x**2', visible: true },
              { expression: 'x**3', visible: true },
              { expression: '2*x + 1', visible: true },
            ],
          }),
        ],
      }),
      ctx,
    );
    const op = res.operations[0] as CreateGraphOperation;
    expect(op.expressions.map((e) => e.expression)).toEqual([
      'x**2',
      'x**3',
      '2*x + 1',
    ]);
  });

  it('applies requested viewport limits', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          makeGraphOp({
            expressions: [{ expression: 'sin(x)', visible: true }],
            viewport: { x_min: -10, x_max: 10, y_min: -2, y_max: 2 },
          }),
        ],
      }),
      ctx,
    );
    const op = res.operations[0] as CreateGraphOperation;
    expect(op.viewport.y_min).toBe(-2);
    expect(op.viewport.y_max).toBe(2);
  });

  it('parses title, grid off, and axis labels', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          makeGraphOp({
            expressions: [{ expression: '1/x', visible: true }],
            settings: {
              title: 'Reciprocal Function',
              x_axis_label: 'Time',
              y_axis_label: 'Displacement',
              show_grid: false,
              show_x_axis: true,
              show_y_axis: true,
            },
          }),
        ],
      }),
      ctx,
    );
    const op = res.operations[0] as CreateGraphOperation;
    expect(op.expressions[0]?.expression).toBe('1/x');
    expect(op.settings.show_grid).toBe(false);
    expect(op.settings.title).toBe('Reciprocal Function');
    expect(op.settings.x_axis_label).toBe('Time');
    expect(op.settings.y_axis_label).toBe('Displacement');
  });

  it('parses per-expression domain limits', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          makeGraphOp({
            expressions: [
              {
                expression: 'sqrt(x)',
                visible: true,
                domain_min: 0,
                domain_max: 25,
              },
            ],
          }),
        ],
      }),
      ctx,
    );
    const op = res.operations[0] as CreateGraphOperation;
    expect(op.expressions[0]?.domain_min).toBe(0);
    expect(op.expressions[0]?.domain_max).toBe(25);
  });

  it('rejects non-canonical AI expression x^2 (strict)', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            makeGraphOp({
              expressions: [{ expression: 'x^2', visible: true }],
            }),
          ],
        }),
        ctx,
      ),
    ).toThrow(CanvasAgentParseError);

    try {
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            makeGraphOp({
              expressions: [{ expression: 'x^2', visible: true }],
            }),
          ],
        }),
        ctx,
      );
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasAgentParseError);
      expect((err as CanvasAgentParseError).code).toBe('invalid_graph_expression');
    }
  });

  it('rejects invalid viewport ranges', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            makeGraphOp({
              viewport: { x_min: 5, x_max: 5, y_min: -1, y_max: 1 },
            }),
          ],
        }),
        ctx,
      ),
    ).toThrow(/x_min < x_max/i);
  });

  it('rejects empty expressions and points', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [makeGraphOp({ expressions: [], points: [] })],
        }),
        ctx,
      ),
    ).toThrow(/at least one expression or point/i);
  });

  it('rejects invented graph targets for edit ops', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_graph_expression',
              graph_id: 'missing',
              expression: { expression: 'x**3', visible: true },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/i);
  });

  it('parses add/update/remove/visibility/viewport/settings/point ops', () => {
    const graphCtx = {
      ...ctx,
      graphExpressionIds: new Map([['graph_1', new Set(['expr_1', 'expr_2'])]]),
      graphPointIds: new Map([['graph_1', new Set(['point_1'])]]),
    };
    const raw = JSON.stringify({
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
    });
    const res = parseCanvasAgentResponse(raw, graphCtx);
    expect(res.operations).toHaveLength(8);
    const plan = describeOperationPlan(res.operations);
    expect(plan[0]).toContain('EDIT GRAPH');
    expect(plan[0]).toContain('ADD CURVE');
    expect(plan[1]).toContain('UPDATE CURVE');
    expect(plan[2]).toContain('HIDE CURVE');
    expect(plan[3]).toContain('REMOVE CURVE');
    expect(plan[4]).toContain('CHANGE VIEWPORT');
    expect(plan[5]).toContain('UPDATE SETTINGS');
  });

  it('rejects unknown expression_id on graph', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'remove_graph_expression',
              graph_id: 'graph_1',
              expression_id: 'nope',
            },
          ],
        }),
        {
          ...ctx,
          graphExpressionIds: new Map([['graph_1', new Set(['expr_1'])]]),
        },
      ),
    ).toThrow(/not on graph/i);
  });

  it('rejects relative placement with inventing anchor', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            makeGraphOp({
              placement: {
                mode: 'relative_to_element',
                anchor_element_id: 'missing',
                relation: 'right_of',
              },
            }),
          ],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/i);
  });

  it('describeOperationPlan shows CREATE GRAPH summary', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          makeGraphOp({
            expressions: [
              { expression: 'x**2', visible: true },
              { expression: 'sin(x)', visible: true },
            ],
            viewport: { x_min: -10, x_max: 10, y_min: -5, y_max: 10 },
            settings: {
              title: null,
              x_axis_label: null,
              y_axis_label: null,
              show_grid: true,
              show_x_axis: true,
              show_y_axis: true,
            },
          }),
        ],
      }),
      ctx,
    );
    const lines = describeOperationPlan(res.operations);
    expect(lines[0]).toContain('CREATE GRAPH');
    expect(lines[0]).toContain('y = x^2');
    expect(lines[0]).toContain('y = sin(x)');
    expect(lines[0]).toMatch(/X range:\s*-10 → 10/);
    expect(lines[0]).toMatch(/Y range:\s*-5 → 10/);
    expect(lines[0]).toContain('Grid: On');
    expect(lines[0]).toContain('In front of you');
  });
});
