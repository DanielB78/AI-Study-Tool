/**
 * Transient RAG debug UI state — NOT stored in CanvasDocument.
 */

import { create } from 'zustand';
import {
  subscribeHistoryTransactions,
  useCanvasStore,
} from '../../store/canvasStore';
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
  isAutomaticLlmMode,
  isManualLlmMode,
  setLlmExecutionModeOverride,
  type BuiltLlmPrompt,
  type LlmExecutionMode,
} from '../ai/llm';
import {
  applyAgentOperations,
  handleAgentResponse,
  CanvasAgentParseError,
  parseAgentResponsePlan,
} from '../ai/llm/handleLlmResponse';
import type { CanvasAgentResponse } from '../ai/agent/operations';
import { summarizeAiActions } from '../ai/agent/actionSummary';
import { CANVAS_EDITOR_SYSTEM_PROMPT } from '../ai/agent/prompts/loadAgentPrompt';
import {
  INTERACTION_RAG_TOP_K,
  RECENT_INTERACTION_COUNT,
} from '../interactions/config';
import {
  interactionMemoryApi,
  type InteractionView,
} from '../interactions/interactionMemoryApi';
import { detectUndoIntent } from '../interactions/undoIntent';

export interface InteractionRetrieveMeta {
  embedding_model: string | null;
  embedding_provider: string | null;
  recent_count: number;
  top_k: number;
  min_similarity: number | null;
}

export interface RagDebugState {
  open: boolean;
  prompt: string;
  retrieving: boolean;
  retrievingInteractions: boolean;
  sending: boolean;
  error: string | null;
  statusMessage: string | null;
  candidates: RetrievedCandidate[];
  selectedAnchorIds: string[];
  recentInteractions: InteractionView[];
  historicalCandidates: InteractionView[];
  selectedHistoricalIds: string[];
  radius: number;
  previewOpen: boolean;
  llmPromptPreviewOpen: boolean;
  responseModalOpen: boolean;
  pastedResponse: string;
  /** Parsed plan ready for Apply (null until valid JSON is previewed). */
  pendingPlan: string[] | null;
  pendingOperations: CanvasAgentResponse | null;
  parseError: string | null;
  llmExecutionMode: LlmExecutionMode;
  lastCopiedPrompt: string | null;
  lastBuiltPrompt: BuiltLlmPrompt | null;
  lastQueryChunks: number;
  lastRetrieveMeta: {
    embedding_model: string;
    embedding_provider: string;
    min_similarity: number | null;
  } | null;
  lastInteractionRetrieveMeta: InteractionRetrieveMeta | null;

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
  toggleHistorical: (id: string) => void;
  selectTopHistorical: (n: number) => void;
  clearHistorical: () => void;
  retrieve: () => Promise<void>;
  retrieveInteractions: () => Promise<void>;
  /** Automatic mode only — never called when Manual LLM Mode is active. */
  sendWithContext: () => Promise<void>;
  buildCurrentLlmPrompt: () => BuiltLlmPrompt | null;
  copyLlmPrompt: () => Promise<boolean>;
  handleDirectUndoIntent: () => Promise<boolean>;
  openResponseModal: () => void;
  closeResponseModal: () => void;
  setPastedResponse: (value: string) => void;
  previewPastedPlan: () => boolean;
  pasteResponseFromClipboard: () => Promise<boolean>;
  applyPastedResponse: () => boolean;
  copyRetrievalDebugData: () => Promise<boolean>;
  clearError: () => void;
}

function buildParseContextFromState(state: {
  prompt: string;
  candidates: RetrievedCandidate[];
  selectedAnchorIds: string[];
  radius: number;
}) {
  const { context } = computeDebugContext(state);
  const allowedElementIds = new Set(context.allElements.map((e) => e.element_id));
  // Also allow any live text element that appears in context geometry resolution.
  const elementTypes = new Map<string, string>();
  for (const el of useCanvasStore.getState().document.elements) {
    if (allowedElementIds.has(el.id)) {
      elementTypes.set(el.id, el.type);
    }
  }
  return { allowedElementIds, elementTypes, context };
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
        style: {
          text_color: el.color,
          background_color: el.backgroundColor,
          bold: el.fontWeight === 'bold',
          italic: el.fontItalic,
          underline: el.underline,
        },
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

  // Attach live TextElement style for spatial additions (anchors already carry style).
  for (const ctxEl of context.allElements) {
    if (ctxEl.style) continue;
    const live = docElements.find((e) => e.id === ctxEl.element_id);
    if (live?.type === 'text') {
      ctxEl.style = {
        text_color: live.color,
        background_color: live.backgroundColor,
        bold: live.fontWeight === 'bold',
        italic: live.fontItalic,
        underline: live.underline,
      };
    }
  }

  return { context, spatialHits };
}

/** Selected historical interactions in candidate order. */
export function getInteractionContextFromState(state: {
  recentInteractions: InteractionView[];
  historicalCandidates: InteractionView[];
  selectedHistoricalIds: string[];
}): {
  recentInteractions: InteractionView[];
  historicalInteractions: InteractionView[];
} {
  const selected = new Set(state.selectedHistoricalIds);
  const historicalInteractions = state.historicalCandidates.filter((i) =>
    selected.has(i.id),
  );
  return {
    recentInteractions: state.recentInteractions,
    historicalInteractions,
  };
}

function existingElementIdsFromCanvas(): string[] {
  return useCanvasStore.getState().document.elements.map((e) => e.id);
}

function defaultSelectedHistoricalIds(historical: InteractionView[]): string[] {
  // All returned when ≤3, otherwise top 3.
  return historical.slice(0, Math.min(3, historical.length)).map((i) => i.id);
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

function elementPreviewMaps(ids: string[]): {
  stringPreviews: Record<string, string>;
  summaryPreviews: Record<
    string,
    { id: string; text?: string; exists?: boolean }
  >;
} {
  const elements = useCanvasStore.getState().document.elements;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const stringPreviews: Record<string, string> = {};
  const summaryPreviews: Record<
    string,
    { id: string; text?: string; exists?: boolean }
  > = {};
  for (const id of ids) {
    const el = byId.get(id);
    if (el?.type === 'text') {
      stringPreviews[id] = el.text;
      summaryPreviews[id] = { id, text: el.text, exists: true };
    } else if (el) {
      stringPreviews[id] = el.type === 'shape' ? el.label ?? '' : '';
      summaryPreviews[id] = { id, text: stringPreviews[id], exists: true };
    } else {
      summaryPreviews[id] = { id, exists: false };
    }
  }
  return { stringPreviews, summaryPreviews };
}

async function refreshRecentInteractions(): Promise<void> {
  try {
    const boardId = useCanvasStore.getState().document.id;
    const recent = await interactionMemoryApi.listRecent(
      boardId,
      RECENT_INTERACTION_COUNT,
    );
    useRagDebugStore.setState({ recentInteractions: recent });
  } catch (err) {
    console.warn('[interaction-memory] refresh recent failed', err);
  }
}

export function createRagDebugStore() {
  return create<RagDebugState>((set, get) => ({
    open: false,
    prompt: '',
    retrieving: false,
    retrievingInteractions: false,
    sending: false,
    error: null,
    statusMessage: null,
    candidates: [],
    selectedAnchorIds: [],
    recentInteractions: [],
    historicalCandidates: [],
    selectedHistoricalIds: [],
    radius: RAG_SPATIAL_RADIUS_DEFAULT,
    previewOpen: false,
    llmPromptPreviewOpen: false,
    responseModalOpen: false,
    pastedResponse: '',
    pendingPlan: null,
    pendingOperations: null,
    parseError: null,
    llmExecutionMode: DEFAULT_LLM_EXECUTION_MODE,
    lastCopiedPrompt: null,
    lastBuiltPrompt: null,
    lastQueryChunks: 0,
    lastRetrieveMeta: null,
    lastInteractionRetrieveMeta: null,

    openPanel: () => set({ open: true }),
    closePanel: () =>
      set({
        open: false,
        previewOpen: false,
        llmPromptPreviewOpen: false,
        responseModalOpen: false,
        pendingPlan: null,
        pendingOperations: null,
        parseError: null,
      }),
    togglePanel: () =>
      set((s) => ({
        open: !s.open,
        previewOpen: s.open ? false : s.previewOpen,
        llmPromptPreviewOpen: s.open ? false : s.llmPromptPreviewOpen,
        responseModalOpen: s.open ? false : s.responseModalOpen,
        pendingPlan: s.open ? null : s.pendingPlan,
        pendingOperations: s.open ? null : s.pendingOperations,
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

    toggleHistorical: (id) => {
      set((s) => {
        const has = s.selectedHistoricalIds.includes(id);
        return {
          selectedHistoricalIds: has
            ? s.selectedHistoricalIds.filter((x) => x !== id)
            : [...s.selectedHistoricalIds, id],
        };
      });
    },

    selectTopHistorical: (n) => {
      const { historicalCandidates } = get();
      const ids = historicalCandidates
        .slice(0, Math.max(0, n))
        .map((i) => i.id);
      set({ selectedHistoricalIds: ids });
    },

    clearHistorical: () => set({ selectedHistoricalIds: [] }),

    clearError: () => set({ error: null }),

    handleDirectUndoIntent: async () => {
      const intent = detectUndoIntent(get().prompt);
      if (!intent) return false;
      if (intent === 'undo') {
        useCanvasStore.getState().undo();
        set({ statusMessage: 'Undid last change', error: null });
      } else {
        useCanvasStore.getState().redo();
        set({ statusMessage: 'Redid last change', error: null });
      }
      return true;
    },

    buildCurrentLlmPrompt: () => {
      const state = get();
      const prompt = state.prompt.trim();
      if (!prompt || state.selectedAnchorIds.length === 0) return null;
      const { context } = computeDebugContext(state);
      const { recentInteractions, historicalInteractions } =
        getInteractionContextFromState(state);
      const built = buildLlmPrompt({
        userPrompt: prompt,
        ragContext: context,
        recentInteractions,
        historicalInteractions,
        existingElementIds: existingElementIdsFromCanvas(),
      });
      set({ lastBuiltPrompt: built });
      return built;
    },

    copyLlmPrompt: async () => {
      if (await get().handleDirectUndoIntent()) return true;
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

    openResponseModal: () =>
      set({
        responseModalOpen: true,
        pastedResponse: '',
        pendingPlan: null,
        pendingOperations: null,
        parseError: null,
        error: null,
      }),
    closeResponseModal: () =>
      set({
        responseModalOpen: false,
        pastedResponse: '',
        pendingPlan: null,
        pendingOperations: null,
        parseError: null,
      }),
    setPastedResponse: (value) =>
      set({
        pastedResponse: value,
        pendingPlan: null,
        pendingOperations: null,
        parseError: null,
      }),

    previewPastedPlan: () => {
      const state = get();
      try {
        const { allowedElementIds, elementTypes } = buildParseContextFromState(state);
        const parsed = parseAgentResponsePlan(state.pastedResponse, {
          allowedElementIds,
          elementTypes,
        });
        set({
          pendingPlan: parsed.plan,
          pendingOperations: parsed.response,
          parseError: null,
          error: null,
        });
        return true;
      } catch (err) {
        const message =
          err instanceof CanvasAgentParseError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Invalid agent response';
        set({
          pendingPlan: null,
          pendingOperations: null,
          parseError: message,
          error: message,
        });
        return false;
      }
    },

    pasteResponseFromClipboard: async () => {
      try {
        const text = await navigator.clipboard.readText();
        set({
          pastedResponse: text,
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
        });
        return true;
      } catch {
        set({ error: 'Could not read clipboard — paste with Ctrl+V.' });
        return false;
      }
    },

    applyPastedResponse: () => {
      const state = get();
      // Parse if not yet previewed.
      let ops = state.pendingOperations;
      if (!ops) {
        const ok = get().previewPastedPlan();
        if (!ok) return false;
        ops = get().pendingOperations;
      }
      if (!ops || ops.operations.length === 0) {
        set({ error: 'No validated operations to apply.' });
        return false;
      }

      try {
        const result = applyAgentOperations(ops.operations);
        const userPrompt = get().prompt.trim();
        set({
          responseModalOpen: false,
          pastedResponse: '',
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
          statusMessage: `Applied ${ops.operations.length} operation(s)`,
          error: null,
        });
        useAiStore.setState({
          status: 'success',
          errorMessage: null,
          statusMessage: 'AI plan applied to canvas',
          lastInsertedId: result.createdIds[0] ?? result.updatedIds[0] ?? null,
          lastPrompt: userPrompt || useAiStore.getState().lastPrompt,
          expanded: true,
        });

        if (result.transactionId) {
          const { stringPreviews, summaryPreviews } = elementPreviewMaps(
            result.affectedIds,
          );
          const action_summary = summarizeAiActions({
            userPrompt,
            operations: ops.operations,
            elementPreviews: summaryPreviews,
            createdIds: result.createdIds,
          });
          const boardId = useCanvasStore.getState().document.id;
          void interactionMemoryApi
            .record({
              board_id: boardId,
              user_prompt: userPrompt,
              transaction_id: result.transactionId,
              operations: [...ops.operations],
              affected_element_ids: result.affectedIds,
              created_element_ids: result.createdIds,
              updated_element_ids: result.updatedIds,
              element_previews: stringPreviews,
              action_summary,
            })
            .then(() => {
              void refreshRecentInteractions();
            })
            .catch((err) => {
              console.warn('[interaction-memory] record failed', err);
              set({
                statusMessage:
                  'Applied operations, but interaction memory record failed',
              });
            });
        }

        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to apply operations';
        set({ error: message });
        return false;
      }
    },

    copyRetrievalDebugData: async () => {
      const state = get();
      const { context, spatialHits } = computeDebugContext(state);
      const { recentInteractions, historicalInteractions } =
        getInteractionContextFromState(state);
      const built = state.selectedAnchorIds.length
        ? buildLlmPrompt({
            userPrompt: state.prompt.trim(),
            ragContext: context,
            recentInteractions,
            historicalInteractions,
            existingElementIds: existingElementIdsFromCanvas(),
          })
        : null;
      const payload = {
        userPrompt: state.prompt,
        llmExecutionMode: state.llmExecutionMode,
        candidates: state.candidates,
        selectedAnchorIds: state.selectedAnchorIds,
        recentInteractions,
        historicalCandidates: state.historicalCandidates,
        selectedHistoricalIds: state.selectedHistoricalIds,
        historicalInteractions,
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
        interactionRetrieveMeta: state.lastInteractionRetrieveMeta,
      };
      const ok = await writeClipboard(JSON.stringify(payload, null, 2));
      if (!ok) {
        set({ error: 'Could not copy debug data.' });
        return false;
      }
      set({ statusMessage: 'Retrieval debug data copied', error: null });
      return true;
    },

    retrieveInteractions: async () => {
      const prompt = get().prompt.trim();
      if (!prompt) {
        set({
          statusMessage: 'Enter a prompt to retrieve interactions.',
        });
        return;
      }
      if (get().retrievingInteractions) return;

      set({ retrievingInteractions: true });
      try {
        const boardId = useCanvasStore.getState().document.id;
        const result = await interactionMemoryApi.retrieve(boardId, {
          prompt,
          recent_count: RECENT_INTERACTION_COUNT,
          top_k: INTERACTION_RAG_TOP_K,
        });
        set({
          recentInteractions: result.recent,
          historicalCandidates: result.historical,
          selectedHistoricalIds: defaultSelectedHistoricalIds(result.historical),
          lastInteractionRetrieveMeta: {
            embedding_model: result.embedding_model,
            embedding_provider: result.embedding_provider,
            recent_count: result.recent_count,
            top_k: result.top_k,
            min_similarity: result.min_similarity,
          },
          retrievingInteractions: false,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Interaction retrieve failed';
        set({
          retrievingInteractions: false,
          statusMessage: `Interaction memory: ${message}`,
        });
      }
    },

    retrieve: async () => {
      const prompt = get().prompt.trim();
      if (!prompt) {
        set({ error: 'Enter a prompt to retrieve.' });
        return;
      }
      if (get().retrieving) return;

      set({ retrieving: true, error: null, statusMessage: null });

      // Fetch interactions in parallel; soft-fail independently.
      void get().retrieveInteractions();

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

      if (await get().handleDirectUndoIntent()) return;

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
          systemInstruction: CANVAS_EDITOR_SYSTEM_PROMPT,
          canvasContext: context.serialized,
        });

        const allowedElementIds = new Set(context.allElements.map((e) => e.element_id));
        const elementTypes = new Map(
          context.allElements.map((e) => [e.element_id, e.element_type] as const),
        );
        let applied;
        try {
          applied = handleAgentResponse(result.text, { allowedElementIds, elementTypes });
        } catch (err) {
          const message =
            err instanceof CanvasAgentParseError
              ? err.message
              : 'LLM response was not valid canvas operations JSON.';
          set({ sending: false, error: message });
          useAiStore.setState({
            status: 'error',
            errorMessage: message,
          });
          return;
        }

        set({
          sending: false,
          statusMessage: `Applied ${applied.response.operations.length} operation(s)`,
        });
        useAiStore.setState({
          status: 'success',
          errorMessage: null,
          prompt: '',
          statusMessage: 'AI plan applied to canvas',
          lastInsertedId:
            applied.execution?.createdIds[0] ??
            applied.execution?.updatedIds[0] ??
            null,
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

// Keep interaction memory transaction status in sync with editor undo/redo.
subscribeHistoryTransactions((event, txId) => {
  const boardId = useCanvasStore.getState().document.id;
  const status = event === 'undo' ? 'undone' : 'redone';
  void interactionMemoryApi.setTransactionStatus(boardId, txId, status).catch(() => {});
});

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
