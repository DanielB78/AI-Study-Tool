import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { serializeDocument, parseDocument } from '../../../persistence/storage';
import { createTestAiStore } from '../state/aiStore';
import type { AiService } from '../data/aiService';
import { AiRequestError, AI_USER_ERROR_MESSAGE } from '../models/types';
import { createAiTextElement, estimateTextHeight } from '../canvas/createAiTextElement';
import { insertAiTextResponse } from '../canvas/insertAiText';
import {
  preferredAiTextOrigin,
  placeAiTextRect,
  AI_TEXT_DEFAULT_WIDTH,
} from '../canvas/placement';

function mockService(
  impl: AiService['sendPrompt'] = async (prompt) => ({ text: `echo:${prompt}` }),
): AiService {
  return { sendPrompt: vi.fn(impl) };
}

function resetCanvasStore() {
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

describe('aiStore → canvas insert', () => {
  beforeEach(() => {
    resetCanvasStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects empty prompts without calling the service', async () => {
    const service = mockService();
    const store = createTestAiStore(service);
    store.getState().setPrompt('   ');
    await store.getState().sendPrompt();
    expect(service.sendPrompt).not.toHaveBeenCalled();
  });

  it('inserts exactly one TextElement with the returned text on success', async () => {
    const service = mockService(async () => ({
      text: "Gauss's law relates electric flux to enclosed charge.",
    }));
    const insertFn = vi.fn((text: string) => {
      const result = insertAiTextResponse(text, {
        getCamera: () => useCanvasStore.getState().document.camera,
        getElements: () => useCanvasStore.getState().document.elements,
        getStyle: () => useCanvasStore.getState().style,
        nextZIndex: () => useCanvasStore.getState().nextZIndex(),
        addElement: (el, select) => useCanvasStore.getState().addElement(el, select),
        afterInsert: () =>
          useCanvasStore.setState({
            editingTextId: null,
            editingShapeLabelId: null,
            activeTool: 'select',
          }),
        getViewportSize: () => ({ width: 1000, height: 800 }),
      });
      return result;
    });

    const store = createTestAiStore(service, insertFn);
    store.getState().setPrompt("Explain Gauss's law simply");
    await store.getState().sendPrompt();

    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(store.getState().status).toBe('success');
    expect(store.getState().statusMessage).toBe('Added to canvas');
    expect(store.getState().prompt).toBe('');

    const elements = useCanvasStore.getState().document.elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]!.type).toBe('text');
    if (elements[0]!.type === 'text') {
      expect(elements[0]!.text).toContain('electric flux');
      expect(elements[0]!.metadata.createdBy).toBe('ai');
    }
    expect(useCanvasStore.getState().selectedIds).toEqual([elements[0]!.id]);
    expect(useCanvasStore.getState().editingTextId).toBeNull();
  });

  it('does not create an element on AI failure', async () => {
    const service = mockService(async () => {
      throw new AiRequestError(AI_USER_ERROR_MESSAGE, 'network_error');
    });
    const insertFn = vi.fn();
    const store = createTestAiStore(service, insertFn);
    store.getState().setPrompt('hello');
    await store.getState().sendPrompt();

    expect(store.getState().status).toBe('error');
    expect(store.getState().errorMessage).toBe(AI_USER_ERROR_MESSAGE);
    expect(insertFn).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });

  it('does not create an element for empty LLM text', async () => {
    const service = mockService(async () => ({ text: '   ' }));
    const insertFn = vi.fn();
    const store = createTestAiStore(service, insertFn);
    store.getState().setPrompt('hi');
    await store.getState().sendPrompt();

    expect(store.getState().status).toBe('error');
    expect(insertFn).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });
});

describe('createAiTextElement / placement', () => {
  it('creates a text element with stable unique id and wrapped height', () => {
    const long =
      'Paragraph one explains a concept in detail.\n\n' +
      'Paragraph two continues with more explanation that should wrap across lines.';
    const el = createAiTextElement(long, { x: 10, y: 20 }, {
      zIndex: 3,
      style: DEFAULT_STYLE,
      width: AI_TEXT_DEFAULT_WIDTH,
    });
    expect(el.type).toBe('text');
    expect(el.id.length).toBeGreaterThan(4);
    expect(el.width).toBe(AI_TEXT_DEFAULT_WIDTH);
    expect(el.height).toBeGreaterThan(estimateTextHeight('short', AI_TEXT_DEFAULT_WIDTH, DEFAULT_STYLE));
    expect(el.metadata.createdBy).toBe('ai');
    expect(el.backgroundColor).toBeTruthy();
  });

  it('places near the visible viewport centre, not world origin when panned', () => {
    const camera = { x: -2000, y: -1500, zoom: 1 };
    const viewport = { width: 1000, height: 800 };
    const origin = preferredAiTextOrigin(camera, viewport, 360, 120);
    // screen centre ~ (500, ~300) → world = screen - camera
    expect(origin.x).toBeGreaterThan(2000);
    expect(origin.y).toBeGreaterThan(1500);
    expect(Math.abs(origin.x - 100)).toBeGreaterThan(500);
  });

  it('avoids overlapping an existing element when possible', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const viewport = { width: 1000, height: 800 };
    const preferred = preferredAiTextOrigin(camera, viewport, 200, 80);
    const blocker = {
      id: 'blocker',
      type: 'shape' as const,
      x: preferred.x,
      y: preferred.y,
      width: 200,
      height: 80,
      rotation: 0,
      zIndex: 1,
      opacity: 1,
      locked: false,
      createdAt: 0,
      updatedAt: 0,
      metadata: {},
      shapeType: 'rectangle' as const,
      fill: '#fff',
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

    const placed = placeAiTextRect({
      camera,
      viewport,
      elements: [blocker],
      width: 200,
      height: 80,
    });

    const sameSpot = placed.x === blocker.x && placed.y === blocker.y;
    expect(sameSpot).toBe(false);
    expect(
      !(
        placed.x < blocker.x + blocker.width &&
        placed.x + placed.width > blocker.x &&
        placed.y < blocker.y + blocker.height &&
        placed.y + placed.height > blocker.y
      ),
    ).toBe(true);
  });
});

describe('insertAiTextResponse undo / serialize', () => {
  beforeEach(() => {
    resetCanvasStore();
  });

  it('is one undoable history entry and redo restores it', () => {
    const text = 'Faraday related induced EMF to changing flux.';
    const result = insertAiTextResponse(text, {
      getCamera: () => useCanvasStore.getState().document.camera,
      getElements: () => useCanvasStore.getState().document.elements,
      getStyle: () => useCanvasStore.getState().style,
      nextZIndex: () => useCanvasStore.getState().nextZIndex(),
      addElement: (el, select) => useCanvasStore.getState().addElement(el, select),
      getViewportSize: () => ({ width: 1000, height: 800 }),
    });

    expect(result).not.toBeNull();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    const id = result!.element.id;

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    expect(useCanvasStore.getState().document.elements[0]!.id).toBe(id);
  });

  it('serializes and deserializes as a normal text element', () => {
    insertAiTextResponse('Potential is scalar; field is vector.', {
      getCamera: () => ({ x: 100, y: 50, zoom: 1.2 }),
      getElements: () => useCanvasStore.getState().document.elements,
      getStyle: () => useCanvasStore.getState().style,
      nextZIndex: () => useCanvasStore.getState().nextZIndex(),
      addElement: (el, select) => useCanvasStore.getState().addElement(el, select),
      getViewportSize: () => ({ width: 1000, height: 800 }),
    });

    const json = serializeDocument(useCanvasStore.getState().document);
    const parsed = parseDocument(json);
    expect(parsed).not.toBeNull();
    expect(parsed!.elements).toHaveLength(1);
    expect(parsed!.elements[0]!.type).toBe('text');
    if (parsed!.elements[0]!.type === 'text') {
      expect(parsed!.elements[0]!.text).toContain('Potential');
      expect(parsed!.elements[0]!.metadata.createdBy).toBe('ai');
    }
  });

  it('returns null for empty text without calling addElement', () => {
    const addElement = vi.fn();
    const result = insertAiTextResponse('  ', {
      getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
      getElements: () => [],
      getStyle: () => ({ ...DEFAULT_STYLE }),
      nextZIndex: () => 1,
      addElement,
    });
    expect(result).toBeNull();
    expect(addElement).not.toHaveBeenCalled();
  });
});
