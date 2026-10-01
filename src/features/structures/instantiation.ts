/**
 * NoteStructureInstantiationService — structure + field values → canvas elements.
 * LLM supplies content only; geometry comes from the saved structure + placement origin.
 */

import type { CanvasElement, StyleDefaults } from '../../types/canvas';
import { createAiTextElement } from '../ai/canvas/createAiTextElement';
import { createAiEquationElement } from '../ai/canvas/createAiEquationElement';
import { createId } from '../../utils/ids';
import type { NoteStructure, NoteStructureField } from './types';
import type { StructureFieldValue } from './fieldValues';

export interface StructurePlacementOrigin {
  x: number;
  y: number;
}

export interface InstantiateStructureInput {
  structure: NoteStructure;
  /** fieldId → value; omitted optional fields simply absent */
  fieldValues: ReadonlyMap<string, StructureFieldValue>;
  origin: StructurePlacementOrigin;
  style: StyleDefaults;
  nextZIndex: () => number;
  structureVersion?: number;
}

export interface InstantiateStructureResult {
  structureInstanceId: string;
  elements: CanvasElement[];
  createdFieldIds: string[];
}

function worldRectForField(
  origin: StructurePlacementOrigin,
  field: NoteStructureField,
): { x: number; y: number; width: number; height: number } {
  return {
    x: origin.x + field.relativeX,
    y: origin.y + field.relativeY,
    width: Math.max(24, field.relativeWidth),
    height: Math.max(24, field.relativeHeight),
  };
}

/**
 * Build canvas elements for populated fields. Optional omitted fields create nothing.
 * Does not rearrange remaining fields.
 */
export function instantiateNoteStructure(
  input: InstantiateStructureInput,
): InstantiateStructureResult {
  const structureInstanceId = `instance_${createId()}`;
  const elements: CanvasElement[] = [];
  const createdFieldIds: string[] = [];
  const sorted = [...input.structure.fields].sort(
    (a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id),
  );

  for (const field of sorted) {
    const value = input.fieldValues.get(field.id);
    if (!value) continue;

    const rect = worldRectForField(input.origin, field);
    const meta = {
      structureId: input.structure.id,
      structureInstanceId,
      structureFieldId: field.id,
      structureName: input.structure.name,
      structureVersion: input.structureVersion ?? input.structure.version,
      createdBy: 'ai',
      source: 'agent',
      operation: 'create_structured_note',
    };

    if (field.contentType === 'text' && value.kind === 'text') {
      const zIndex = input.nextZIndex();
      const el = createAiTextElement(value.content, { x: rect.x, y: rect.y }, {
        zIndex,
        style: {
          ...input.style,
          fontSize: field.style.fontSize,
          fontFamily: field.style.fontFamily,
          fontWeight: field.style.fontWeight,
          fontItalic: field.style.fontItalic,
          underline: field.style.underline,
          strikethrough: field.style.strikethrough,
          textColor: field.style.color,
          textAlignment: field.style.alignment,
          lineHeight: field.style.lineHeight,
          textBackgroundColor: field.style.backgroundColor,
          textPadding: field.style.padding,
          textCornerRadius: field.style.cornerRadius,
        },
        width: rect.width,
        metadata: meta,
      });
      el.height = rect.height;
      elements.push(el);
      createdFieldIds.push(field.id);
    } else if (field.contentType === 'equation' && value.kind === 'equation') {
      const zIndex = input.nextZIndex();
      const el = createAiEquationElement(value.latex, { x: rect.x, y: rect.y }, {
        zIndex,
        style: input.style,
        fontSize: field.style.fontSize,
        color: field.style.color,
        metadata: meta,
      });
      // Preserve user-defined structure field bounds (do not auto-grow).
      el.width = rect.width;
      el.height = rect.height;
      elements.push(el);
      createdFieldIds.push(field.id);
    }
  }

  return { structureInstanceId, elements, createdFieldIds };
}

export function structureBoundsSize(structure: NoteStructure): {
  width: number;
  height: number;
} {
  return { width: structure.width, height: structure.height };
}
