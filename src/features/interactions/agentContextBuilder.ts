/**
 * AgentContextBuilder — assemble interaction + canvas context for the planner.
 */

import type { RagContext } from '../rag/contextBuilder';
import type { InteractionView } from './interactionMemoryApi';

export interface AgentContext {
  currentUserRequest: string;
  recentInteractions: InteractionView[];
  relevantHistoricalInteractions: InteractionView[];
  canvasContext: RagContext;
  existingElementIds: ReadonlySet<string>;
}

export function formatInteractionBlock(
  interaction: InteractionView,
  existingElementIds: ReadonlySet<string>,
  opts?: { includeSimilarity?: boolean },
): string {
  const lines = [
    `INTERACTION ID: ${interaction.id}`,
    '',
    'USER REQUEST:',
    interaction.user_prompt || '(empty)',
    '',
    'ACTION PERFORMED:',
    interaction.action_summary || '(none)',
    '',
    'AFFECTED ELEMENTS:',
  ];
  const ids = interaction.affected_element_ids.length
    ? interaction.affected_element_ids
    : ['(none)'];
  for (const id of ids) {
    if (id === '(none)') {
      lines.push(id);
      continue;
    }
    const missing = !existingElementIds.has(id);
    lines.push(missing ? `${id} [no longer exists]` : id);
  }
  lines.push('');
  lines.push('TRANSACTION ID:');
  lines.push(interaction.transaction_id);
  if (interaction.status && interaction.status !== 'applied') {
    lines.push('');
    lines.push('STATUS:');
    lines.push(interaction.status);
  }
  if (opts?.includeSimilarity && interaction.similarity != null) {
    lines.push('');
    lines.push('SEMANTIC SIMILARITY:');
    lines.push(interaction.similarity.toFixed(4));
  }
  if (interaction.provenance) {
    lines.push('');
    lines.push('PROVENANCE:');
    lines.push(interaction.provenance);
  }
  return lines.join('\n');
}

export function formatRecentInteractionsSection(
  interactions: readonly InteractionView[],
  existingElementIds: ReadonlySet<string>,
): string {
  if (interactions.length === 0) {
    return ['RECENT INTERACTIONS', '', '(none)'].join('\n');
  }
  const blocks = interactions.map((i) => formatInteractionBlock(i, existingElementIds));
  return [
    'RECENT INTERACTIONS',
    '',
    'Automatically included for pronouns and short references (it / that / the one you just made).',
    '',
    blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
  ].join('\n');
}

export function formatHistoricalInteractionsSection(
  interactions: readonly InteractionView[],
  existingElementIds: ReadonlySet<string>,
): string {
  if (interactions.length === 0) {
    return ['RELEVANT HISTORICAL INTERACTIONS', '', '(none selected)'].join('\n');
  }
  const blocks = interactions.map((i) =>
    formatInteractionBlock(i, existingElementIds, { includeSimilarity: true }),
  );
  return [
    'RELEVANT HISTORICAL INTERACTIONS',
    '',
    'Older AI actions retrieved for relevance. Historical text is not current board truth.',
    '',
    blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
  ].join('\n');
}

export function buildAgentContext(input: {
  userPrompt: string;
  recentInteractions: InteractionView[];
  historicalInteractions: InteractionView[];
  canvasContext: RagContext;
  existingElementIds: Iterable<string>;
}): AgentContext {
  // Deduplicate: recent wins; drop historical duplicates by id.
  const recentIds = new Set(input.recentInteractions.map((i) => i.id));
  const historical = input.historicalInteractions.filter((i) => !recentIds.has(i.id));
  return {
    currentUserRequest: input.userPrompt.trim(),
    recentInteractions: [...input.recentInteractions],
    relevantHistoricalInteractions: historical,
    canvasContext: input.canvasContext,
    existingElementIds: new Set(input.existingElementIds),
  };
}
