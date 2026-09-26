/**
 * Transient RAG debug UI state — NOT stored in CanvasDocument.
 */

import { create } from 'zustand';
import { useCanvasStore } from '../../store/canvasStore';
import type { CanvasElement, TextElement } from '../../types/canvas';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_SPATIAL_RADIUS_DEFAULT,
} from './config';
import {
  anchorsFromCandidates,
  buildRagContext,
  type RagContext,
} from './contextBuilder';
import { ragRetrievalService, type RetrievedCandidate } from './ragRetrieval';
import {
  canvasElementsAsSpatial,
  findElementsNearAnchors,
  type SpatialHit,
} from './spatialContext';
import { aiService } from '../ai/data/aiService';
import { useAiStore } from '../ai/state/aiStore';
import {
  DEFAULT_LLM_EXECUTION_MODE,
  buildLlmPrompt,
  handleLlmResponse,
  isAutomaticLlmMode,
  isManualLlmMode,
  setLlmExecutionModeOverride,
  type BuiltLlmPrompt,
  type LlmExecutionMode,
} from '../ai/llm';
import { RAG_SYSTEM_INSTRUCTIONS_API } from '../ai/prompts/instructions';

export interface RagDebugState {
  open: boolean;
  prompt: string;
  retrieving: boolean;
  sending: boolean;
  error: string | null;
  statusMessage: string | null;
  candidates: RetrievedCandidate[];
  selectedAnchorIds: string[];
  radius: number;
  previewOpen: boolean;
  llmPromptPreviewOpen: boolean;
  responseModalOpen: boolean;
  pastedResponse: string;
  llmExecutionMode: LlmExecutionMode;
  lastCopiedPrompt: string | null;
  lastBuiltPrompt: BuiltLlmPrompt | null;
  lastQueryChunks: number;
  lastRetrieveMeta: {
    embedding_model: string;
    embedding_provider: string;
    min_similarity: number | null;
  } | null;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPrompt: (value: string) => void;
  setRadius: (value: number) => void;
  setPreviewOpen: (open: boolean) => void;
  setLlmPromptPreviewOpen: (open: boolean) => void;
  setLlmExecutionMode: (mode: LlmExecutionMode) => void;
  toggleAnchor: (elementId: string) => void;
  selectTopN: (n: number) => void;
  clearAnchors: () => void;
  retrieve: () => Promise<void>;
  /** Automatic mode only — never called when Manual LLM Mode is active. */
  sendWithContext: () => Promise<void>;
  buildCurrentLlmPrompt: () => BuiltLlmPrompt | null;
  copyLlmPrompt: () => Promise<boolean>;
  openResponseModal: () => void;
  closeResponseModal: () => void;
  setPastedResponse: (value: string) => void;
  pasteResponseFromClipboard: () => Promise<boolean>;
  applyPastedResponse: () => boolean;
  copyRetrievalDebugData: () => Promise<boolean>;
  clearError: () => void;
}

/** Derive current context from store slices + live canvas (pure enough for UI). */
export function computeDebugContext(
  state: {
    prompt: string;
    candidates: RetrievedCandidate[];
    selectedAnchorIds: string[];
    radius: number;
  },
  canvasElements?: CanvasElement[],
): { context: RagContext; spatialHits: SpatialHit[] } {
  const selected = new Set(state.selectedAnchorIds);
  const docElements =
    canvasElements ?? useCanvasStore.getState().document.elements;
  const anchors = anchorsFromCandidates(state.candidates, selected, (elementId) => {
    const el = docElements.find((e) => e.id === elementId);
    if (!el) return null;
    if (el.type === 'text') {
      return {
        text: el.text,
        type: el.type,
        geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
      };
    }
    if (el.type === 'shape' && el.label) {
      return {
        text: el.label,
        type: el.type,
        geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
      };
    }
    return {
      text: '',
      type: el.type,
      geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  });

  const canvasEls = canvasElementsAsSpatial(docElements);
  const anchorSpatials = anchors.map((a) => ({
    id: a.element_id,
    type: a.element_type,
    x: a.geometry.x,
    y: a.geometry.y,
    width: a.geometry.width,
    height: a.geometry.height,
    text: a.text,
  }));

  const spatialHits =
    anchors.length === 0
      ? []
      : findElementsNearAnchors(anchorSpatials, canvasEls, state.radius);

  const context = buildRagContext({
    query: state.prompt.trim(),
    semanticAnchors: anchors,
    spatialHits,
    maxElements: RAG_MAX_CONTEXT_ELEMENTS,
    maxCharacters: RAG_MAX_CONTEXT_CHARACTERS,
  });

  return { context, spatialHits };
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for environments without clipboard permission.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function createRagDebugStore() {
  return create<RagDebugState>((set, get) => ({
    open: false,
    prompt: '',
    retrieving: false,
    sending: false,
    error: null,
    statusMessage: null,
    candidates: [],
    selectedAnchorIds: [],
    radius: RAG_SPATIAL_RADIUS_DEFAULT,
    previewOpen: false,
    llmPromptPreviewOpen: false,
    responseModalOpen: false,
    pastedResponse: '',
    llmExecutionMode: DEFAULT_LLM_EXECUTION_MODE,
    lastCopiedPrompt: null,
    lastBuiltPrompt: null,
    lastQueryChunks: 0,
    lastRetrieveMeta: null,

    openPanel: () => set({ open: true }),
    closePanel: () =>
      set({
        open: false,
        previewOpen: false,
        llmPromptPreviewOpen: false,
        responseModalOpen: false,
      }),
    togglePanel: () =>
      set((s) => ({
        open: !s.open,
        previewOpen: s.open ? false : s.previewOpen,
        llmPromptPreviewOpen: s.open ? false : s.llmPromptPreviewOpen,
        responseModalOpen: s.open ? false : s.responseModalOpen,
      })),

    setPrompt: (value) => set({ prompt: value, error: null }),

    setRadius: (value) => set({ radius: Math.max(0, value) }),

    setPreviewOpen: (open) => set({ previewOpen: open }),

    setLlmPromptPreviewOpen: (open) => set({ llmPromptPreviewOpen: open }),

    setLlmExecutionMode: (mode) => {
      setLlmExecutionModeOverride(mode);
      set({ llmExecutionMode: mode });
    },

    toggleAnchor: (elementId) => {
      set((s) => {
        const has = s.selectedAnchorIds.includes(elementId);
        return {
          selectedAnchorIds: has
            ? s.selectedAnchorIds.filter((id) => id !== elementId)
            : [...s.selectedAnchorIds, elementId],
        };
      });
    },

    selectTopN: (n) => {
      const { candidates } = get();
      const ids = candidates.slice(0, Math.max(0, n)).map((c) => c.element_id);
      set({ selectedAnchorIds: ids });
    },

    clearAnchors: () => set({ selectedAnchorIds: [] }),

    clearError: () => set({ error: null }),

    buildCurrentLlmPrompt: () => {
      const state = get();
      const prompt = state.prompt.trim();
      if (!prompt || state.selectedAnchorIds.length === 0) return null;
      const { context } = computeDebugContext(state);
      const built = buildLlmPrompt({
        userPrompt: prompt,
        ragContext: context,
      });
      set({ lastBuiltPrompt: built });
      return built;
    },

    copyLlmPrompt: async () => {
      const built = get().buildCurrentLlmPrompt();
      if (!built) {
        set({
          error:
            !get().prompt.trim()
              ? 'Enter a prompt first.'
              : 'Select at least one semantic anchor.',
        });
        return false;
      }
      // Explicit: Manual copy path never invokes an LLM API.
      const ok = await writeClipboard(built.finalLlmPrompt);
      if (!ok) {
        set({ error: 'Could not copy to clipboard.' });
        return false;
      }
      set({
        lastCopiedPrompt: built.finalLlmPrompt,
        statusMessage: 'Prompt copied',
        error: null,
      });
      return true;
    },

    openResponseModal: () => set({ responseModalOpen: true, pastedResponse: '', error: null }),
    closeResponseModal: () => set({ responseModalOpen: false, pastedResponse: '' }),
    setPastedResponse: (value) => set({ pastedResponse: value }),

    pasteResponseFromClipboard: async () => {
      try {
        const text = await navigator.clipboard.readText();
        set({ pastedResponse: text });
        return true;
      } catch {
        set({ error: 'Could not read clipboard — paste with Ctrl+V.' });
        return false;
      }
    },

    applyPastedResponse: () => {
      const text = get().pastedResponse;
      // Do not modify CanvasDocument until Apply — handled here only.
      const result = handleLlmResponse(text);
      if (!result) {
        set({ error: 'Response cannot be empty.' });
        return false;
      }
      set({
        responseModalOpen: false,
        pastedResponse: '',
        statusMessage: 'Response added to canvas',
        error: null,
      });
      useAiStore.setState({
        status: 'success',
        errorMessage: null,
        statusMessage: 'Added to canvas (manual LLM)',
        lastInsertedId: result.element.id,
        lastPrompt: get().prompt.trim() || useAiStore.getState().lastPrompt,
        expanded: true,
      });
      return true;
    },

    copyRetrievalDebugData: async () => {
      const state = get();
      const { context, spatialHits } = computeDebugContext(state);
      const built = state.selectedAnchorIds.length
        ? buildLlmPrompt({ userPrompt: state.prompt.trim(), ragContext: context })
        : null;
      const payload = {
        userPrompt: state.prompt,
        llmExecutionMode: state.llmExecutionMode,
        candidates: state.candidates,
        selectedAnchorIds: state.selectedAnchorIds,
        radius: state.radius,
        spatialHits,
        contextStats: context.stats,
        includedElements: context.allElements.map((e) => ({
          element_id: e.element_id,
          inclusion: e.inclusion,
          similarity: e.similarity,
          nearest_distance: e.nearest_distance,
          sources: e.sources,
        })),
        finalLlmPromptLength: built?.finalLlmPrompt.length ?? 0,
      };
      const ok = await writeClipboard(JSON.stringify(payload, null, 2));
      if (!ok) {
        set({ error: 'Could not copy debug data.' });
        return false;
      }
      set({ statusMessage: 'Retrieval debug data copied', error: null });
      return true;
    },

    retrieve: async () => {
      const prompt = get().prompt.trim();
      if (!prompt) {
        set({ error: 'Enter a prompt to retrieve.' });
        return;
      }
      if (get().retrieving) return;

      set({ retrieving: true, error: null, statusMessage: null });
      try {
        const boardId = useCanvasStore.getState().document.id;
        const result = await ragRetrievalService.retrieve({
          board_id: boardId,
          prompt,
        });
        set({
          candidates: result.candidates,
          selectedAnchorIds: [],
          lastQueryChunks: result.query_chunks,
          lastRetrieveMeta: {
            embedding_model: result.embedding_model,
            embedding_provider: result.embedding_provider,
            min_similarity: result.min_similarity,
          },
          retrieving: false,
          statusMessage: `${result.candidates.length} semantic candidate(s)`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Retrieve failed';
        set({ retrieving: false, error: message, candidates: [], selectedAnchorIds: [] });
      }
    },

    sendWithContext: async () => {
      const state = get();

      // Hard guard: Manual LLM Mode must never hit a paid provider.
      if (isManualLlmMode(state.llmExecutionMode)) {
        set({
          error:
            'Manual LLM Mode is on — use Copy LLM Prompt → ChatGPT → Paste LLM Response (no API call).',
        });
        return;
      }

      if (!isAutomaticLlmMode(state.llmExecutionMode)) {
        set({ error: 'Unknown LLM execution mode.' });
        return;
      }

      const prompt = state.prompt.trim();
      if (!prompt) {
        set({ error: 'Enter a prompt.' });
        return;
      }
      if (state.selectedAnchorIds.length === 0) {
        set({ error: 'Select at least one semantic anchor.' });
        return;
      }
      if (state.sending) return;

      const { context } = computeDebugContext(state);
      set({ sending: true, error: null, statusMessage: null });

      try {
        useAiStore.setState({
          status: 'loading',
          expanded: true,
          errorMessage: null,
          statusMessage: null,
          lastPrompt: prompt,
        });

        const result = await aiService.sendPrompt(prompt, undefined, {
          systemInstruction: RAG_SYSTEM_INSTRUCTIONS_API,
          canvasContext: context.serialized,
        });

        const applied = handleLlmResponse(result.text);
        if (!applied) {
          set({ sending: false, error: 'Empty AI response.' });
          useAiStore.setState({
            status: 'error',
            errorMessage: 'AI request failed. Please try again.',
          });
          return;
        }

        set({
          sending: false,
          statusMessage: `Sent with ${context.stats.total_unique_elements} context element(s)`,
        });
        useAiStore.setState({
          status: 'success',
          errorMessage: null,
          prompt: '',
          statusMessage: 'Added to canvas (RAG context)',
          lastInsertedId: applied.element.id,
          expanded: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Send failed';
        set({ sending: false, error: message });
        useAiStore.setState({
          status: 'error',
          errorMessage: 'AI request failed. Please try again.',
          expanded: true,
        });
      }
    },
  }));
}

export const useRagDebugStore = createRagDebugStore();

/** Ids for canvas overlay — anchors take visual precedence. */
export function getDebugHighlightIds(state: {
  selectedAnchorIds: string[];
  candidates: RetrievedCandidate[];
  radius: number;
  prompt: string;
}): { semanticIds: string[]; spatialIds: string[] } {
  const { context } = computeDebugContext(state);
  const semanticIds = context.semanticAnchors.map((e) => e.element_id);
  const spatialIds = context.spatialElements.map((e) => e.element_id);
  return { semanticIds, spatialIds };
}

export function findTextElement(id: string): TextElement | undefined {
  const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
  return el?.type === 'text' ? el : undefined;
}
