/**
 * Client models for the AI chat API.
 *
 * Keep these separate from raw provider JSON so the UI can later consume
 * richer payloads (e.g. `{ text, operations }`) without rewriting widgets.
 */

export type AiStatus = 'idle' | 'typing' | 'loading' | 'success' | 'error';

/** Multimodal image attachment for LLM requests. */
export interface LlmImageAttachment {
  element_id: string;
  /** data: URL or https URL the provider can fetch / decode. */
  data_url: string;
  media_type?: string | null;
}

export interface ChatRequest {
  prompt: string;
  /** Optional trusted system instruction (not shown in the user prompt box). */
  system_instruction?: string | null;
  /** Serialized canvas RAG context (debug / retrieval stage). */
  canvas_context?: string | null;
  /** Multimodal image attachments (separate from prompt text). */
  image_attachments?: LlmImageAttachment[] | null;
}

export interface ChatRequestOptions {
  systemInstruction?: string | null;
  canvasContext?: string | null;
  imageAttachments?: LlmImageAttachment[] | null;
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

/**
 * Client-side capability hint. The authoritative check is on the backend;
 * this flag lets the UI warn before sending when we know the local mock
 * path / env does not support vision.
 */
export function inferClientSupportsImageInput(): boolean {
  const raw = (import.meta.env.VITE_LLM_SUPPORTS_IMAGE_INPUT as string | undefined)
    ?.trim()
    .toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  // Default: assume vision-capable models (gpt-4o family). Backend still enforces.
  return true;
}
