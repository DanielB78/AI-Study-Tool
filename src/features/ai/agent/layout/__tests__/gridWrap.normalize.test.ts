import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../../../types/canvas';
import { useCanvasStore } from '../../../../../store/canvasStore';
import { ragSync } from '../../../../rag/ragSync';
import { serializeDocument, parseDocument } from '../../../../../persistence/storage';
import { executeCanvasOperations } from '../../executor';
import { createLiveAgentExecutorTarget } from '../../liveExecutor';
import type { CanvasAgentResponse, GridLayoutSpec } from '../../operations';
import { parseCanvasAgentResponse } from '../../parser';
import {
  maxColumnsForObjectCount,
  normalizeGridLayout,
  reflowGridToMaxColumns,
} from '../gridReflow';
import { resolveGridPlan } from '../resolveGridPlan';
import { GRID_LAYOUT_CONFIG } from '../gridConfig';

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

function textOps(n: number, text = 'Note') {
  return Array.from({ length: n }, (_, i) => ({
    type: 'create_text' as const,
    ref: `t${i}`,
    text: `${text} ${i}`,
    placement: { mode: 'viewport_default' as const },
  }));
}

function singleRowLayout(n: number, columns: number): GridLayoutSpec {
  return {
    type: 'grid',
    columns,
    placement: { mode: 'viewport_default' },
    items: Array.from({ length: n }, (_, i) => ({
      ref: `t${i}`,
      row: 0,
      column: i,
    })),
  };
}

describe('grid row wrapping normalisation', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [1, 1, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [7, 3, 3],
    [9, 3, 3],
    [10, 4, 3],
    [15, 4, 4],
  ] as const)(
    'N=%i → max columns %i, min rows %i for one-cell items',
    (n, maxCols, minRows) => {
      expect(maxColumnsForObjectCount(n)).toBe(maxCols);
      const layout = singleRowLayout(n, n)!;
      const result = normalizeGridLayout(layout);
      expect(result.finalColumns).toBe(maxCols);
      expect(result.wrapped).toBe(n > maxCols || layout.columns > maxCols);
      const rows = Math.max(...result.layout.items.map((i) => i.row)) + 1;
      expect(rows).toBeGreaterThanOrEqual(minRows);
      expect(
        result.layout.items.every((it) => it.column + (it.column_span ?? 1) <= maxCols),
      ).toBe(true);
      // Distinct Y via increasing row indices
      const byRow = new Map<number, string[]>();
      for (const it of result.layout.items) {
        const list = byRow.get(it.row) ?? [];
        list.push(it.ref);
        byRow.set(it.row, list);
      }
      expect(byRow.size).toBe(rows);
    },
  );

  it('Test A — seven elements in one row wrap to 3 columns', () => {
    const plan: CanvasAgentResponse = {
      operations: textOps(7),
      layout: singleRowLayout(7, 7),
    };
    // Parser must accept columns > 4 so reflow can run.
    const parsed = parseCanvasAgentResponse(JSON.stringify(plan), {
      allowedElementIds: new Set(),
      elementTypes: new Map(),
    });
    expect(parsed.layout?.columns).toBe(7);

    const result = executeCanvasOperations(parsed, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.maxColumns).toBe(3);
    expect(result.layoutDebug?.columns).toBe(3);
    expect(result.layoutDebug?.wrapped).toBe(true);
    expect(result.layoutDebug?.wrapReason).toBe('exceeded_max_columns');
    expect(result.layoutDebug?.rows).toBeGreaterThanOrEqual(3);

    const els = useCanvasStore.getState().document.elements.filter((e) => e.type === 'text');
    expect(els).toHaveLength(7);
    const ys = [...new Set(els.map((e) => Math.round(e.y)))].sort((a, b) => a - b);
    expect(ys.length).toBeGreaterThanOrEqual(3);
  });

  it('Test B — four columns for five objects clamps to three', () => {
    const plan: CanvasAgentResponse = {
      operations: textOps(5),
      layout: {
        type: 'grid',
        columns: 4,
        placement: { mode: 'viewport_default' },
        items: textOps(5).map((op, i) => ({
          ref: op.ref!,
          row: Math.floor(i / 4),
          column: i % 4,
        })),
      },
    };
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(maxColumnsForObjectCount(5)).toBe(3);
    expect(result.layoutDebug?.columns).toBeLessThanOrEqual(3);
    expect(result.layoutDebug?.wrapped).toBe(true);
  });

  it('Test C — full-width heading spans allowed columns', () => {
    const result = reflowGridToMaxColumns(
      {
        type: 'grid',
        columns: 5,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'title', row: 0, column: 0, column_span: 5 },
          { ref: 'a', row: 1, column: 0 },
          { ref: 'b', row: 1, column: 1 },
          { ref: 'c', row: 1, column: 2 },
        ],
      },
      3,
    );
    const title = result.layout.items.find((i) => i.ref === 'title')!;
    expect(title.column_span).toBe(3);
    expect(title.column).toBe(0);
    expect(title.row).toBe(0);
    expect(result.finalColumns).toBe(3);
  });

  it('Test D — variable textbox heights push following rows down', () => {
    const plan: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          ref: 'long',
          text: 'Long explanation. '.repeat(40),
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_text',
          ref: 'short',
          text: 'Short',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_text',
          ref: 'below',
          text: 'Below row',
          placement: { mode: 'viewport_default' },
        },
      ],
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'long', row: 0, column: 0 },
          { ref: 'short', row: 0, column: 1 },
          { ref: 'below', row: 1, column: 0, column_span: 2 },
        ],
      },
    };
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const byRef = Object.fromEntries(
      (result.layoutDebug?.items ?? []).map((i) => [i.ref, i]),
    );
    expect(byRef.below!.localY).toBeGreaterThan(
      byRef.long!.localY + byRef.long!.height - 1,
    );
    expect(result.layoutDebug?.rowHeights[0]).toBeGreaterThanOrEqual(byRef.long!.height);
  });

  it('Test E — wide graphs can reduce columns via physical width', () => {
    const plan: CanvasAgentResponse = {
      operations: [0, 1, 2].map((i) => ({
        type: 'create_graph' as const,
        ref: `g${i}`,
        expressions: [
          { expression: 'x', visible: true, domain_min: null, domain_max: null },
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
        placement: { mode: 'viewport_default' as const },
      })),
      layout: {
        type: 'grid',
        columns: 3,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'g0', row: 0, column: 0 },
          { ref: 'g1', row: 0, column: 1 },
          { ref: 'g2', row: 0, column: 2 },
        ],
      },
    };
    // Narrow viewport → physical width reflow.
    const resolved = resolveGridPlan({
      layout: plan.layout!,
      operations: plan.operations,
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [],
      style: DEFAULT_STYLE,
      viewport: { width: 500, height: 800 },
    });
    expect(resolved.debug.columns).toBeLessThanOrEqual(2);
    expect(resolved.debug.wrapped).toBe(true);
    expect(resolved.debug.widthWrapped || resolved.debug.wrapReason === 'physical_width').toBe(
      true,
    );
    expect(resolved.debug.rows).toBeGreaterThanOrEqual(2);
  });

  it('Test F — final grid avoids existing canvas obstacles', () => {
    const blocker = {
      id: 'blocker',
      type: 'shape' as const,
      shapeType: 'rectangle' as const,
      x: 100,
      y: 100,
      width: 800,
      height: 600,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      fill: '#ccc',
      stroke: '#000',
      strokeWidth: 1,
      strokeStyle: 'solid' as const,
      cornerRadius: 0,
      starPoints: 5,
      starInnerRatio: 0.5,
      label: '',
      labelFontSize: 14,
      labelFontFamily: 'Arial',
      labelFontWeight: 'normal' as const,
      labelFontItalic: false,
      labelColor: '#000',
    };
    useCanvasStore.setState((s) => ({
      document: { ...s.document, elements: [blocker] },
    }));

    const plan: CanvasAgentResponse = {
      operations: textOps(4),
      layout: singleRowLayout(4, 4),
    };
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.collisionFree).toBe(true);
    const texts = useCanvasStore.getState().document.elements.filter((e) => e.type === 'text');
    for (const t of texts) {
      const overlap =
        t.x < blocker.x + blocker.width &&
        t.x + t.width > blocker.x &&
        t.y < blocker.y + blocker.height &&
        t.y + t.height > blocker.y;
      expect(overlap).toBe(false);
    }
  });

  it('Test G — mixed elements count as one object each', () => {
    const plan: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          ref: 'a',
          text: 'Text',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_equation',
          ref: 'e',
          latex: 'E=mc^2',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_graph',
          ref: 'g',
          expressions: [
            { expression: 'x**2', visible: true, domain_min: null, domain_max: null },
          ],
          points: [],
          viewport: { x_min: -5, x_max: 5, y_min: -5, y_max: 5 },
          settings: {
            title: null,
            x_axis_label: null,
            y_axis_label: null,
            show_grid: true,
            show_x_axis: true,
            show_y_axis: true,
          },
          placement: { mode: 'viewport_default' },
        },
      ],
      layout: {
        type: 'grid',
        columns: 3,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'a', row: 0, column: 0 },
          { ref: 'e', row: 0, column: 1 },
          { ref: 'g', row: 0, column: 2 },
        ],
      },
    };
    expect(maxColumnsForObjectCount(3)).toBe(2);
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.objectCount).toBe(3);
    expect(result.layoutDebug?.maxColumns).toBe(2);
    expect(result.layoutDebug?.columns).toBeLessThanOrEqual(2);
    expect(result.layoutDebug?.wrapped).toBe(true);
    expect(result.createdIds.length).toBeGreaterThanOrEqual(3);
  });

  it('Test H — atomic undo restores wrapped arrangement', () => {
    const plan: CanvasAgentResponse = {
      operations: textOps(7),
      layout: singleRowLayout(7, 7),
    };
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds).toHaveLength(7);
    expect(useCanvasStore.getState().document.elements).toHaveLength(7);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(7);
  });

  it('Test I — save/reload preserves layout independent of zoom', () => {
    const plan: CanvasAgentResponse = {
      operations: textOps(7),
      layout: singleRowLayout(7, 7),
    };
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const before = useCanvasStore.getState().document.elements.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      w: e.width,
      h: e.height,
    }));
    useCanvasStore.getState().setCamera({ x: -100, y: 50, zoom: 0.4 });
    const json = serializeDocument(useCanvasStore.getState().document);
    const reloaded = parseDocument(json)!;
    for (const snap of before) {
      const el = reloaded.elements.find((e) => e.id === snap.id)!;
      expect(el.x).toBe(snap.x);
      expect(el.y).toBe(snap.y);
      expect(el.width).toBe(snap.w);
      expect(el.height).toBe(snap.h);
    }
  });

  it('combined regression — 9 mixed objects, max columns 3', () => {
    const plan: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          ref: 'heading',
          text: 'Heading',
          rich_text: {
            blocks: [{ type: 'heading', spans: [{ text: 'Heading', style: { bold: true } }] }],
          },
          placement: { mode: 'viewport_default' },
        },
        ...[0, 1, 2].map((i) => ({
          type: 'create_text' as const,
          ref: `ex${i}`,
          text: `Explanation ${i}. `.repeat(8),
          placement: { mode: 'viewport_default' as const },
        })),
        {
          type: 'create_equation',
          ref: 'eq1',
          latex: 'a^2+b^2=c^2',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_equation',
          ref: 'eq2',
          latex: 'E=mc^2',
          placement: { mode: 'viewport_default' },
        },
        ...[0, 1].map((i) => ({
          type: 'create_graph' as const,
          ref: `g${i}`,
          expressions: [
            { expression: 'x', visible: true, domain_min: null, domain_max: null },
          ],
          points: [],
          viewport: { x_min: -5, x_max: 5, y_min: -5, y_max: 5 },
          settings: {
            title: null,
            x_axis_label: null,
            y_axis_label: null,
            show_grid: true,
            show_x_axis: true,
            show_y_axis: true,
          },
          placement: { mode: 'viewport_default' as const },
        })),
        {
          type: 'create_text',
          ref: 'bullets',
          text: 'A\nB\nC',
          rich_text: {
            blocks: [
              { type: 'bullet', spans: [{ text: 'A' }] },
              { type: 'bullet', spans: [{ text: 'B' }] },
              { type: 'bullet', spans: [{ text: 'C' }] },
            ],
          },
          placement: { mode: 'viewport_default' },
        },
      ],
      layout: {
        type: 'grid',
        columns: 9,
        placement: { mode: 'viewport_default' },
        items: [
          'heading',
          'ex0',
          'ex1',
          'ex2',
          'eq1',
          'eq2',
          'g0',
          'g1',
          'bullets',
        ].map((ref, i) => ({ ref, row: 0, column: i })),
      },
    };

    expect(plan.operations).toHaveLength(9);
    expect(maxColumnsForObjectCount(9)).toBe(3);

    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.objectCount).toBe(9);
    expect(result.layoutDebug?.maxColumns).toBe(3);
    expect(result.layoutDebug?.columns).toBeLessThanOrEqual(3);
    expect(result.layoutDebug?.wrapped).toBe(true);
    expect(result.layoutDebug?.rows).toBeGreaterThanOrEqual(3);
    expect(result.layoutDebug?.collisionFree).toBe(true);

    for (const it of result.layoutDebug?.items ?? []) {
      expect(it.column + it.columnSpan).toBeLessThanOrEqual(3);
    }

    // Zoom must not mutate stored geometry / fonts.
    const before = useCanvasStore.getState().document.elements.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      w: e.width,
      h: e.height,
      font: e.type === 'text' ? e.fontSize : null,
    }));
    useCanvasStore.getState().setCamera({ x: 0, y: 0, zoom: 0.35 });
    const after = useCanvasStore.getState().document.elements;
    for (const snap of before) {
      const el = after.find((e) => e.id === snap.id)!;
      expect(el.x).toBe(snap.x);
      expect(el.y).toBe(snap.y);
      expect(el.width).toBe(snap.w);
      expect(el.height).toBe(snap.h);
      if (el.type === 'text') expect(el.fontSize).toBe(snap.font);
    }

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });

  it('reading order preserved when wrapping a sequential row', () => {
    const result = reflowGridToMaxColumns(singleRowLayout(6, 6)!, 3);
    expect(result.layout.items.map((i) => i.ref)).toEqual([
      't0',
      't1',
      't2',
      't3',
      't4',
      't5',
    ]);
    expect(result.layout.items[0]).toMatchObject({ row: 0, column: 0 });
    expect(result.layout.items[3]).toMatchObject({ row: 1, column: 0 });
  });

  it('finalColumns never exceeds GRID max or object-count max', () => {
    for (let n = 1; n <= 20; n++) {
      const max = maxColumnsForObjectCount(n);
      const result = normalizeGridLayout(singleRowLayout(n, Math.max(n, 8))!);
      expect(result.finalColumns).toBeLessThanOrEqual(max);
      expect(result.finalColumns).toBeLessThanOrEqual(GRID_LAYOUT_CONFIG.maxColumns);
    }
  });
});
