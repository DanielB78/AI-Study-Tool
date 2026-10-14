/**
 * Single-column agent layout policy tests (acceptance A–H).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../../types/canvas';
import { useCanvasStore } from '../../../../../store/canvasStore';
import { ragSync } from '../../../../rag/ragSync';
import { executeCanvasOperations } from '../../executor';
import { createLiveAgentExecutorTarget } from '../../liveExecutor';
import { parseCanvasAgentResponse } from '../../parser';
import {
  CANVAS_AGENT_JSON_SCHEMA,
  CANVAS_AGENT_OUTPUT_CONTRACT,
  type CanvasOperation,
} from '../../operations';
import { resolveGridPlan } from '../resolveGridPlan';
import {
  LESSON_OUTPUT_LAYOUT,
  STEP_BY_STEP_OUTPUT_LAYOUT,
} from '../outputLayoutConfig';
import { getElementBounds } from '../../../../../utils/coordinates';

function resetCanvas(extra: TextElement[] = []) {
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: extra,
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

const basePlacement = { mode: 'viewport_default' as const };

function textOp(ref: string, text: string, role?: CanvasOperation extends { layout_role?: infer R } ? R : never): CanvasOperation {
  return {
    type: 'create_text',
    ref,
    text,
    placement: basePlacement,
    ...(role ? { layout_role: role } : {}),
  };
}

function equationOp(ref: string, latex: string): CanvasOperation {
  return {
    type: 'create_equation',
    ref,
    latex,
    placement: basePlacement,
    layout_role: 'mathematical_step',
  };
}

function graphOp(ref: string): CanvasOperation {
  return {
    type: 'create_graph',
    ref,
    expressions: [
      { expression: 'sin(x)', visible: true, domain_min: null, domain_max: null },
    ],
    points: [],
    viewport: { x_min: -5, x_max: 5, y_min: -2, y_max: 2 },
    settings: {
      title: null,
      x_axis_label: null,
      y_axis_label: null,
      show_grid: true,
      show_x_axis: true,
      show_y_axis: true,
    },
    placement: basePlacement,
    layout_role: 'visualisation',
  };
}

describe('single-column agent layout policy', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('presets force single-column vertical geometry', () => {
    for (const cfg of [LESSON_OUTPUT_LAYOUT, STEP_BY_STEP_OUTPUT_LAYOUT]) {
      expect(cfg.gridArrangement).toBe('vertical_sequence');
      expect(cfg.cellArrangement).toBe('vertical_stack');
    }
  });

  it('Test A — title, explanation, definition, example, exercise in one column', () => {
    const result = executeCanvasOperations(
      {
        output_type: 'lesson',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [
          textOp('title', 'Electric Potential', 'introduction'),
          textOp('main', 'Potential is energy per charge.'),
          textOp('def', 'Definition: V = U/q.'),
          textOp('ex', 'Example: a 2 C charge…'),
          textOp('exer', 'Exercise: compute V.'),
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    expect(result.layoutDebug?.columns).toBe(1);
    const order = result.layoutDebug!.chronologicalCells!.objectOrder;
    expect(order).toEqual(['title', 'main', 'def', 'ex', 'exer']);
    const byRef = Object.fromEntries(result.layoutDebug!.items.map((i) => [i.ref, i]));
    expect(byRef.main!.localY).toBeGreaterThan(byRef.title!.localY);
    expect(byRef.def!.localY).toBeGreaterThan(byRef.main!.localY);
    expect(byRef.ex!.localY).toBeGreaterThan(byRef.def!.localY);
    expect(byRef.exer!.localY).toBeGreaterThan(byRef.ex!.localY);
  });

  it('Test B — text/graph/text/equation/text preserve exact vertical reading order', () => {
    const result = executeCanvasOperations(
      {
        output_type: 'lesson',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [
          textOp('t1', 'Intro'),
          graphOp('g1'),
          textOp('t2', 'Mid'),
          equationOp('eq1', 'F=-kx'),
          textOp('t3', 'Outro'),
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    expect(result.layoutDebug?.columns).toBe(1);
    const byRef = Object.fromEntries(result.layoutDebug!.items.map((i) => [i.ref, i]));
    expect(byRef.g1!.localY).toBeGreaterThan(byRef.t1!.localY);
    expect(byRef.t2!.localY).toBeGreaterThan(byRef.g1!.localY);
    expect(byRef.eq1!.localY).toBeGreaterThan(byRef.t2!.localY);
    expect(byRef.t3!.localY).toBeGreaterThan(byRef.eq1!.localY);
    // No horizontal pairing
    expect(Math.abs(byRef.g1!.localX - byRef.t1!.localX)).toBeLessThan(80);
  });

  it('Test C — three graphs stack vertically', () => {
    const result = executeCanvasOperations(
      {
        output_type: 'lesson',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [
          textOp('exp', 'Three related plots.'),
          graphOp('g1'),
          graphOp('g2'),
          graphOp('g3'),
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    expect(result.layoutDebug?.columns).toBe(1);
    const byRef = Object.fromEntries(result.layoutDebug!.items.map((i) => [i.ref, i]));
    expect(byRef.g2!.localY).toBeGreaterThan(byRef.g1!.localY + byRef.g1!.height - 1);
    expect(byRef.g3!.localY).toBeGreaterThan(byRef.g2!.localY + byRef.g2!.height - 1);
  });

  it('Test D — alternating text and equations stay in one column', () => {
    const result = executeCanvasOperations(
      {
        output_type: 'step_by_step',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [
          textOp('e1', 'Start', 'explanation'),
          equationOp('m1', 'F=-kx'),
          textOp('e2', 'Next', 'explanation'),
          equationOp('m2', 'F=ma'),
          textOp('e3', 'Done', 'explanation'),
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    expect(result.layoutDebug?.columns).toBe(1);
    const ys = result.layoutDebug!.chronologicalCells!.objectOrder.map(
      (ref) => result.layoutDebug!.items.find((i) => i.ref === ref)!.localY,
    );
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
    }
  });

  it('Test F — manually positioned element is not snapped back', () => {
    const manual: TextElement = {
      id: 'manual_1',
      type: 'text',
      x: 900,
      y: 40,
      width: 200,
      height: 80,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      metadata: { placementMode: 'manual' },
      text: 'Manual',
      fontSize: 16,
      fontFamily: 'sans',
      fontWeight: 'normal',
      fontItalic: false,
      underline: false,
      strikethrough: false,
      color: '#000',
      alignment: 'left',
      verticalAlign: 'top',
      lineHeight: 1.4,
      letterSpacing: 0,
      padding: 12,
      backgroundColor: null,
      borderColor: null,
      borderWidth: 0,
    };
    resetCanvas([manual]);
    executeCanvasOperations(
      {
        output_type: 'lesson',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [textOp('n1', 'New A'), textOp('n2', 'New B')],
      },
      createLiveAgentExecutorTarget(),
    );
    const still = useCanvasStore
      .getState()
      .document.elements.find((e) => e.id === 'manual_1')!;
    expect(still.x).toBe(900);
    expect(still.y).toBe(40);
  });

  it('Test G — resolveGridPlan ignores multi-column grid geometry from LLM', () => {
    const resolved = resolveGridPlan({
      layout: {
        type: 'grid',
        columns: 3,
        placement: basePlacement,
        items: [
          { ref: 'a', row: 0, column: 0 },
          { ref: 'b', row: 0, column: 1 },
          { ref: 'c', row: 0, column: 2 },
        ],
      },
      operations: [textOp('a', 'A'), textOp('b', 'B'), textOp('c', 'C')],
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
      outputType: 'lesson',
    });
    expect(resolved.debug.columns).toBe(1);
    const byRef = Object.fromEntries([...resolved.byRef.entries()]);
    expect(byRef.b!.y).toBeGreaterThan(byRef.a!.y);
    expect(byRef.c!.y).toBeGreaterThan(byRef.b!.y);
  });

  it('Test H — agent schema/contract no longer expose layout_cell or grid rows', () => {
    const createText = (
      CANVAS_AGENT_JSON_SCHEMA.properties.operations.items as {
        oneOf: Array<{ properties?: Record<string, unknown> }>;
      }
    ).oneOf.find((v) => (v.properties?.type as { const?: string })?.const === 'create_text');
    expect(createText?.properties?.layout_cell).toBeUndefined();
    expect(createText?.properties?.column_span).toBeUndefined();

    const createEq = (
      CANVAS_AGENT_JSON_SCHEMA.properties.operations.items as {
        oneOf: Array<{ properties?: Record<string, unknown> }>;
      }
    ).oneOf.find(
      (v) => (v.properties?.type as { const?: string })?.const === 'create_equation',
    );
    expect(createEq?.properties?.layout_cell).toBeUndefined();

    const createGraph = (
      CANVAS_AGENT_JSON_SCHEMA.properties.operations.items as {
        oneOf: Array<{ properties?: Record<string, unknown> }>;
      }
    ).oneOf.find((v) => (v.properties?.type as { const?: string })?.const === 'create_graph');
    expect(createGraph?.properties?.layout_cell).toBeUndefined();

    const layout = CANVAS_AGENT_JSON_SCHEMA.properties.layout as {
      $ref?: string;
      oneOf?: unknown;
    };
    expect(layout.$ref).toContain('chronologicalGridLayout');
    expect(layout.oneOf).toBeUndefined();

    const chrono = CANVAS_AGENT_JSON_SCHEMA.$defs.chronologicalGridLayout as {
      properties: Record<string, unknown>;
    };
    expect(chrono.properties.columns).toBeUndefined();

    expect(CANVAS_AGENT_OUTPUT_CONTRACT).toMatch(/ONE vertical column/i);
    expect(CANVAS_AGENT_OUTPUT_CONTRACT).not.toMatch(
      /"layout_cell":\s*"<optional shared cell id>"/,
    );
  });

  it('legacy layout_cell is still parsed but does not create side-by-side geometry', () => {
    const parsed = parseCanvasAgentResponse(
      JSON.stringify({
        output_type: 'step_by_step',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [
          {
            type: 'create_text',
            ref: 'e',
            layout_cell: 's',
            layout_role: 'explanation',
            text: 'Explain',
          },
          {
            type: 'create_equation',
            ref: 'm',
            layout_cell: 's',
            layout_role: 'mathematical_step',
            latex: 'x=1',
          },
        ],
      }),
      { allowedElementIds: new Set(), elementTypes: new Map() },
    );
    const result = executeCanvasOperations(parsed, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.columns).toBe(1);
    const byRef = Object.fromEntries(result.layoutDebug!.items.map((i) => [i.ref, i]));
    expect(byRef.m!.localY).toBeGreaterThanOrEqual(byRef.e!.localY + byRef.e!.height - 1);
  });

  it('existing canvas elements keep their positions when new content is added', () => {
    const existing: TextElement = {
      id: 'legacy_col',
      type: 'text',
      x: 40,
      y: 40,
      width: 180,
      height: 60,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      text: 'Old column A',
      fontSize: 16,
      fontFamily: 'sans',
      fontWeight: 'normal',
      fontItalic: false,
      underline: false,
      strikethrough: false,
      color: '#000',
      alignment: 'left',
      verticalAlign: 'top',
      lineHeight: 1.4,
      letterSpacing: 0,
      padding: 12,
      backgroundColor: null,
      borderColor: null,
      borderWidth: 0,
    };
    const existingB: TextElement = {
      ...existing,
      id: 'legacy_col_b',
      x: 280,
      y: 40,
      text: 'Old column B',
    };
    resetCanvas([existing, existingB]);
    executeCanvasOperations(
      {
        output_type: 'lesson',
        layout: { type: 'chronological_grid', placement: basePlacement },
        operations: [textOp('new', 'Fresh note')],
      },
      createLiveAgentExecutorTarget(),
    );
    const els = useCanvasStore.getState().document.elements;
    expect(getElementBounds(els.find((e) => e.id === 'legacy_col')!)).toMatchObject({
      x: 40,
      y: 40,
    });
    expect(getElementBounds(els.find((e) => e.id === 'legacy_col_b')!)).toMatchObject({
      x: 280,
      y: 40,
    });
  });
});
