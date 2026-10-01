/**
 * Format a NoteStructure for inclusion in the LLM prompt (output schema, not knowledge).
 */

import type { NoteStructure } from './types';

export function formatNoteStructureForPrompt(structure: NoteStructure): string {
  const lines: string[] = [
    'SELECTED NOTE STRUCTURE',
    '',
    'This defines HOW new content should be organised. It is NOT canvas knowledge.',
    'Do NOT invent geometry or recreate the layout with create_text/create_equation.',
    'When generating a new structured note, emit create_structured_note and fill fields.',
    '',
    `Structure ID: ${structure.id}`,
    `Name: ${structure.name}`,
  ];
  if (structure.description?.trim()) {
    lines.push(`Description: ${structure.description.trim()}`);
  }
  lines.push('');
  lines.push('FIELDS');
  lines.push('');

  for (const field of structure.fields) {
    lines.push(`FIELD ID: ${field.id}`);
    lines.push(`LABEL: ${field.label}`);
    lines.push(`TYPE: ${field.contentType}`);
    lines.push(`REQUIRED: ${field.required ? 'true' : 'false'}`);
    lines.push('INSTRUCTION:');
    lines.push(field.instruction.trim() || '(none)');
    lines.push(
      'GEOMETRY (application-owned — do not change): ' +
        `x=${field.relativeX}, y=${field.relativeY}, ` +
        `w=${field.relativeWidth}, h=${field.relativeHeight}`,
    );
    lines.push('--------------------------------');
  }

  return lines.join('\n');
}

export function formatNoStructureSelected(): string {
  return [
    'SELECTED NOTE STRUCTURE',
    '',
    'No Structure',
    '',
    'Use normal canvas operations (create_text, update_text, etc.).',
    'Do not emit create_structured_note.',
  ].join('\n');
}
