/**
 * Format a NoteStructure for inclusion in the LLM prompt (output schema, not knowledge).
 */

import type { NoteStructure, NoteStructureNodeSection } from './types';
import { isNodeSection, isStructureField } from './types';

function formatNodeSection(section: NoteStructureNodeSection): string[] {
  return [
    'NODE SECTION',
    '',
    `FIELD ID: ${section.id}`,
    `LABEL: ${section.label}`,
    `TYPE: node_section`,
    `REQUIRED: ${section.required ? 'true' : 'false'}`,
    `LAYOUT: ${section.layoutMode === 'tree_vertical' ? 'TREE_VERTICAL' : 'TREE_HORIZONTAL'}`,
    `MAX DEPTH: ${section.maxDepth}`,
    `MAX TOTAL NODES: ${section.maxTotalNodes}`,
    ...(section.maxChildrenPerNode != null
      ? [`MAX CHILDREN PER NODE: ${section.maxChildrenPerNode}`]
      : []),
    'INSTRUCTION:',
    section.instruction.trim() || '(none)',
    '',
    'ROOT NODE INSTRUCTION:',
    section.rootTemplate.instruction.trim() || '(none)',
    '',
    'CHILD NODE INSTRUCTION:',
    section.childTemplate.instruction.trim() || '(none)',
    '',
    'OUTPUT for this field:',
    '{ "root": { "content": "...", "children": [ { "content": "...", "children": [] } ] } }',
    '',
    'The application handles all geometry, node IDs, and parent-child connectors.',
    'Do NOT return x/y coordinates. Do NOT emit create_text/create_connector for tree nodes.',
    'GEOMETRY (application-owned — do not change): ' +
      `x=${section.relativeX}, y=${section.relativeY}, ` +
      `w=${section.relativeWidth}, h=${section.relativeHeight}`,
    '--------------------------------',
  ];
}

export function formatNoteStructureForPrompt(structure: NoteStructure): string {
  const lines: string[] = [
    'SELECTED NOTE STRUCTURE',
    '',
    'This defines HOW new content should be organised. It is NOT canvas knowledge.',
    'Do NOT invent geometry or recreate the layout with create_text/create_equation/create_connector.',
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
    if (isNodeSection(field)) {
      lines.push(...formatNodeSection(field));
      continue;
    }
    if (!isStructureField(field)) continue;
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
