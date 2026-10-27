/**
 * Typed field values for visual structure instances.
 * LLM supplies content only; geometry/styling come from the template.
 */

import type { AgentRichTextDocument } from '../ai/agent/operations';
import type { HierarchyNode, NodeSectionFieldValue } from './hierarchy';

export type TextFieldValue = {
  kind: 'text';
  content: string;
  /** Optional rich Markdown compile — preferred for generative text slots. */
  richText?: AgentRichTextDocument;
};

export type EquationFieldValue = {
  kind: 'equation';
  latex: string;
};

export type GraphFieldValue = {
  kind: 'graph';
  title: string | null;
  expressions: string[];
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  xLabel: string | null;
  yLabel: string | null;
};

export type StructureFieldValue =
  | TextFieldValue
  | EquationFieldValue
  | GraphFieldValue
  | NodeSectionFieldValue;

/** Wire format from create_structured_note / :::structure compile. */
export type RawTextFieldPayload = {
  content: string;
  rich_text?: AgentRichTextDocument;
};
export type RawEquationFieldPayload = { latex: string };
export type RawGraphFieldPayload = {
  title?: string | null;
  expressions: string[];
  x_min?: number | null;
  x_max?: number | null;
  y_min?: number | null;
  y_max?: number | null;
  x_label?: string | null;
  y_label?: string | null;
};
export type RawNodeSectionFieldPayload = { root: HierarchyNode };
export type RawFieldPayload =
  | RawTextFieldPayload
  | RawEquationFieldPayload
  | RawGraphFieldPayload
  | RawNodeSectionFieldPayload
  | null;

export type { HierarchyNode, NodeSectionFieldValue };
