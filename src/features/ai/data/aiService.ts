import { AI_API_BASE_URL, AI_REQUEST_TIMEOUT_MS } from '../config';
import {
  AI_USER_ERROR_MESSAGE,
  AiRequestError,
  type ChatRequest,
  type ChatResponse,
} from '../models/types';

export interface AiService {
  sendPrompt(prompt: string, signal?: AbortSignal): Promise<ChatResponse>;
}

function parseErrorBody(data: unknown): { code: string; message: string } | null {
  if (!data || typeof data !== 'object') return null;
  const error = (data as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  if (typeof code !== 'string' || typeof message !== 'string') return null;
  return { code, message };
}

export function createAiService(baseUrl: string = AI_API_BASE_URL): AiService {
  return {
    async sendPrompt(prompt: string, externalSignal?: AbortSignal): Promise<ChatResponse> {
      const trimmed = prompt.trim();
      if (!trimmed) {
        throw new AiRequestError('Prompt cannot be empty.', 'invalid_prompt', 422);
      }

      const controller = new AbortController();
      const timeoutId = globalThis.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort);

      const body: ChatRequest = { prompt: trimmed };

      try {
        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        let data: unknown = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (!res.ok) {
          const parsed = parseErrorBody(data);
          // Prefer a safe generic UI message; keep provider/backend codes for logs.
          console.warn('[ai] request failed', res.status, parsed ?? data);
          throw new AiRequestError(AI_USER_ERROR_MESSAGE, parsed?.code ?? 'http_error', res.status);
        }

        const text = (data as ChatResponse | null)?.text;
        if (typeof text !== 'string' || !text.trim()) {
          throw new AiRequestError(AI_USER_ERROR_MESSAGE, 'invalid_response', res.status);
        }

        return { text: text.trim() };
      } catch (err) {
        if (err instanceof AiRequestError) throw err;
        const isAbort =
          (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
          (err instanceof Error && err.name === 'AbortError');
        if (isAbort) {
          throw new AiRequestError(AI_USER_ERROR_MESSAGE, 'timeout');
        }
        console.warn('[ai] network error', err);
        throw new AiRequestError(AI_USER_ERROR_MESSAGE, 'network_error');
      } finally {
        globalThis.clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    },
  };
}

export const aiService: AiService = createAiService();
