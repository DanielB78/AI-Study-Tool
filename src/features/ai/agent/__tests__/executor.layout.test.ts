import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { intersectsWithMargin } from '../layout/collision';
import { getElementBounds } from '../../../../utils/coordinates';
import type { CanvasAgentResponse } from '../operations';

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

const gridPlan: CanvasAgentResponse = {
  operations: [
    {
      type: 'create_text',
      ref: 'title',
      text: 'Title',
      placement: { mode: 'viewport_default' },
    },
    {
      type: 'create_text',
      ref: 'body',
      text: 'A longer explanation that wraps across multiple lines for height.',
      placement: { mode: 'viewport_default' },
    },
    {
      type: 'create_graph',
      ref: 'graph',
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
    },
    {
      type: 'create_equation',
      ref: 'eq',
      latex: 'E=mc^2',
      placement: { mode: 'viewport_default' },
    },
  ],
  layout: {
    type: 'grid',
    columns: 2,
    placement: { mode: 'viewport_default' },
    items: [
      { ref: 'title', row: 0, column: 0, column_span: 2 },
      { ref: 'body', row: 1, column: 0 },
      { ref: 'graph', row: 1, column: 1 },
      { ref: 'eq', row: 2, column: 0, column_span: 2 },
    ],
  },
};

describe('executeCanvasOperations — grid layout', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test O — mixed types create without overlaps', () => {
    const result = executeCanvasOperations(gridPlan, createLiveAgentExecutorTarget());
    expect(result.createdIds.length).toBeGreaterThanOrEqual(4);
    expect(result.layoutDebug?.collisionFree).toBe(true);

    const els = useCanvasStore.getState().document.elements;
    const created = els.filter((e) => result.createdIds.includes(e.id));
    for (let i = 0; i < created.length; i++) {
      for (let j = i + 1; j < created.length; j++) {
        expect(
          intersectsWithMargin(
            getElementBounds(created[i]!),
            getElementBounds(created[j]!),
            8,
          ),
        ).toBe(false);
      }
    }
  });

  it('Test K — one undo removes the entire arrangement', () => {
    executeCanvasOperations(gridPlan, createLiveAgentExecutorTarget());
    expect(useCanvasStore.getState().document.elements.length).toBeGreaterThanOrEqual(4);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements.length).toBeGreaterThanOrEqual(4);
  });

  it('Test E/M — obstacle forces group move; failure commits nothing', () => {
    const blocker: TextElement = {
      id: 'blocker',
      type: 'text',
      x: -2000,
      y: -2000,
      width: 8000,
      height: 8000,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      metadata: {},
      text: 'huge',
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
    };
    resetCanvas([blocker]);

    expect(() =>
      executeCanvasOperations(gridPlan, createLiveAgentExecutorTarget()),
    ).toThrow(/collision-free placement|No collision-free/);

    // Atomic: only the pre-existing blocker remains
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    expect(useCanvasStore.getState().document.elements[0]!.id).toBe('blocker');
  });

  it('Test N — after creation, moving one element does not move others', () => {
    const result = executeCanvasOperations(gridPlan, createLiveAgentExecutorTarget());
    const before = useCanvasStore
      .getState()
      .document.elements.filter((e) => result.createdIds.includes(e.id))
      .map((e) => ({ id: e.id, x: e.x, y: e.y }));

    const firstId = result.createdIds[0]!;
    useCanvasStore.getState().updateElement(firstId, (el) => ({
      ...el,
      x: el.x + 500,
      y: el.y + 500,
    }));

    const after = useCanvasStore
      .getState()
      .document.elements.filter((e) => result.createdIds.includes(e.id));

    for (const el of after) {
      const prev = before.find((b) => b.id === el.id)!;
      if (el.id === firstId) {
        expect(el.x).toBe(prev.x + 500);
      } else {
        expect(el.x).toBe(prev.x);
        expect(el.y).toBe(prev.y);
      }
    }
  });
});
