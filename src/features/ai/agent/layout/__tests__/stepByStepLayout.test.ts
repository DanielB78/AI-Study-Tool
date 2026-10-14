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
import type { CanvasAgentResponse, CanvasOperation } from '../../operations';
import {
  classifyOutputTypeHint,
  getOutputLayoutConfig,
  LESSON_OUTPUT_LAYOUT,
  STEP_BY_STEP_OUTPUT_LAYOUT,
} from '../outputLayoutConfig';
import { groupCreationOpsIntoCells } from '../chronologicalCellLayout';
import { resolveGridPlan } from '../resolveGridPlan';
import { getElementBounds } from '../../../../../utils/coordinates';
import { intersectsWithMargin } from '../collision';

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

function textOp(
  ref: string,
  text: string,
  opts?: { layout_cell?: string; layout_role?: CanvasOperation extends { layout_role?: infer R } ? R : never },
): CanvasOperation {
  return {
    type: 'create_text',
    ref,
    text,
    placement: basePlacement,
    ...(opts?.layout_cell ? { layout_cell: opts.layout_cell } : {}),
    ...(opts?.layout_role ? { layout_role: opts.layout_role } : {}),
  };
}

function equationOp(
  ref: string,
  latex: string,
  opts?: { layout_cell?: string; layout_role?: 'mathematical_step' | 'final_result' },
): CanvasOperation {
  return {
    type: 'create_equation',
    ref,
    latex,
    placement: basePlacement,
    ...(opts?.layout_cell ? { layout_cell: opts.layout_cell } : {}),
    ...(opts?.layout_role ? { layout_role: opts.layout_role } : {}),
  };
}

function graphOp(ref: string, layout_cell?: string): CanvasOperation {
  return {
    type: 'create_graph',
    ref,
    expressions: [
      { expression: '0.5*x**2', visible: true, domain_min: null, domain_max: null },
    ],
    points: [],
    viewport: { x_min: -5, x_max: 5, y_min: -1, y_max: 10 },
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
    ...(layout_cell ? { layout_cell } : {}),
  };
}

function stepPlan(operations: CanvasOperation[]): CanvasAgentResponse {
  return {
    output_type: 'step_by_step',
    operations,
    layout: { type: 'chronological_grid', placement: basePlacement },
  };
}

function lessonPlan(operations: CanvasOperation[]): CanvasAgentResponse {
  return {
    output_type: 'lesson',
    operations,
    layout: { type: 'chronological_grid', placement: basePlacement },
  };
}

describe('output layout config', () => {
  it('lesson and step_by_step share single-column vertical geometry', () => {
    expect(LESSON_OUTPUT_LAYOUT.maxObjectsPerCell).toBe(8);
    expect(LESSON_OUTPUT_LAYOUT.cellArrangement).toBe('vertical_stack');
    expect(LESSON_OUTPUT_LAYOUT.gridArrangement).toBe('vertical_sequence');
    expect(STEP_BY_STEP_OUTPUT_LAYOUT.maxObjectsPerCell).toBe(8);
    expect(STEP_BY_STEP_OUTPUT_LAYOUT.cellArrangement).toBe('vertical_stack');
    expect(STEP_BY_STEP_OUTPUT_LAYOUT.gridArrangement).toBe('vertical_sequence');
    expect(getOutputLayoutConfig(undefined).outputType).toBe('lesson');
    expect(getOutputLayoutConfig('step_by_step').outputType).toBe('step_by_step');
  });

  it('Test J — classifyOutputTypeHint selects lesson vs step_by_step', () => {
    expect(classifyOutputTypeHint('Explain electromagnetic induction.')).toBe('lesson');
    expect(classifyOutputTypeHint('Teach me about the quantum harmonic oscillator.')).toBe(
      'lesson',
    );
    expect(
      classifyOutputTypeHint("Derive Faraday's law from the relevant equations."),
    ).toBe('step_by_step');
    expect(classifyOutputTypeHint('Solve this mechanics question.')).toBe('step_by_step');
    expect(classifyOutputTypeHint('Show the full working for this integral.')).toBe(
      'step_by_step',
    );
    expect(classifyOutputTypeHint('Work through this integration.')).toBe('step_by_step');
    expect(classifyOutputTypeHint('Something vague about fields')).toBe('lesson');
  });
});

describe('single-column grouping limits', () => {
  it('Test E — oversized shared cell auto-splits at maxObjectsPerCell', () => {
    const ops = Array.from({ length: 9 }, (_, i) =>
      textOp(`t${i}`, `T${i}`, { layout_cell: 's' }),
    );
    const grouped = groupCreationOpsIntoCells(
      ops,
      STEP_BY_STEP_OUTPUT_LAYOUT.maxObjectsPerCell,
    );
    expect(grouped.maxObjectsPerCell).toBe(8);
    expect(grouped.cells).toHaveLength(2);
    expect(grouped.cells[0]!.members).toHaveLength(8);
    expect(grouped.cells[1]!.members).toHaveLength(1);
    expect(grouped.splits).toHaveLength(1);
  });
});

describe('step_by_step + lesson integration', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('Test A — lesson: multi-create stacks in one vertical column', () => {
    const ops = [
      textOp('a', 'A', { layout_cell: 'c' }),
      textOp('b', 'B', { layout_cell: 'c' }),
      textOp('c', 'C', { layout_cell: 'c' }),
      textOp('d', 'D', { layout_cell: 'c' }),
      textOp('e', 'E'),
      textOp('f', 'F'),
      textOp('g', 'G'),
      textOp('h', 'H'),
      textOp('i', 'I'),
    ];
    const result = executeCanvasOperations(lessonPlan(ops), createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.outputType).toBe('lesson');
    expect(result.layoutDebug?.chronologicalCells?.maxObjectsPerCell).toBe(8);
    expect(result.layoutDebug?.chronologicalCells?.cellArrangement).toBe('vertical_stack');
    expect(result.layoutDebug?.chronologicalCells?.gridArrangement).toBe(
      'vertical_sequence',
    );
    const big = result.layoutDebug!.chronologicalCells!.cells.find(
      (c) => c.cellId === 'c',
    )!;
    expect(big.refs).toHaveLength(4);
    expect(big.arrangement).toBe('vertical_stack');
    expect(result.layoutDebug!.columns).toBe(1);
    expect(result.layoutDebug?.collisionFree).toBe(true);
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.b!.localY).toBeGreaterThan(byRef.a!.localY);
    expect(byRef.e!.localY).toBeGreaterThan(byRef.d!.localY);
    expect(byRef.i!.localY).toBeGreaterThan(byRef.h!.localY);
  });

  it('Test B — three explanation/equation pairs stack vertically (never beside)', () => {
    const plan = stepPlan([
      textOp('e1', 'Hooke', { layout_cell: 's1', layout_role: 'explanation' }),
      equationOp('m1', 'F=-kx', {
        layout_cell: 's1',
        layout_role: 'mathematical_step',
      }),
      textOp('e2', 'Newton', { layout_cell: 's2', layout_role: 'explanation' }),
      equationOp('m2', 'F=ma', {
        layout_cell: 's2',
        layout_role: 'mathematical_step',
      }),
      textOp('e3', 'Combine', { layout_cell: 's3', layout_role: 'explanation' }),
      equationOp('m3', 'm a=-kx', {
        layout_cell: 's3',
        layout_role: 'mathematical_step',
      }),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const cells = result.layoutDebug!.chronologicalCells!.cells;
    expect(result.layoutDebug?.outputType).toBe('step_by_step');
    expect(cells).toHaveLength(3);
    expect(result.layoutDebug?.columns).toBe(1);
    expect(result.layoutDebug?.rows).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(cells[i]!.refs).toHaveLength(2);
      expect(cells[i]!.arrangement).toBe('vertical_stack');
      expect(cells[i]!.row).toBe(i);
      expect(cells[i]!.column).toBe(0);
    }
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    // Vertical textbook: equation below explanation, not beside it
    expect(byRef.m1!.localY).toBeGreaterThan(byRef.e1!.localY);
    expect(byRef.m2!.localY).toBeGreaterThan(byRef.e2!.localY);
    // Vertical cell order
    expect(byRef.e2!.localY).toBeGreaterThan(byRef.e1!.localY);
    expect(byRef.e3!.localY).toBeGreaterThan(byRef.e2!.localY);
  });

  it('Test C — explanation and graph stack vertically (never beside)', () => {
    const plan = stepPlan([
      textOp('exp', 'Potential is quadratic.', {
        layout_cell: 'g',
        layout_role: 'explanation',
      }),
      graphOp('graph', 'g'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const cell = result.layoutDebug!.chronologicalCells!.cells[0]!;
    expect(cell.arrangement).toBe('vertical_stack');
    expect(cell.objectTypes).toEqual(['text', 'graph']);
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.graph!.localY).toBeGreaterThanOrEqual(
      byRef.exp!.localY + byRef.exp!.height,
    );
    expect(result.layoutDebug?.columns).toBe(1);
    expect(result.layoutDebug?.collisionFree).toBe(true);
  });

  it('Test D — single final equation is full-width (not half-cell)', () => {
    const plan = stepPlan([
      textOp('e1', 'Start', { layout_cell: 's1', layout_role: 'explanation' }),
      equationOp('m1', 'F=-kx', {
        layout_cell: 's1',
        layout_role: 'mathematical_step',
      }),
      equationOp('final', 'x(t)=A\\cos(\\omega t)', {
        layout_cell: 'result',
        layout_role: 'final_result',
      }),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const cells = result.layoutDebug!.chronologicalCells!.cells;
    const finalCell = cells.find((c) => c.cellId === 'result')!;
    expect(finalCell.refs).toEqual(['final']);
    expect(finalCell.arrangement).toBe('single');
    const pairCell = cells.find((c) => c.cellId === 's1')!;
    // Solo cell should be about as wide as the pair cell (full column)
    expect(finalCell.width).toBeGreaterThanOrEqual(pairCell.width * 0.85);
  });

  it('Test F — long explanation auto-sizes and grows cell height', () => {
    const long =
      'This paragraph develops the reasoning carefully.\n\n'.repeat(10) +
      'Therefore the force is linear in displacement.';
    const plan = stepPlan([
      textOp('long', long, { layout_cell: 's', layout_role: 'explanation' }),
      equationOp('eq', 'F=-kx', {
        layout_cell: 's',
        layout_role: 'mathematical_step',
      }),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.long!.height).toBeGreaterThan(140);
    const cell = result.layoutDebug!.chronologicalCells!.cells[0]!;
    expect(cell.height).toBeGreaterThanOrEqual(byRef.long!.height);
    expect(result.layoutDebug?.collisionFree).toBe(true);
  });

  it('Test G — wide equation stacks below explanation without overlapping', () => {
    const plan = stepPlan([
      textOp('exp', 'Rearrange the oscillator equation.', {
        layout_cell: 's',
        layout_role: 'explanation',
      }),
      equationOp(
        'eq',
        '\\frac{d^{2}x}{dt^{2}}+\\omega^{2}x=0\\quad\\text{with}\\quad\\omega=\\sqrt{k/m}',
        { layout_cell: 's', layout_role: 'mathematical_step' },
      ),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const cell = result.layoutDebug!.chronologicalCells!.cells[0]!;
    expect(cell.arrangement).toBe('vertical_stack');
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.eq!.localY).toBeGreaterThanOrEqual(
      byRef.exp!.localY + byRef.exp!.height,
    );
    expect(result.layoutDebug?.collisionFree).toBe(true);
  });

  it('Test H — five consecutive steps keep top-to-bottom chronology', () => {
    const ops: CanvasOperation[] = [];
    for (let i = 1; i <= 5; i++) {
      ops.push(
        textOp(`e${i}`, `Step ${i} explanation`, {
          layout_cell: `s${i}`,
          layout_role: 'explanation',
        }),
        equationOp(`m${i}`, `x_${i}=0`, {
          layout_cell: `s${i}`,
          layout_role: 'mathematical_step',
        }),
      );
    }
    const result = executeCanvasOperations(stepPlan(ops), createLiveAgentExecutorTarget());
    const cells = result.layoutDebug!.chronologicalCells!.cells;
    expect(cells).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(cells[i]!.row).toBe(i);
      expect(cells[i]!.refs[0]).toBe(`e${i + 1}`);
    }
    expect(result.layoutDebug!.chronologicalCells!.objectOrder[0]).toBe('e1');
    expect(result.layoutDebug!.chronologicalCells!.objectOrder[9]).toBe('m5');
  });

  it('Test I — solved question structure with given info and final answer', () => {
    const json = {
      output_type: 'step_by_step',
      operations: [
        {
          type: 'create_text',
          ref: 'given',
          layout_cell: 'g0',
          layout_role: 'given_information',
          text: 'Given: m=2 kg, k=8 N/m. Find ω.',
        },
        {
          type: 'create_text',
          ref: 'e1',
          layout_cell: 's1',
          layout_role: 'explanation',
          text: 'Angular frequency for a mass-spring system.',
        },
        {
          type: 'create_equation',
          ref: 'm1',
          layout_cell: 's1',
          layout_role: 'mathematical_step',
          latex: '\\omega=\\sqrt{k/m}',
        },
        {
          type: 'create_text',
          ref: 'e2',
          layout_cell: 's2',
          layout_role: 'explanation',
          text: 'Substitute the known values.',
        },
        {
          type: 'create_equation',
          ref: 'm2',
          layout_cell: 's2',
          layout_role: 'mathematical_step',
          latex: '\\omega=\\sqrt{8/2}=2',
        },
        {
          type: 'create_equation',
          ref: 'final',
          layout_cell: 'ans',
          layout_role: 'final_result',
          latex: '\\omega=2\\,\\mathrm{rad/s}',
        },
      ],
      layout: { type: 'chronological_grid', placement: basePlacement },
    };
    const parsed = parseCanvasAgentResponse(JSON.stringify(json), {
      allowedElementIds: new Set(),
      elementTypes: new Map(),
    });
    expect(parsed.output_type).toBe('step_by_step');
    const result = executeCanvasOperations(parsed, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.outputType).toBe('step_by_step');
    expect(result.layoutDebug?.columns).toBe(1);
    expect(result.createdIds.length).toBeGreaterThanOrEqual(6);
    const finalEl = useCanvasStore
      .getState()
      .document.elements.find((e) => e.metadata?.layoutRole === 'final_result');
    expect(finalEl).toBeTruthy();
  });

  it('Test K — step_by_step layout avoids existing obstacles', () => {
    const obstacle: TextElement = {
      id: 'existing_1',
      type: 'text',
      x: 40,
      y: 40,
      width: 500,
      height: 400,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      text: 'Obstacle',
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
    resetCanvas([obstacle]);
    const plan = stepPlan([
      textOp('e1', 'A', { layout_cell: 's1', layout_role: 'explanation' }),
      equationOp('m1', 'a=1', {
        layout_cell: 's1',
        layout_role: 'mathematical_step',
      }),
      textOp('e2', 'B', { layout_cell: 's2', layout_role: 'explanation' }),
      equationOp('m2', 'b=2', {
        layout_cell: 's2',
        layout_role: 'mathematical_step',
      }),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.collisionFree).toBe(true);
    const obsBounds = getElementBounds(obstacle);
    for (const el of useCanvasStore.getState().document.elements) {
      if (el.id === 'existing_1') continue;
      expect(intersectsWithMargin(getElementBounds(el), [obsBounds], 0)).toBe(false);
    }
  });

  it('Test L — undo/redo is atomic for step_by_step', () => {
    const plan = stepPlan([
      textOp('e1', 'A', { layout_cell: 's1', layout_role: 'explanation' }),
      equationOp('m1', 'a=1', {
        layout_cell: 's1',
        layout_role: 'mathematical_step',
      }),
      equationOp('final', 'a=1', {
        layout_cell: 'r',
        layout_role: 'final_result',
      }),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const ids = [...result.createdIds].sort();
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(
      useCanvasStore
        .getState()
        .document.elements.map((e) => e.id)
        .sort(),
    ).toEqual(ids);
  });

  it('Test M — zoom does not change world-space layout dimensions', () => {
    const plan = stepPlan([
      textOp('e1', 'Explain', { layout_cell: 's1', layout_role: 'explanation' }),
      equationOp('m1', 'E=mc^2', {
        layout_cell: 's1',
        layout_role: 'mathematical_step',
      }),
    ]);
    const at1 = resolveGridPlan({
      layout: plan.layout!,
      operations: plan.operations,
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
      outputType: 'step_by_step',
    });
    const at2 = resolveGridPlan({
      layout: plan.layout!,
      operations: plan.operations,
      camera: { x: 100, y: -50, zoom: 2.5 },
      elements: [],
      style: DEFAULT_STYLE,
      outputType: 'step_by_step',
    });
    expect(at1.debug.localBounds.width).toBeCloseTo(at2.debug.localBounds.width, 0);
    expect(at1.debug.localBounds.height).toBeCloseTo(at2.debug.localBounds.height, 0);
    expect(at1.debug.items[0]!.width).toBeCloseTo(at2.debug.items[0]!.width, 0);
  });

  it('parser accepts output_type and layout_role', () => {
    const parsed = parseCanvasAgentResponse(
      JSON.stringify({
        output_type: 'step_by_step',
        operations: [
          {
            type: 'create_text',
            ref: 'a',
            layout_cell: 's',
            layout_role: 'explanation',
            text: 'Hi',
          },
          {
            type: 'create_equation',
            ref: 'b',
            layout_cell: 's',
            layout_role: 'mathematical_step',
            latex: 'x=1',
          },
        ],
        layout: { type: 'chronological_grid', placement: basePlacement },
      }),
      { allowedElementIds: new Set(), elementTypes: new Map() },
    );
    expect(parsed.output_type).toBe('step_by_step');
    expect(
      (parsed.operations[0] as { layout_role?: string }).layout_role,
    ).toBe('explanation');
  });
});
