/**
 * Format a visual structure template for the LLM prompt.
 * Content-first mode: :::structure directives with natural-language slot markers.
 * Legacy ops mode notes are kept brief — structure filling is Markdown-first.
 */

import type { NoteStructure, NoteStructureField } from './types';
import { isNodeSection } from './types';
import {
  directiveLabelFromDescription,
  formatSlotMarkerForPrompt,
} from './slotLabels';
import { generativeSlotsInReadingOrder } from './structureDirective';

function slotTypeHint(field: NoteStructureField): string {
  switch (field.contentType) {
    case 'equation':
      return 'EQUATION — one $$ display-math block';
    case 'graph':
      return 'GRAPH — one :::graph … ::: definition';
    default:
      return 'TEXT — Markdown (paragraphs, lists, tables, inline $math$)';
  }
}

function formatSlotBlock(field: NoteStructureField): string[] {
  const label = directiveLabelFromDescription(field.instruction);
  return [
    `SLOT: ${label}`,
    `TYPE: ${slotTypeHint(field)}`,
    `REQUIRED: ${field.required ? 'true' : 'false'}`,
    `CONTENT DESCRIPTION: ${field.instruction.trim()}`,
    '--------------------------------',
  ];
}

/**
 * Content-first structure specification — no coordinates, colours, or fonts.
 */
export function formatNoteStructureForPrompt(structure: NoteStructure): string {
  const slots = generativeSlotsInReadingOrder(structure);
  const lines: string[] = [
    'SELECTED STRUCTURE TEMPLATE',
    '',
    'This defines HOW new content should be organised. It is NOT canvas knowledge.',
    'The application owns geometry, colours, fonts, and layout of repeated instances.',
    'Fill slots with content only — never invent coordinates, sizes, colours, or fonts.',
    '',
    `Template name: ${structure.name}`,
  ];
  if (structure.description?.trim()) {
    lines.push(`Description: ${structure.description.trim()}`);
  }
  lines.push('');
  lines.push('When this template is selected, wrap each instance in:');
  lines.push('');
  lines.push(`:::structure ${structure.name}`);
  lines.push('');
  for (const field of slots) {
    const marker = formatSlotMarkerForPrompt(field.instruction);
    lines.push(marker);
    if (field.contentType === 'equation') {
      lines.push('$$');
      lines.push('…latex…');
      lines.push('$$');
    } else if (field.contentType === 'graph') {
      lines.push(':::graph');
      lines.push('expression: …');
      lines.push(':::');
    } else {
      lines.push('…markdown content…');
    }
    lines.push(':::');
    lines.push('');
  }
  lines.push(':::endstructure');
  lines.push('');
  lines.push('Repeat the full :::structure … :::endstructure block for each instance.');
  lines.push('Use the exact slot descriptions above as markers — do not invent new labels.');
  lines.push('');
  lines.push('SLOTS (reading order)');
  lines.push('');
  for (const field of slots) {
    lines.push(...formatSlotBlock(field));
  }

  const legacySections = structure.fields.filter(isNodeSection);
  if (legacySections.length > 0) {
    lines.push('');
    lines.push(
      'NOTE: This template also contains legacy node-section regions that are not filled via :::structure. Prefer fixed text/equation/graph slots.',
    );
  }

  return lines.join('\n');
}

export function formatNoStructureSelected(): string {
  return [
    'SELECTED STRUCTURE TEMPLATE',
    '',
    'No Structure',
    '',
    'Write ordinary Markdown educational content (headings, paragraphs, $$ math, :::graph).',
    'Do not emit :::structure blocks.',
  ].join('\n');
}
