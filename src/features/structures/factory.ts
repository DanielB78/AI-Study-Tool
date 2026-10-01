import { createId, now } from '../../utils/ids';
import {
  DEFAULT_STRUCTURE_FIELD_STYLE,
  DEFAULT_STRUCTURE_HEIGHT,
  DEFAULT_STRUCTURE_WIDTH,
  NOTE_STRUCTURE_VERSION,
  type NoteStructure,
  type NoteStructureField,
  type StructureFieldContentType,
  type StructureFieldStyle,
} from './types';

export function createEmptyStructure(name: string): NoteStructure {
  const t = now();
  return {
    id: `structure_${createId()}`,
    name: name.trim() || 'Untitled structure',
    createdAt: t,
    updatedAt: t,
    width: DEFAULT_STRUCTURE_WIDTH,
    height: DEFAULT_STRUCTURE_HEIGHT,
    fields: [],
    version: NOTE_STRUCTURE_VERSION,
  };
}

export function createStructureField(
  partial: Partial<NoteStructureField> & {
    label: string;
    instruction: string;
    contentType?: StructureFieldContentType;
  },
): NoteStructureField {
  return {
    id: partial.id ?? `field_${createId()}`,
    label: partial.label,
    instruction: partial.instruction,
    contentType: partial.contentType ?? 'text',
    required: partial.required ?? true,
    relativeX: partial.relativeX ?? 24,
    relativeY: partial.relativeY ?? 24,
    relativeWidth: partial.relativeWidth ?? 280,
    relativeHeight: partial.relativeHeight ?? 100,
    zIndex: partial.zIndex ?? 0,
    style: { ...DEFAULT_STRUCTURE_FIELD_STYLE, ...(partial.style ?? {}) },
  };
}

/** Seed "Concept Summary" layout used in tests / demos. */
export function createConceptSummaryStructure(): NoteStructure {
  const base = createEmptyStructure('Concept Summary');
  base.description = 'Title, explanation, optional equation and example.';
  base.width = 720;
  base.height = 520;
  const style = (overrides: Partial<StructureFieldStyle> = {}): StructureFieldStyle => ({
    ...DEFAULT_STRUCTURE_FIELD_STYLE,
    ...overrides,
  });
  base.fields = [
    createStructureField({
      id: 'title',
      label: 'Concept title',
      instruction: 'Give a short title naming the concept.',
      contentType: 'text',
      required: true,
      relativeX: 16,
      relativeY: 16,
      relativeWidth: 688,
      relativeHeight: 64,
      zIndex: 0,
      style: style({ fontSize: 22, fontWeight: 'bold' }),
    }),
    createStructureField({
      id: 'explanation',
      label: 'Explanation',
      instruction: 'Explain the central idea clearly in 2–3 sentences.',
      contentType: 'text',
      required: true,
      relativeX: 16,
      relativeY: 96,
      relativeWidth: 688,
      relativeHeight: 180,
      zIndex: 1,
    }),
    createStructureField({
      id: 'equation',
      label: 'Equation',
      instruction:
        'Provide the most important equation associated with the concept, if one is useful.',
      contentType: 'equation',
      required: false,
      relativeX: 16,
      relativeY: 292,
      relativeWidth: 336,
      relativeHeight: 200,
      zIndex: 2,
    }),
    createStructureField({
      id: 'example',
      label: 'Example',
      instruction: 'Give one concise example demonstrating the concept.',
      contentType: 'text',
      required: false,
      relativeX: 368,
      relativeY: 292,
      relativeWidth: 336,
      relativeHeight: 200,
      zIndex: 3,
    }),
  ];
  return base;
}

export function duplicateStructure(structure: NoteStructure): NoteStructure {
  const t = now();
  return {
    ...structuredClone(structure),
    id: `structure_${createId()}`,
    name: `${structure.name} copy`,
    createdAt: t,
    updatedAt: t,
    fields: structure.fields.map((f) => ({
      ...structuredClone(f),
      // Keep field IDs stable within the template copy? Spec: structure ID is identity.
      // Field IDs should remain the same within a duplicated template for instructions,
      // but uniqueness within structure is enough — regenerate to avoid cross-template collision.
      id: `field_${createId()}`,
    })),
  };
}
