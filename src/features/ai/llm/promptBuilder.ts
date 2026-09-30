/**
 * LlmPromptBuilder — builds the COMPLETE text that would be sent to an LLM.
 * Now includes the Canvas Editor Agent instructions + JSON output contract.
 */

import type { RagContext, RagContextElement } from '../../rag/contextBuilder';
import {
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
  CANVAS_EDITOR_SYSTEM_PROMPT,
} from '../agent/prompts/loadAgentPrompt';
import { CANVAS_AGENT_OUTPUT_CONTRACT } from '../agent/operations';

export interface BuiltLlmPrompt {
  /** Original user request (never overwritten by system/context). */
  userPrompt: string;
  systemInstructions: string;
  /** Canvas context section body (without outer USER REQUEST). */
  ragContextSection: string;
  /** Full deterministic prompt ready to paste into ChatGPT. */
  finalLlmPrompt: string;
}

function formatRetrieval(el: RagContextElement): string[] {
  const lines: string[] = [];
  const kinds = [...new Set(el.sources.map((s) => s.type))];
  lines.push('RETRIEVAL:');
  lines.push(kinds.join(' + '));

  if (el.similarity !== null) {
    lines.push('');
    lines.push('SIMILARITY:');
    lines.push(el.similarity.toFixed(4));
  }

  const spatial = el.sources.filter((s) => s.type === 'spatial');
  for (const s of spatial) {
    if (s.type !== 'spatial') continue;
    lines.push('');
    lines.push('SPATIAL ANCHOR:');
    lines.push(s.anchor_element_id);
    lines.push('');
    lines.push('DISTANCE:');
    lines.push(s.distance.toFixed(1));
  }

  const neighbors = el.sources.filter((s) => s.type === 'semantic_neighbor');
  for (const s of neighbors) {
    if (s.type !== 'semantic_neighbor') continue;
    lines.push('');
    lines.push('SEMANTIC NEIGHBOR:');
    lines.push(`root: ${s.root_anchor_element_id}`);
    lines.push(`parent: ${s.parent_element_id}`);
    lines.push(`depth: ${s.depth}`);
    lines.push(`similarity: ${s.similarity.toFixed(4)}`);
  }
  return lines;
}

function formatElementBlock(el: RagContextElement): string {
  const g = el.geometry;
  const parts = [
    'CANVAS ELEMENT',
    '',
    `ID: ${el.element_id}`,
    `TYPE: ${el.element_type}`,
    '',
    'TEXT:',
    el.text || '(empty)',
    '',
    'POSITION:',
    `x: ${g.x}`,
    `y: ${g.y}`,
    `width: ${g.width}`,
    `height: ${g.height}`,
    '',
    ...formatRetrieval(el),
  ];
  return parts.join('\n');
}

/**
 * Format the CANVAS CONTEXT section for the full LLM prompt.
 * Uses full TextElement text already resolved on RagContextElement.
 * Context is USER/data — never merged into trusted system instructions.
 */
export function formatCanvasContextSection(context: RagContext): string {
  if (context.allElements.length === 0) {
    return ['CANVAS CONTEXT', '', '(none selected)'].join('\n');
  }

  const blocks = context.allElements.map((el) => formatElementBlock(el));
  return [
    'CANVAS CONTEXT',
    '',
    'The following elements were retrieved for relevance. IDs are stable.',
    'POSITION values are canvas world coordinates.',
    '',
    blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
  ].join('\n');
}

export interface BuildLlmPromptInput {
  userPrompt: string;
  ragContext: RagContext;
  systemInstructions?: string;
  responseInstructions?: string;
}

/**
 * Build the complete copyable LLM prompt for Manual LLM Mode.
 * Deterministic: same inputs → same string.
 */
export function buildLlmPrompt(input: BuildLlmPromptInput): BuiltLlmPrompt {
  const userPrompt = input.userPrompt.trim();
  const systemInstructions = (
    input.systemInstructions ?? CANVAS_EDITOR_SYSTEM_PROMPT
  ).trim();
  const responseInstructions = (
    input.responseInstructions ?? CANVAS_EDITOR_RESPONSE_INSTRUCTIONS
  ).trim();
  const ragContextSection = formatCanvasContextSection(input.ragContext);

  const finalLlmPrompt = [
    'SYSTEM INSTRUCTIONS',
    '',
    systemInstructions,
    '',
    '='.repeat(50),
    '',
    'OUTPUT CONTRACT',
    '',
    CANVAS_AGENT_OUTPUT_CONTRACT,
    '',
    '='.repeat(50),
    '',
    ragContextSection,
    '',
    '='.repeat(50),
    '',
    'USER REQUEST',
    '',
    userPrompt || '(empty)',
    '',
    '='.repeat(50),
    '',
    'RESPONSE INSTRUCTIONS',
    '',
    responseInstructions,
    '',
  ].join('\n');

  return {
    userPrompt,
    systemInstructions,
    ragContextSection,
    finalLlmPrompt,
  };
}
