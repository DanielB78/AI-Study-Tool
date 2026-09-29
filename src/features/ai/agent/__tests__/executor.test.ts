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
    vi.spyOn(ragSync, 'deleteMany').mockImplementation(() => {});
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

  it('move_text preserves text and size', () => {
    const before = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(before.type).toBe('text');
    const result = executeCanvasOperations(
      [
        {
          type: 'move_text',
          target_element_id: 'textbox_18',
          placement: { mode: 'absolute', x: 400, y: 250 },
        },
      ],
      target(),
    );
    expect(result.movedIds).toEqual(['textbox_18']);
    const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(el.x).toBe(400);
    expect(el.y).toBe(250);
    expect(el.width).toBe(before.width);
    expect(el.height).toBe(before.height);
    if (el.type === 'text' && before.type === 'text') {
      expect(el.text).toBe(before.text);
    }
    expect(ragSync.updateGeometry).toHaveBeenCalled();
  });

  it('resize_text preserves text and position', () => {
    const before = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    const result = executeCanvasOperations(
      [
        {
          type: 'resize_text',
          target_element_id: 'textbox_18',
          width: 360,
          height: 120,
        },
      ],
      target(),
    );
    expect(result.resizedIds).toEqual(['textbox_18']);
    const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(el.x).toBe(before.x);
    expect(el.y).toBe(before.y);
    expect(el.width).toBe(360);
    expect(el.height).toBe(120);
    if (el.type === 'text' && before.type === 'text') {
      expect(el.text).toBe(before.text);
    }
    expect(ragSync.updateGeometry).toHaveBeenCalled();
  });

  it('delete_text removes the element', () => {
    const result = executeCanvasOperations(
      [{ type: 'delete_text', target_element_id: 'textbox_18' }],
      target(),
    );
    expect(result.deletedIds).toEqual(['textbox_18']);
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
    expect(ragSync.deleteMany).toHaveBeenCalled();
  });

  it('update_text_style changes colour and bold without re-index', () => {
    const before = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(before.type).toBe('text');
    vi.mocked(ragSync.indexText).mockClear();
    vi.mocked(ragSync.updateGeometry).mockClear();

    const result = executeCanvasOperations(
      [
        {
          type: 'update_text_style',
          target_element_id: 'textbox_18',
          style: { text_color: '#0000FF', bold: true, underline: true },
        },
      ],
      target(),
    );

    expect(result.styledIds).toEqual(['textbox_18']);
    expect(result.affectedIds).toContain('textbox_18');
    expect(result.updatedIds).toEqual([]);
    const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18')!;
    expect(el.type).toBe('text');
    if (el.type === 'text' && before.type === 'text') {
      expect(el.color).toBe('#0000FF');
      expect(el.fontWeight).toBe('bold');
      expect(el.underline).toBe(true);
      expect(el.strikethrough).toBe(before.strikethrough);
      expect(el.text).toBe(before.text);
      expect(el.x).toBe(before.x);
      expect(el.y).toBe(before.y);
      expect(el.width).toBe(before.width);
      expect(el.height).toBe(before.height);
    }
    expect(ragSync.indexText).not.toHaveBeenCalled();
    expect(ragSync.updateGeometry).not.toHaveBeenCalled();
  });

  it('create_text with style applies initial styling', () => {
    const result = executeCanvasOperations(
      [
        {
          type: 'create_text',
          text: 'Styled create',
          placement: { mode: 'viewport_default' },
          style: { italic: true, background_color: '#FFFF00', text_color: '#8B0000' },
        },
      ],
      target(),
    );
    const created = useCanvasStore.getState().document.elements.find(
      (e) => e.id === result.createdIds[0],
    )!;
    expect(created.type).toBe('text');
    if (created.type === 'text') {
      expect(created.fontItalic).toBe(true);
      expect(created.backgroundColor).toBe('#FFFF00');
      expect(created.color).toBe('#8B0000');
      expect(created.text).toBe('Styled create');
    }
  });

  it('move + delete are one undo transaction', () => {
    // Seed a second element as move anchor
    useCanvasStore.getState().addElement(
      {
        id: 'textbox_42',
        type: 'text',
        x: 400,
        y: 100,
        width: 200,
        height: 80,
        rotation: 0,
        zIndex: 2,
        opacity: 1,
        locked: false,
        createdAt: 2,
        updatedAt: 2,
        metadata: {},
        text: 'Anchor',
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
      false,
    );

    executeCanvasOperations(
      [
        {
          type: 'move_text',
          target_element_id: 'textbox_18',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_42',
            relation: 'below',
          },
        },
        { type: 'delete_text', target_element_id: 'textbox_42' },
      ],
      target(),
    );

    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    expect(
      useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_42'),
    ).toBeUndefined();

    useCanvasStore.getState().undo();
    const afterUndo = useCanvasStore.getState().document.elements;
    expect(afterUndo).toHaveLength(2);
    const restored = afterUndo.find((e) => e.id === 'textbox_18')!;
    expect(restored.x).toBe(100);
    expect(restored.y).toBe(100);
  });
});
