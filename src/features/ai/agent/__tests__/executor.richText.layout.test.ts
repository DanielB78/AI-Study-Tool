import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import type { CanvasAgentResponse } from '../operations';
import { maxColumnsForObjectCount } from '../layout/gridReflow';

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

describe('executeCanvasOperations — rich text + grid wrap', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates formatted textboxes and stores plain extract for RAG', () => {
    const plan: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          ref: 'intro',
          text: '',
          rich_text: {
            blocks: [
              {
                type: 'heading',
                spans: [{ text: 'Electric Fields', style: { bold: true, color: 'blue' } }],
              },
              {
                type: 'bullet',
                spans: [{ text: 'Vector quantity' }],
              },
            ],
          },
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_equation',
          ref: 'eq',
          latex: 'E=mc^2',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_graph',
          ref: 'g',
          expressions: [
            { expression: '1/x**2', visible: true, domain_min: null, domain_max: null },
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
      ],
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'intro', row: 0, column: 0, column_span: 2 },
          { ref: 'eq', row: 1, column: 0 },
          { ref: 'g', row: 1, column: 1 },
        ],
      },
    };

    // Parser normally fills text; simulate that here.
    const intro = plan.operations[0]!;
    if (intro.type === 'create_text') {
      intro.text = 'Electric Fields\nVector quantity';
    }

    expect(maxColumnsForObjectCount(3)).toBe(2);

    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds.length).toBeGreaterThanOrEqual(3);
    expect(result.layoutDebug?.columns).toBe(1);
    expect(result.layoutDebug?.collisionFree).toBe(true);

    const textEl = useCanvasStore
      .getState()
      .document.elements.find((e) => e.type === 'text');
    expect(textEl?.type).toBe('text');
    if (textEl?.type === 'text') {
      expect(textEl.richText?.blocks.length).toBeGreaterThan(0);
      expect(textEl.text).toContain('Electric Fields');
      expect(textEl.text).not.toContain('highlight_color');
    }
  });

  it('reflows when LLM requests too many columns', () => {
    const refs = Array.from({ length: 7 }, (_, i) => `t${i}`);
    const plan: CanvasAgentResponse = {
      operations: refs.map((ref) => ({
        type: 'create_text' as const,
        ref,
        text: `Note ${ref}`,
        placement: { mode: 'viewport_default' as const },
      })),
      layout: {
        type: 'grid',
        columns: 4, // invalid for N=7 (max 3) — engine must reflow
        placement: { mode: 'viewport_default' },
        items: refs.map((ref, i) => ({
          ref,
          row: Math.floor(i / 4),
          column: i % 4,
        })),
      },
    };

    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    // Agent placement ignores multi-column requests and stacks vertically.
    expect(result.layoutDebug?.columns).toBe(1);
    expect(result.layoutDebug?.rows).toBe(7);
    expect(result.createdIds).toHaveLength(7);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });
});
