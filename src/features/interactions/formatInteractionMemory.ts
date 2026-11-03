/**
 * Format retrieved interaction memories for the LLM prompt.
 */

import type { InteractionView } from './interactionMemoryApi';

export function formatInteractionMemorySection(
  matches: readonly InteractionView[],
): string {
  if (matches.length === 0) {
    return ['INTERACTION MEMORY', '', '(none)'].join('\n');
  }

  const blocks = matches.map((m, index) => {
    const score =
      m.similarity != null ? ` (similarity ${m.similarity.toFixed(3)})` : '';
    const field = m.matched_field ? ` matched via ${m.matched_field}` : '';
    return [
      `${index + 1}.${score}${field}`,
      `Prior request: ${m.user_prompt || '(empty)'}`,
      `What the assistant did: ${m.action_summary || '(none)'}`,
    ].join('\n');
  });

  return [
    'INTERACTION MEMORY',
    '',
    'Weaker than explicit selection. Prior AI turns retrieved by semantic similarity to the current prompt (matching past prompts or action summaries). Historical text is not current board truth.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}
