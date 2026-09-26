import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE } from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { createTestAiStore } from '../state/aiStore';
import type { AiService } from '../data/aiService';
import { setLlmExecutionModeOverride } from '../llm/executionMode';
import { handleLlmResponse } from '../llm/handleLlmResponse';
import { insertAiTextResponse } from '../canvas/insertAiText';
import { ragSync } from '../../rag/ragSync';
import { createRagDebugStore } from '../../rag/ragDebugStore';
import type { RetrievedCandidate } from '../../rag/ragRetrieval';
import { buildRagContext } from '../../rag/contextBuilder';
import { buildLlmPrompt } from '../llm/promptBuilder';

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

describe('Manual LLM Mode', () => {
  beforeEach(() => {
    resetCanvas();
    setLlmExecutionModeOverride('manual');
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    setLlmExecutionModeOverride(null);
    vi.restoreAllMocks();
  });

  it('Ask AI does not invoke the LLM provider in manual mode', async () => {
    const service: AiService = { sendPrompt: vi.fn(async () => ({ text: 'nope' })) };
    const store = createTestAiStore(service);
    store.getState().setPrompt('Explain Gauss');
    await store.getState().sendPrompt();
    expect(service.sendPrompt).not.toHaveBeenCalled();
    expect(store.getState().errorMessage).toMatch(/Manual LLM Mode/i);
  });

  it('sendWithContext refuses API calls in manual mode', async () => {
    const store = createRagDebugStore();
    store.setState({
      prompt: 'Explain Gauss',
      selectedAnchorIds: ['a'],
      candidates: [
        {
          element_id: 'a',
          element_type: 'text',
          score: 0.9,
          matched_chunks: [],
          geometry: { x: 0, y: 0, width: 10, height: 10 },
        },
      ] satisfies RetrievedCandidate[],
      llmExecutionMode: 'manual',
    });
    await store.getState().sendWithContext();
    expect(store.getState().error).toMatch(/Manual LLM Mode/i);
    expect(store.getState().sending).toBe(false);
  });

  it('changing anchors / radius changes generated prompt', () => {
    const base = buildRagContext({
      query: 'q',
      semanticAnchors: [
        {
          element_id: 'A',
          element_type: 'text',
          similarity: 0.9,
          matched_chunks: [],
          geometry: { x: 0, y: 0, width: 10, height: 10 },
          text: 'alpha',
        },
      ],
      spatialHits: [],
    });
    const p1 = buildLlmPrompt({ userPrompt: 'q', ragContext: base }).finalLlmPrompt;

    const withSpatial = buildRagContext({
      query: 'q',
      semanticAnchors: [
        {
          element_id: 'A',
          element_type: 'text',
          similarity: 0.9,
          matched_chunks: [],
          geometry: { x: 0, y: 0, width: 10, height: 10 },
          text: 'alpha',
        },
      ],
      spatialHits: [
        {
          element_id: 'B',
          element_type: 'text',
          anchor_element_id: 'A',
          distance: 50,
          geometry: { x: 40, y: 0, width: 10, height: 10 },
          text: 'beta nearby',
        },
      ],
    });
    const p2 = buildLlmPrompt({ userPrompt: 'q', ragContext: withSpatial }).finalLlmPrompt;
    expect(p2).not.toBe(p1);
    expect(p2).toContain('beta nearby');
    expect(p1).not.toContain('beta nearby');
  });
});

describe('handleLlmResponse / paste import', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty response', () => {
    expect(handleLlmResponse('   ')).toBeNull();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });

  it('creates one undoable TextElement via shared handler', () => {
    const insertFn = (text: string) =>
      insertAiTextResponse(text, {
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
      });

    const result = handleLlmResponse('ChatGPT answer about Gauss.', insertFn);
    expect(result).not.toBeNull();
    const els = useCanvasStore.getState().document.elements;
    expect(els).toHaveLength(1);
    expect(els[0]?.type).toBe('text');
    if (els[0]?.type === 'text') {
      expect(els[0].text).toBe('ChatGPT answer about Gauss.');
      expect(els[0].id.length).toBeGreaterThan(4);
    }
    expect(useCanvasStore.getState().selectedIds).toEqual([result!.element.id]);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
  });

  it('applyPastedResponse uses the same handler and does not apply empty', () => {
    const store = createRagDebugStore();
    store.setState({ pastedResponse: '   ', responseModalOpen: true });
    expect(store.getState().applyPastedResponse()).toBe(false);
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);

    // Seed a real insert path by applying non-empty text
    store.setState({ pastedResponse: 'Manual paste works.' });
    // handleLlmResponse uses live insert by default — ensure rag mocks already set
    const ok = store.getState().applyPastedResponse();
    expect(ok).toBe(true);
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
    expect(store.getState().responseModalOpen).toBe(false);
  });
});
