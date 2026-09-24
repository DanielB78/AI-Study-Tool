import { create } from 'zustand';
import { aiService, type AiService } from '../data/aiService';
import {
  AI_USER_ERROR_MESSAGE,
  AiRequestError,
  type AiStatus,
} from '../models/types';
import { insertAiResponseOntoCanvas } from '../canvas/liveInsert';

export type AiInsertFn = (text: string) => { element: { id: string } } | null;

/**
 * AI prompt UI state — editor chrome state, NOT canvas document state.
 * Successful replies are inserted as TextElements via the canvas store.
 */
export interface AiState {
  status: AiStatus;
  expanded: boolean;
  prompt: string;
  lastPrompt: string | null;
  errorMessage: string | null;
  /** Brief non-document status after a successful canvas insert. */
  statusMessage: string | null;
  lastInsertedId: string | null;

  expand: () => void;
  collapse: () => void;
  setPrompt: (value: string) => void;
  setTyping: () => void;
  sendPrompt: () => Promise<void>;
  clearError: () => void;
  clearStatusMessage: () => void;
}

let activeAbort: AbortController | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function clearStatusTimer() {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
}

function createAiStore(
  service: AiService = aiService,
  insertFn: AiInsertFn = insertAiResponseOntoCanvas,
) {
  return create<AiState>((set, get) => ({
    status: 'idle',
    expanded: false,
    prompt: '',
    lastPrompt: null,
    errorMessage: null,
    statusMessage: null,
    lastInsertedId: null,

    expand: () => set({ expanded: true }),

    collapse: () => {
      if (get().status === 'loading') return;
      set({
        expanded: false,
        status: 'idle',
        errorMessage: null,
      });
    },

    setPrompt: (value) => {
      const { status } = get();
      if (status === 'loading') {
        set({ prompt: value, errorMessage: null });
        return;
      }
      set({
        prompt: value,
        status: value.trim() ? 'typing' : 'idle',
        errorMessage: null,
      });
    },

    setTyping: () => {
      if (get().status !== 'loading') {
        set({ status: 'typing', expanded: true });
      }
    },

    sendPrompt: async () => {
      const trimmed = get().prompt.trim();
      if (!trimmed) return;
      if (get().status === 'loading') return;

      activeAbort?.abort();
      activeAbort = new AbortController();
      const signal = activeAbort.signal;
      clearStatusTimer();

      set({
        status: 'loading',
        expanded: true,
        errorMessage: null,
        statusMessage: null,
        lastPrompt: trimmed,
      });

      try {
        const result = await service.sendPrompt(trimmed, signal);
        if (signal.aborted) return;

        const text = result.text.trim();
        if (!text) {
          set({
            status: 'error',
            errorMessage: AI_USER_ERROR_MESSAGE,
            statusMessage: null,
          });
          return;
        }

        const inserted = insertFn(text);
        if (!inserted) {
          set({
            status: 'error',
            errorMessage: AI_USER_ERROR_MESSAGE,
            statusMessage: null,
          });
          return;
        }

        set({
          status: 'success',
          errorMessage: null,
          prompt: '',
          statusMessage: 'Added to canvas',
          lastInsertedId: inserted.element.id,
          expanded: true,
        });

        // Collapse shortly after success so the board stays primary.
        statusTimer = setTimeout(() => {
          const state = get();
          if (state.status === 'loading') return;
          set({
            statusMessage: null,
            expanded: false,
            status: 'idle',
          });
          statusTimer = null;
        }, 1600);
      } catch (err) {
        if (signal.aborted) return;
        const message =
          err instanceof AiRequestError ? err.message : AI_USER_ERROR_MESSAGE;
        set({
          status: 'error',
          errorMessage: message,
          statusMessage: null,
          expanded: true,
        });
      } finally {
        if (activeAbort?.signal === signal) {
          activeAbort = null;
        }
      }
    },

    clearError: () => set({ errorMessage: null, status: 'idle' }),

    clearStatusMessage: () => set({ statusMessage: null }),
  }));
}

export const useAiStore = createAiStore();

/** Test helper: isolated store with mock AI + optional insert fn. */
export function createTestAiStore(service: AiService, insertFn?: AiInsertFn) {
  return createAiStore(
    service,
    insertFn ??
      (() => ({
        element: { id: 'test-inserted' },
      })),
  );
}
