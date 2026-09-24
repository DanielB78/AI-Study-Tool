import { create } from 'zustand';
import { aiService, type AiService } from '../data/aiService';
import {
  AI_USER_ERROR_MESSAGE,
  AiRequestError,
  type AiStatus,
} from '../models/types';

/**
 * AI prompt UI state — editor chrome state, NOT canvas document state.
 *
 * Conversation history is intentionally omitted in v1 (one prompt / one response).
 * A `messages` array can be introduced later without touching CanvasDocument.
 */
export interface AiState {
  status: AiStatus;
  expanded: boolean;
  prompt: string;
  lastPrompt: string | null;
  responseText: string | null;
  errorMessage: string | null;
  responseVisible: boolean;

  expand: () => void;
  collapse: () => void;
  setPrompt: (value: string) => void;
  setTyping: () => void;
  sendPrompt: () => Promise<void>;
  regenerate: () => Promise<void>;
  closeResponse: () => void;
  clearError: () => void;
  copyResponse: () => Promise<boolean>;
}

let activeAbort: AbortController | null = null;

function createAiStore(service: AiService = aiService) {
  return create<AiState>((set, get) => ({
    status: 'idle',
    expanded: false,
    prompt: '',
    lastPrompt: null,
    responseText: null,
    errorMessage: null,
    responseVisible: false,

    expand: () => set({ expanded: true }),

    collapse: () => {
      const { status, responseVisible } = get();
      if (status === 'loading') return;
      if (responseVisible) return;
      set({
        expanded: false,
        status: 'idle',
        errorMessage: null,
      });
    },

    setPrompt: (value) => {
      const { status, responseVisible } = get();
      if (status === 'loading') {
        // Allow editing the draft text without leaving the loading status
        // of the in-flight request (send remains blocked until it finishes).
        set({ prompt: value, errorMessage: null });
        return;
      }
      set({
        prompt: value,
        status: value.trim() ? 'typing' : responseVisible ? 'success' : 'idle',
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

      set({
        status: 'loading',
        expanded: true,
        errorMessage: null,
        lastPrompt: trimmed,
        responseVisible: true,
      });

      try {
        const result = await service.sendPrompt(trimmed, signal);
        if (signal.aborted) return;
        set({
          status: 'success',
          responseText: result.text,
          responseVisible: true,
          errorMessage: null,
          prompt: '',
        });
      } catch (err) {
        if (signal.aborted) return;
        const message =
          err instanceof AiRequestError ? err.message : AI_USER_ERROR_MESSAGE;
        set({
          status: 'error',
          errorMessage: message,
          responseVisible: true,
        });
      } finally {
        if (activeAbort?.signal === signal) {
          activeAbort = null;
        }
      }
    },

    regenerate: async () => {
      const last = get().lastPrompt;
      if (!last || get().status === 'loading') return;
      set({ prompt: last });
      await get().sendPrompt();
    },

    closeResponse: () => {
      if (get().status === 'loading') return;
      set({
        responseVisible: false,
        responseText: null,
        errorMessage: null,
        status: get().prompt.trim() ? 'typing' : 'idle',
      });
    },

    clearError: () => set({ errorMessage: null, status: get().responseText ? 'success' : 'idle' }),

    copyResponse: async () => {
      const text = get().responseText;
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
  }));
}

export const useAiStore = createAiStore();

/** Test helper: build an isolated store with a mock service. */
export function createTestAiStore(service: AiService) {
  return createAiStore(service);
}
