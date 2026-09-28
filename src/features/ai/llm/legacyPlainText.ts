/**
 * Optional legacy plain-text insert — used by Ask AI (no RAG) in automatic mode.
 * Manual RAG paste path requires structured JSON operations.
 */

import { insertAiResponseOntoCanvas } from '../canvas/liveInsert';

export type PlainTextInsertFn = (text: string) => { element: { id: string } } | null;

export function handlePlainTextLlmResponse(
  response: string,
  insertFn: PlainTextInsertFn = insertAiResponseOntoCanvas,
): { element: { id: string }; text: string } | null {
  const text = response.trim();
  if (!text) return null;
  // Reject obvious JSON agent payloads so Ask AI doesn't dump JSON onto the canvas.
  if (text.startsWith('{') && text.includes('"operations"')) {
    return null;
  }
  const inserted = insertFn(text);
  if (!inserted) return null;
  return { element: inserted.element, text };
}
