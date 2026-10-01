/**
 * Typed field values returned by create_structured_note.
 */

export type TextFieldValue = {
  kind: 'text';
  content: string;
};

export type EquationFieldValue = {
  kind: 'equation';
  latex: string;
};

export type StructureFieldValue = TextFieldValue | EquationFieldValue;

/** Wire format from the LLM (discriminated by structure field type). */
export type RawTextFieldPayload = { content: string };
export type RawEquationFieldPayload = { latex: string };
export type RawFieldPayload = RawTextFieldPayload | RawEquationFieldPayload | null;
