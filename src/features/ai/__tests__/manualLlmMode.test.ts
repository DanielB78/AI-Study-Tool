import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument, DEFAULT_STYLE, type TextElement } from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { createTestAiStore } from '../state/aiStore';
import type { AiService } from '../data/aiService';
import { setLlmExecutionModeOverride } from '../llm/executionMode';
import {
  handleAgentResponse,
  parseAgentResponsePlan,
  CanvasAgentParseError,
} from '../llm/handleLlmResponse';
import { handlePlainTextLlmResponse } from '../llm/legacyPlainText';
import { ragSync } from '../../rag/ragSync';
import { createRagDebugStore } from '../../rag/ragDebugStore';
import type { RetrievedCandidate } from '../../rag/ragRetrieval';
import { buildRagContext } from '../../rag/contextBuilder';
import { buildLlmPrompt } from '../llm/promptBuilder';

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

const parseCtx = {
  allowedElementIds: new Set(['textbox_18']),
  elementTypes: new Map([['textbox_18', 'text']]),
};

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

describe('structured agent paste / apply', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty / invalid JSON without mutating the board', () => {
    expect(() => parseAgentResponsePlan('   ', parseCtx)).toThrow(CanvasAgentParseError);
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
  });

  it('applies create_text as one undoable TextElement', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_text',
          text: 'ChatGPT structured create.',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const result = handleAgentResponse(raw, parseCtx);
    expect(result.execution?.createdIds).toHaveLength(1);
    expect(useCanvasStore.getState().document.elements).toHaveLength(2);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().document.elements).toHaveLength(2);
  });

  it('applyPastedResponse previews then applies validated operations', () => {
    const store = createRagDebugStore();
    store.setState({
      prompt: 'Make the Gauss note shorter.',
      pastedResponse: '   ',
      responseModalOpen: true,
      selectedAnchorIds: ['textbox_18'],
      candidates: [
        {
          element_id: 'textbox_18',
          element_type: 'text',
          score: 0.9,
          matched_chunks: [],
          geometry: { x: 100, y: 100, width: 200, height: 80 },
        },
      ],
    });
    expect(store.getState().applyPastedResponse()).toBe(false);

    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_text',
          target_element_id: 'textbox_18',
          text: 'Gauss short.',
        },
      ],
    });
    store.setState({ pastedResponse: raw });
    expect(store.getState().previewPastedPlan()).toBe(true);
    expect(store.getState().pendingPlan?.[0]).toContain('UPDATE TEXT');
    expect(store.getState().applyPastedResponse()).toBe(true);

    const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'textbox_18');
    expect(el?.type).toBe('text');
    if (el?.type === 'text') expect(el.text).toBe('Gauss short.');
    expect(store.getState().responseModalOpen).toBe(false);
  });

  it('invalid operation list leaves the board unchanged', () => {
    const before = useCanvasStore.getState().document.elements.length;
    expect(() =>
      handleAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'update_text', target_element_id: 'invented', text: 'nope' },
          ],
        }),
        parseCtx,
      ),
    ).toThrow(CanvasAgentParseError);
    expect(useCanvasStore.getState().document.elements).toHaveLength(before);
  });

  it('legacy plain-text handler still creates text for Ask AI automatic mode', () => {
    useCanvasStore.setState({ document: createEmptyDocument() });
    const result = handlePlainTextLlmResponse('Plain Ask AI reply.');
    expect(result).not.toBeNull();
    expect(useCanvasStore.getState().document.elements).toHaveLength(1);
  });

  it('legacy plain-text handler rejects agent JSON payloads', () => {
    useCanvasStore.setState({ document: createEmptyDocument() });
    const result = handlePlainTextLlmResponse(
      '{"operations":[{"type":"create_text","text":"x","placement":{"mode":"viewport_default"}}]}',
    );
    expect(result).toBeNull();
    expect(useCanvasStore.getState().document.elements).toHaveLength(0);
  });
});
