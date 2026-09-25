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
  DEFAULT_RAG_SYSTEM_INSTRUCTION,
  type RagContext,
} from './contextBuilder';
import { ragRetrievalService, type RetrievedCandidate } from './ragRetrieval';
import {
  canvasElementsAsSpatial,
  findElementsNearAnchors,
  type SpatialHit,
} from './spatialContext';
import { aiService } from '../ai/data/aiService';
import { insertAiResponseOntoCanvas } from '../ai/canvas/liveInsert';
import { useAiStore } from '../ai/state/aiStore';

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
  toggleAnchor: (elementId: string) => void;
  selectTopN: (n: number) => void;
  clearAnchors: () => void;
  retrieve: () => Promise<void>;
  sendWithContext: () => Promise<void>;
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
    lastQueryChunks: 0,
    lastRetrieveMeta: null,

    openPanel: () => set({ open: true }),
    closePanel: () => set({ open: false, previewOpen: false }),
    togglePanel: () => set((s) => ({ open: !s.open, previewOpen: s.open ? false : s.previewOpen })),

    setPrompt: (value) => set({ prompt: value, error: null }),

    setRadius: (value) => set({ radius: Math.max(0, value) }),

    setPreviewOpen: (open) => set({ previewOpen: open }),

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
        // Keep AI chrome in sync for loading UX.
        useAiStore.setState({
          status: 'loading',
          expanded: true,
          errorMessage: null,
          statusMessage: null,
          lastPrompt: prompt,
        });

        const result = await aiService.sendPrompt(prompt, undefined, {
          systemInstruction: DEFAULT_RAG_SYSTEM_INSTRUCTION,
          canvasContext: context.serialized,
        });

        const text = result.text.trim();
        if (!text) {
          set({ sending: false, error: 'Empty AI response.' });
          useAiStore.setState({
            status: 'error',
            errorMessage: 'AI request failed. Please try again.',
          });
          return;
        }

        const inserted = insertAiResponseOntoCanvas(text);
        if (!inserted) {
          set({ sending: false, error: 'Could not insert AI reply on canvas.' });
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
          lastInsertedId: inserted.element.id,
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
