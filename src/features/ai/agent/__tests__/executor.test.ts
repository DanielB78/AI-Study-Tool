import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE, type TextElement } from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import type { AgentExecutorTarget } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';

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
          text: 'Gauss original',
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

describe('executeCanvasOperations', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function target(): AgentExecutorTarget {
    return createLiveAgentExecutorTarget();
  }

  it('create_text creates a TextElement', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_text',
          text: 'New flux note',
          placement: { mode: 'viewport_default' },
        },
      ],
      target(),
    );
    expect(result.createdIds).toHaveLength(1);
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(2);
    const created = els.find((e) => e.id === result.createdIds[0]);
    expect(created?.type).toBe('text');
    if (created?.type === 'text') expect(created.text).toBe('New flux note');
  });

  it('update_text modifies the exact existing element', () => {
    executeCanvasOperations(
      [
        {
          type: 'update_text',
          target_element_id: 'textbox_18',
          text: 'Gauss updated full text',
        },
      ],
      target(),
    );
    const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18');
    expect(el?.type).toBe('text');
    if (el?.type === 'text') expect(el.text).toBe('Gauss updated full text');
    expect(ragSync.indexText).toHaveBeenCalled();
  });

  it('multiple operations are one undo transaction', () => {
    executeCanvasOperations(
      [
        {
          type: 'update_text',
          target_element_id: 'textbox_18',
          text: 'Edited',
        },
        {
          type: 'create_text',
          text: 'Created',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_18',
            relation: 'right_of',
          },
        },
      ],
      target(),
    );
    expect(useCanvasStore.getState().document.elements).toHaveLength(2);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    const el = useCanvasStore.getState().document.elements[0];
    if (el?.type === 'text') expect(el.text).toBe('Gauss original');

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(2);
  });

  it('relative create places near the anchor', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_text',
          text: 'Beside gauss',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_18',
            relation: 'right_of',
          },
        },
      ],
      target(),
    );
    const created = useCanvasStore.getState().document.elements.find(
      (e) => e.id === result.createdIds[0],
    )!;
    const anchor = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(created.x).toBeGreaterThan(anchor.x + anchor.width);
  });
});
