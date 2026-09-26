/**
 * Shared LLM response handler — used by Automatic API path and Manual paste.
 *
 * Future structured JSON ops can plug in here via a ManualResponseParser
 * without coupling the paste modal to CreateTextElement directly.
 */

import { insertAiResponseOntoCanvas } from '../canvas/liveInsert';

export interface HandleLlmResponseResult {
  element: { id: string };
  text: string;
}

export type LlmResponseInsertFn = (text: string) => { element: { id: string } } | null;

/**
 * Process a plain-text LLM response the same way an API reply would be handled.
 * Returns null if the response is empty / whitespace-only.
 */
export function handleLlmResponse(
  response: string,
  insertFn: LlmResponseInsertFn = insertAiResponseOntoCanvas,
): HandleLlmResponseResult | null {
  const text = response.trim();
  if (!text) return null;
  const inserted = insertFn(text);
  if (!inserted) return null;
  return { element: inserted.element, text };
}
