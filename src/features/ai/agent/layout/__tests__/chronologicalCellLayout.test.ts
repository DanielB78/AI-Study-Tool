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
import { CANVAS_AGENT_DOCUMENT_ID, CANVAS_AGENT_MODE } from '../../prompts/loadAgentPrompt';
import {
  ChronologicalCellLayoutError,
  groupCreationOpsIntoCells,
  MAX_OBJECTS_PER_CELL,
} from '../chronologicalCellLayout';
import { resolveGridPlan } from '../resolveGridPlan';
import { maxColumnsForObjectCount } from '../gridReflow';
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
  layout_cell?: string,
  column_span?: number,
): CanvasOperation {
  return {
    type: 'create_text',
    ref,
    text,
    placement: basePlacement,
    ...(layout_cell ? { layout_cell } : {}),
    ...(column_span !== undefined ? { column_span } : {}),
  };
}

function equationOp(ref: string, latex: string, layout_cell?: string): CanvasOperation {
  return {
    type: 'create_equation',
    ref,
    latex,
    placement: basePlacement,
    ...(layout_cell ? { layout_cell } : {}),
  };
}

function graphOp(ref: string, layout_cell?: string): CanvasOperation {
  return {
    type: 'create_graph',
    ref,
    expressions: [
      { expression: 'x**2', visible: true, domain_min: null, domain_max: null },
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
    placement: basePlacement,
    ...(layout_cell ? { layout_cell } : {}),
  };
}

function chronologicalPlan(
  operations: CanvasOperation[],
  columns?: number,
): CanvasAgentResponse {
  return {
    operations,
    layout: {
      type: 'chronological_grid',
      placement: basePlacement,
      ...(columns !== undefined ? { columns } : {}),
    },
  };
}

function readingKey(row: number, column: number, columns: number): number {
  return row * columns + column;
}

describe('High-mode document identity', () => {
  it('exposes canvas_agent_high as active High mode', () => {
    expect(CANVAS_AGENT_DOCUMENT_ID).toBe('canvas_agent_high');
    expect(CANVAS_AGENT_MODE).toBe('high');
  });
});

describe('groupCreationOpsIntoCells', () => {
  it('Test A — each object without layout_cell gets its own cell in order', () => {
    const ops = [
      textOp('a', 'A'),
      textOp('b', 'B'),
      textOp('c', 'C'),
      textOp('d', 'D'),
      textOp('e', 'E'),
    ];
    const grouped = groupCreationOpsIntoCells(ops);
    expect(grouped.objectOrder).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(grouped.cells).toHaveLength(5);
    expect(grouped.cells.map((c) => c.members.map((m) => m.ref))).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
    ]);
    expect(grouped.chronologicalOrderingValid).toBe(true);
  });

  it('Test B — two objects sharing a cell stay consecutive and grouped', () => {
    const grouped = groupCreationOpsIntoCells([
      textOp('a', 'A', 'cell_1'),
      textOp('b', 'B', 'cell_1'),
      textOp('c', 'C', 'cell_2'),
    ]);
    expect(grouped.cells).toHaveLength(2);
    expect(grouped.cells[0]!.members.map((m) => m.ref)).toEqual(['a', 'b']);
    expect(grouped.cells[1]!.members.map((m) => m.ref)).toEqual(['c']);
  });

  it('Test C — four objects in one cell', () => {
    const grouped = groupCreationOpsIntoCells([
      textOp('a', 'A', 'c'),
      textOp('b', 'B', 'c'),
      textOp('c', 'C', 'c'),
      textOp('d', 'D', 'c'),
    ]);
    expect(grouped.cells).toHaveLength(1);
    expect(grouped.cells[0]!.members).toHaveLength(4);
  });

  it('Test D — more than four objects auto-splits preserving order', () => {
    const grouped = groupCreationOpsIntoCells([
      textOp('a', 'A', 'cell_1'),
      textOp('b', 'B', 'cell_1'),
      textOp('c', 'C', 'cell_1'),
      textOp('d', 'D', 'cell_1'),
      textOp('e', 'E', 'cell_1'),
      textOp('f', 'F', 'cell_1'),
    ]);
    expect(grouped.cells).toHaveLength(2);
    expect(grouped.cells[0]!.members.map((m) => m.ref)).toEqual(['a', 'b', 'c', 'd']);
    expect(grouped.cells[1]!.members.map((m) => m.ref)).toEqual(['e', 'f']);
    expect(grouped.splits).toHaveLength(1);
    expect(grouped.splits[0]!.partSizes).toEqual([4, 2]);
    expect(grouped.cells.every((c) => c.members.length <= MAX_OBJECTS_PER_CELL)).toBe(
      true,
    );
  });

  it('Test E — non-contiguous layout_cell is rejected', () => {
    expect(() =>
      groupCreationOpsIntoCells([
        textOp('a', 'A', 'cell_1'),
        textOp('b', 'B', 'cell_2'),
        textOp('c', 'C', 'cell_1'),
      ]),
    ).toThrow(ChronologicalCellLayoutError);
    expect(() =>
      groupCreationOpsIntoCells([
        textOp('a', 'A', 'cell_1'),
        textOp('b', 'B', 'cell_2'),
        textOp('c', 'C', 'cell_1'),
      ]),
    ).toThrow(/Non-contiguous layout_cell/);
  });
});

describe('chronological_grid integration', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('Test A — basic chronological placement matches creation order', () => {
    const plan = chronologicalPlan([
      textOp('a', 'Introduction'),
      textOp('b', 'Equation note'),
      textOp('c', 'Graph note'),
      textOp('d', 'Example'),
      textOp('e', 'Conclusion'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds).toHaveLength(5);
    expect(result.layoutDebug?.chronologicalCells?.objectOrder).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(result.layoutDebug?.chronologicalCells?.cellCount).toBe(5);
    expect(result.layoutDebug?.chronologicalCells?.chronologicalOrderingValid).toBe(
      true,
    );

    const cols = result.layoutDebug!.columns;
    const items = result.layoutDebug!.items;
    const byRef = Object.fromEntries(items.map((i) => [i.ref, i]));
    const order = ['a', 'b', 'c', 'd', 'e'].map((r) =>
      readingKey(byRef[r]!.row, byRef[r]!.column, cols),
    );
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!).toBeGreaterThanOrEqual(order[i - 1]!);
    }
  });

  it('Test B — two objects in one cell remain separate CanvasElements', () => {
    const plan = chronologicalPlan([
      textOp('intro', 'Electric Fields', 'cell_1'),
      textOp('body', 'Force per unit charge.', 'cell_1'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds).toHaveLength(2);
    const cells = result.layoutDebug!.chronologicalCells!.cells;
    expect(cells).toHaveLength(1);
    expect(cells[0]!.refs).toEqual(['intro', 'body']);

    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(2);
    expect(els.every((e) => e.type === 'text')).toBe(true);
    expect(new Set(els.map((e) => e.id)).size).toBe(2);

    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.body!.localY).toBeGreaterThan(byRef.intro!.localY);
  });

  it('Test C — four stacked objects fit without overlap', () => {
    const plan = chronologicalPlan([
      textOp('a', 'One', 'c'),
      textOp('b', 'Two', 'c'),
      textOp('c', 'Three', 'c'),
      textOp('d', 'Four', 'c'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.collisionFree).toBe(true);
    expect(result.layoutDebug?.chronologicalCells?.cells).toHaveLength(1);
    const items = [...result.layoutDebug!.items].sort(
      (x, y) => x.localY - y.localY,
    );
    for (let i = 1; i < items.length; i++) {
      expect(items[i]!.localY).toBeGreaterThanOrEqual(
        items[i - 1]!.localY + items[i - 1]!.height,
      );
    }
  });

  it('Test D — six objects in one cell split into 4+2', () => {
    const plan = chronologicalPlan([
      textOp('a', 'A', 'cell_1'),
      textOp('b', 'B', 'cell_1'),
      textOp('c', 'C', 'cell_1'),
      textOp('d', 'D', 'cell_1'),
      textOp('e', 'E', 'cell_1'),
      textOp('f', 'F', 'cell_1'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const debug = result.layoutDebug!.chronologicalCells!;
    expect(debug.cellCount).toBe(2);
    expect(debug.splits).toHaveLength(1);
    expect(debug.splits[0]!.partSizes).toEqual([4, 2]);
    expect(debug.cells[0]!.refs).toEqual(['a', 'b', 'c', 'd']);
    expect(debug.cells[1]!.refs).toEqual(['e', 'f']);
    expect(result.createdIds).toHaveLength(6);
  });

  it('Test E — parser rejects non-contiguous layout_cell', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'create_text', ref: 'a', text: 'A', layout_cell: 'cell_1' },
            { type: 'create_text', ref: 'b', text: 'B', layout_cell: 'cell_2' },
            { type: 'create_text', ref: 'c', text: 'C', layout_cell: 'cell_1' },
          ],
          layout: { type: 'chronological_grid', placement: basePlacement },
        }),
        { allowedElementIds: new Set(), elementTypes: new Map() },
      ),
    ).toThrow(/Non-contiguous layout_cell/);
  });

  it('rejects legacy relationship_grid with clear diagnostic', () => {
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
              { ref: 'a', section: 's' },
              { ref: 'b', section: 's' },
            ],
          },
        }),
        { allowedElementIds: new Set(), elementTypes: new Map() },
      ),
    ).toThrow(/no longer supported/);
  });

  it('Test F — mixed text + equation + graph stacked in one cell', () => {
    const plan = chronologicalPlan([
      textOp('t', 'Intro text', 'mix'),
      equationOp('eq', 'E=F/q', 'mix'),
      graphOp('g', 'mix'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds).toHaveLength(3);
    expect(result.layoutDebug?.chronologicalCells?.cells).toHaveLength(1);
    expect(result.layoutDebug?.collisionFree).toBe(true);

    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.eq!.localY).toBeGreaterThanOrEqual(byRef.t!.localY + byRef.t!.height);
    expect(byRef.g!.localY).toBeGreaterThanOrEqual(byRef.eq!.localY + byRef.eq!.height);

    const types = useCanvasStore
      .getState()
      .document.elements.map((e) => e.type)
      .sort();
    expect(types).toEqual(['equation', 'graph', 'text']);
  });

  it('Test G — tall textbox expands cell; equation sits below without overlap', () => {
    const long =
      'Paragraph one elaborates the harmonic oscillator potential in detail.\n\n'.repeat(
        12,
      ) + 'Final remarks about quantisation and boundary conditions.';
    const plan = chronologicalPlan([
      textOp('long', long, 'cell'),
      equationOp('eq', 'E_n=\\hbar\\omega(n+1/2)', 'cell'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const byRef = Object.fromEntries(
      result.layoutDebug!.items.map((i) => [i.ref, i]),
    );
    expect(byRef.long!.height).toBeGreaterThan(120);
    expect(byRef.eq!.localY).toBeGreaterThanOrEqual(
      byRef.long!.localY + byRef.long!.height,
    );
    expect(result.layoutDebug?.collisionFree).toBe(true);
  });

  it('Test H — enough cells wrap into multiple rows under dynamic column limit', () => {
    const ops = Array.from({ length: 9 }, (_, i) => textOp(`t${i}`, `Note ${i}`));
    const plan = chronologicalPlan(ops);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const n = 9;
    const maxCols = maxColumnsForObjectCount(n);
    expect(result.layoutDebug?.maxColumns).toBe(maxCols);
    expect(result.layoutDebug?.columns).toBeLessThanOrEqual(maxCols);
    expect(result.layoutDebug?.rows).toBeGreaterThanOrEqual(3);
    expect(result.layoutDebug?.chronologicalCells?.cellCount).toBe(9);
    expect(result.layoutDebug?.wrapped).toBe(true);
  });

  it('Test I — column-spanning cell wraps rather than reordering', () => {
    const plan = chronologicalPlan([
      textOp('a', 'A'),
      textOp('title', 'Wide title', undefined, 2),
      textOp('b', 'B'),
    ]);
    // Force 2 columns so span-2 title cannot sit beside A.
    const resolved = resolveGridPlan({
      layout: { type: 'chronological_grid', placement: basePlacement, columns: 2 },
      operations: plan.operations,
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
    });
    const byRef = Object.fromEntries(
      resolved.debug.items.map((i) => [i.ref, i]),
    );
    expect(byRef.a!.row).toBe(0);
    expect(byRef.a!.column).toBe(0);
    // Title spans 2 → must start a new row rather than move before A.
    expect(byRef.title!.row).toBeGreaterThanOrEqual(1);
    expect(byRef.title!.column).toBe(0);
    expect(byRef.title!.columnSpan).toBe(2);
    expect(byRef.b!.row).toBeGreaterThanOrEqual(byRef.title!.row);
    const order = resolved.debug.chronologicalCells!.objectOrder;
    expect(order).toEqual(['a', 'title', 'b']);
  });

  it('Test J — generated layout avoids existing canvas obstacles', () => {
    const obstacle: TextElement = {
      id: 'existing_1',
      type: 'text',
      x: 40,
      y: 40,
      width: 400,
      height: 300,
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
    const plan = chronologicalPlan([
      textOp('a', 'New A'),
      textOp('b', 'New B'),
      textOp('c', 'New C'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.collisionFree).toBe(true);
    expect(result.layoutDebug?.obstacleCount).toBeGreaterThan(0);

    const els = useCanvasStore.getState().document.elements;
    const created = els.filter((e) => e.id !== 'existing_1');
    const obsBounds = getElementBounds(obstacle);
    for (const el of created) {
      expect(intersectsWithMargin(getElementBounds(el), [obsBounds], 0)).toBe(false);
    }
  });

  it('Test K — undo removes the arrangement and redo restores it', () => {
    const plan = chronologicalPlan([
      textOp('a', 'A', 'c1'),
      textOp('b', 'B', 'c1'),
      equationOp('eq', 'E=mc^2', 'c2'),
      graphOp('g', 'c2'),
    ]);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(useCanvasStore.getState().document.elements.length).toBeGreaterThanOrEqual(4);
    const ids = [...result.createdIds].sort();

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);

    useCanvasStore.getState().redo();
    const restored = useCanvasStore
      .getState()
      .document.elements.map((e) => e.id)
      .sort();
    expect(restored).toEqual(ids);
  });

  it('Test L — manual move of one object does not reflow others', () => {
    const plan = chronologicalPlan([
      textOp('a', 'A', 'c'),
      textOp('b', 'B', 'c'),
      textOp('c', 'C'),
    ]);
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const before = useCanvasStore
      .getState()
      .document.elements.map((e) => ({ id: e.id, x: e.x, y: e.y }));
    const first = before[0]!;
    useCanvasStore.getState().updateElement(first.id, (el) => ({
      ...el,
      x: el.x + 250,
      y: el.y + 180,
    }));
    const after = useCanvasStore.getState().document.elements;
    const moved = after.find((e) => e.id === first.id)!;
    expect(moved.x).toBe(first.x + 250);
    expect(moved.y).toBe(first.y + 180);
    for (const prev of before.slice(1)) {
      const cur = after.find((e) => e.id === prev.id)!;
      expect(cur.x).toBe(prev.x);
      expect(cur.y).toBe(prev.y);
    }
  });

  it('Test M — High-mode educational sequence follows operation order (not semantic opt)', () => {
    const plan = chronologicalPlan([
      textOp('title', 'Quantum Harmonic Oscillator', 'intro'),
      textOp(
        'intro',
        'The quantum harmonic oscillator is a foundational model for bound states.',
        'intro',
      ),
      equationOp('potential', 'V(x)=\\frac{1}{2}m\\omega^2 x^2', 'potential'),
      textOp('potential_note', 'The potential is quadratic about the equilibrium.', 'potential'),
      graphOp('potential_graph', 'potential'),
      equationOp(
        'schrodinger',
        '-\\frac{\\hbar^2}{2m}\\frac{d^2\\psi}{dx^2}+V(x)\\psi=E\\psi',
        'quantum',
      ),
      textOp('quantisation', 'Energy levels are discrete: E_n = ħω(n + 1/2).', 'quantum'),
      textOp('example', 'Worked example: estimate the ground-state energy scale.', 'apps'),
      textOp('conclusions', 'Important conclusions and common misconceptions.', 'apps'),
    ]);

    const parsed = parseCanvasAgentResponse(JSON.stringify(plan), {
      allowedElementIds: new Set(),
      elementTypes: new Map(),
    });
    expect(parsed.layout?.type).toBe('chronological_grid');

    const result = executeCanvasOperations(parsed, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.chronologicalCells).toBeTruthy();
    expect(result.layoutDebug?.chronologicalCells?.objectOrder).toEqual([
      'title',
      'intro',
      'potential',
      'potential_note',
      'potential_graph',
      'schrodinger',
      'quantisation',
      'example',
      'conclusions',
    ]);
    // No relationship optimiser debug
    expect(
      (result.layoutDebug as { relationshipOptimiser?: unknown }).relationshipOptimiser,
    ).toBeUndefined();

    expect(result.createdIds.length).toBeGreaterThanOrEqual(9);
    expect(result.layoutDebug?.collisionFree).toBe(true);

    const cells = result.layoutDebug!.chronologicalCells!.cells;
    expect(cells.find((c) => c.cellId === 'intro')?.refs).toEqual(['title', 'intro']);
    expect(cells.find((c) => c.cellId === 'potential')?.refs).toEqual([
      'potential',
      'potential_note',
      'potential_graph',
    ]);

    // Reading order of cells follows first-member creation order
    const cellOrder = cells.map((c) => c.cellId);
    expect(cellOrder.indexOf('intro')).toBeLessThan(cellOrder.indexOf('potential'));
    expect(cellOrder.indexOf('potential')).toBeLessThan(cellOrder.indexOf('quantum'));
    expect(cellOrder.indexOf('quantum')).toBeLessThan(cellOrder.indexOf('apps'));
  });

  it('resolveGridPlan debug exposes cell grouping fields', () => {
    const resolved = resolveGridPlan({
      layout: { type: 'chronological_grid', placement: basePlacement },
      operations: [
        textOp('a', 'A', 'c1'),
        textOp('b', 'B', 'c1'),
        textOp('c', 'C'),
      ],
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
    });
    expect(resolved.debug.chronologicalCells?.cellCount).toBe(2);
    expect(resolved.debug.chronologicalCells?.objectCount).toBe(3);
    expect(resolved.debug.chronologicalCells?.maxObjectsPerCell).toBe(4);
    expect(resolved.byRef.size).toBe(3);
  });
});
