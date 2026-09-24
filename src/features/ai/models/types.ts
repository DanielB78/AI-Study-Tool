/**
 * Client models for the AI chat API.
 *
 * Keep these separate from raw provider JSON so the UI can later consume
 * richer payloads (e.g. `{ text, operations }`) without rewriting widgets.
 */

export type AiStatus = 'idle' | 'typing' | 'loading' | 'success' | 'error';

export interface ChatRequest {
  prompt: string;
  // Future (not sent in v1):
  // boardId?: string;
  // selectedElementIds?: string[];
  // context?: Record<string, unknown>;
}

export interface ChatResponse {
  text: string;
}

export interface AiErrorPayload {
  code: string;
  message: string;
}

export class AiRequestError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = 'ai_error', status?: number) {
    super(message);
    this.name = 'AiRequestError';
    this.code = code;
    this.status = status;
  }
}

/** Friendly message shown in the UI for any failed request. */
export const AI_USER_ERROR_MESSAGE = 'AI request failed. Please try again.';
