/**
 * Typed field values returned by create_structured_note.
 */

import type { HierarchyNode, NodeSectionFieldValue } from './hierarchy';

export type TextFieldValue = {
  kind: 'text';
  content: string;
};

export type EquationFieldValue = {
  kind: 'equation';
  latex: string;
};

export type StructureFieldValue =
  | TextFieldValue
  | EquationFieldValue
  | NodeSectionFieldValue;

/** Wire format from the LLM (discriminated by structure field type). */
export type RawTextFieldPayload = { content: string };
export type RawEquationFieldPayload = { latex: string };
export type RawNodeSectionFieldPayload = { root: HierarchyNode };
export type RawFieldPayload =
  | RawTextFieldPayload
  | RawEquationFieldPayload
  | RawNodeSectionFieldPayload
  | null;

export type { HierarchyNode, NodeSectionFieldValue };
