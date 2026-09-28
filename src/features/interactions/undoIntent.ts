/**
 * Narrow direct undo/redo intent detector (mirrors backend).
 * Keep conservative — ambiguous prompts go to the LLM planner.
 */

const UNDO_EXACT = new Set([
  'undo what you just did',
  'undo that',
  'undo your last change',
  'undo the last ai change',
  'undo the last ai action',
  'undo your last ai change',
]);

const REDO_EXACT = new Set([
  'redo that',
  'redo what you just undid',
  'redo your last change',
  'redo the last ai change',
]);

function normalize(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
}

export function detectUndoIntent(prompt: string): 'undo' | 'redo' | null {
  const n = normalize(prompt);
  if (!n) return null;
  if (UNDO_EXACT.has(n)) return 'undo';
  if (REDO_EXACT.has(n)) return 'redo';
  return null;
}
