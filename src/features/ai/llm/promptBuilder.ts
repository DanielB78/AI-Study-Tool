/**
 * LlmPromptBuilder — builds the COMPLETE text that would be sent to an LLM.
 *
 * Used by Manual LLM Mode (clipboard → ChatGPT) and kept reusable so Automatic
 * mode can pass the same parts as structured messages later.
 */

import type { RagContext, RagContextElement } from '../../rag/contextBuilder';
import {
  RAG_RESPONSE_INSTRUCTIONS,
  RAG_SYSTEM_INSTRUCTIONS,
} from '../prompts/instructions';

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
  if (el.inclusion === 'both') {
    lines.push('RETRIEVAL:');
    lines.push('semantic + spatial');
  } else {
    lines.push('RETRIEVAL:');
    lines.push(el.inclusion);
  }

  if (el.similarity !== null) {
    lines.push('');
    lines.push('SEMANTIC SIMILARITY:');
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
  return lines;
}

function formatElementBlock(el: RagContextElement, index: number): string {
  const g = el.geometry;
  const parts = [
    `ELEMENT ${index}`,
    '',
    `ID: ${el.element_id}`,
    `TYPE: ${el.element_type}`,
    '',
    ...formatRetrieval(el),
    '',
    'POSITION:',
    `x: ${g.x}`,
    `y: ${g.y}`,
    `width: ${g.width}`,
    `height: ${g.height}`,
    '',
    'TEXT:',
    el.text || '(empty)',
  ];
  return parts.join('\n');
}

/**
 * Format the CANVAS CONTEXT section for the full LLM prompt.
 * Uses full TextElement text already resolved on RagContextElement.
 */
export function formatCanvasContextSection(context: RagContext): string {
  if (context.allElements.length === 0) {
    return ['CANVAS CONTEXT', '', '(none selected)'].join('\n');
  }

  const blocks = context.allElements.map((el, i) => formatElementBlock(el, i + 1));
  return [
    'CANVAS CONTEXT',
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
 * Build the complete copyable LLM prompt.
 * Deterministic: same inputs → same string.
 */
export function buildLlmPrompt(input: BuildLlmPromptInput): BuiltLlmPrompt {
  const userPrompt = input.userPrompt.trim();
  const systemInstructions = (input.systemInstructions ?? RAG_SYSTEM_INSTRUCTIONS).trim();
  const responseInstructions = (
    input.responseInstructions ?? RAG_RESPONSE_INSTRUCTIONS
  ).trim();
  const ragContextSection = formatCanvasContextSection(input.ragContext);

  const finalLlmPrompt = [
    'SYSTEM INSTRUCTIONS',
    '',
    systemInstructions,
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
