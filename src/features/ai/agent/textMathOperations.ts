/**
 * AI operations for Inline / Display math inside TextElement rich text.
 */

import type { TextElement } from '../../../types/canvas';
import {
  convertTextMathInElement,
  insertDisplayMathInElement,
  insertInlineMathInElement,
  removeTextMathFromElement,
  updateTextMathInElement,
  type MathInsertAnchor,
  TextMathError,
} from '../../text/textMath';
import { measureTextElementWithFeatures } from '../../text/textAutoSizer';
import { CanvasAgentParseError } from './parseErrors';

export type InsertInlineMathOperation = {
  type: 'insert_inline_math';
  target_element_id: string;
  latex: string;
  after_text?: string;
  before_text?: string;
  after_block_id?: string;
  before_block_id?: string;
  block_id?: string;
  occurrence?: number;
};

export type InsertDisplayMathOperation = {
  type: 'insert_display_math';
  target_element_id: string;
  latex: string;
  after_text?: string;
  before_text?: string;
  after_block_id?: string;
  before_block_id?: string;
  block_id?: string;
  occurrence?: number;
};

export type UpdateTextMathOperation = {
  type: 'update_text_math';
  target_element_id: string;
  math_id: string;
  latex: string;
};

export type RemoveTextMathOperation = {
  type: 'remove_text_math';
  target_element_id: string;
  math_id: string;
};

export type ConvertTextMathOperation = {
  type: 'convert_text_math';
  target_element_id: string;
  math_id: string;
  to: 'inline' | 'display';
};

export type TextMathOperation =
  | InsertInlineMathOperation
  | InsertDisplayMathOperation
  | UpdateTextMathOperation
  | RemoveTextMathOperation
  | ConvertTextMathOperation;

export const TEXT_MATH_OPERATION_TYPES = [
  'insert_inline_math',
  'insert_display_math',
  'update_text_math',
  'remove_text_math',
  'convert_text_math',
] as const;

export function isTextMathOperationType(
  t: string,
): t is TextMathOperation['type'] {
  return (TEXT_MATH_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireTarget(raw: Record<string, unknown>): string {
  const id = raw.target_element_id ?? raw.target_id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new CanvasAgentParseError(
      'missing_target',
      'Text math operation needs target_element_id.',
    );
  }
  return id.trim();
}

function requireLatex(raw: Record<string, unknown>, path: string): string {
  if (typeof raw.latex !== 'string' || !raw.latex.trim()) {
    throw new CanvasAgentParseError('empty_text', `${path} needs non-empty latex.`);
  }
  return raw.latex.trim();
}

function parseInsertAnchor(raw: Record<string, unknown>, path: string): MathInsertAnchor {
  const after_block_id =
    typeof raw.after_block_id === 'string' && raw.after_block_id.trim()
      ? raw.after_block_id.trim()
      : undefined;
  const before_block_id =
    typeof raw.before_block_id === 'string' && raw.before_block_id.trim()
      ? raw.before_block_id.trim()
      : undefined;
  const after_text =
    typeof raw.after_text === 'string' && raw.after_text.length > 0
      ? raw.after_text
      : undefined;
  const before_text =
    typeof raw.before_text === 'string' && raw.before_text.length > 0
      ? raw.before_text
      : undefined;
  const block_id =
    typeof raw.block_id === 'string' && raw.block_id.trim()
      ? raw.block_id.trim()
      : undefined;
  let occurrence: number | undefined;
  if (raw.occurrence !== undefined) {
    if (
      typeof raw.occurrence !== 'number' ||
      !Number.isInteger(raw.occurrence) ||
      raw.occurrence < 0
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `${path}.occurrence must be a non-negative integer.`,
      );
    }
    occurrence = raw.occurrence;
  }

  const count = [after_block_id, before_block_id, after_text, before_text].filter(
    Boolean,
  ).length;
  if (count === 0) {
    return { at_end: true };
  }
  if (count > 1) {
    throw new CanvasAgentParseError(
      'schema',
      `${path} accepts only one of after_block_id, before_block_id, after_text, before_text.`,
    );
  }
  if (after_block_id) return { after_block_id };
  if (before_block_id) return { before_block_id };
  if (after_text) {
    return {
      after_text,
      ...(block_id ? { block_id } : {}),
      ...(occurrence !== undefined ? { occurrence } : {}),
    };
  }
  return {
    before_text: before_text!,
    ...(block_id ? { block_id } : {}),
    ...(occurrence !== undefined ? { occurrence } : {}),
  };
}

export function parseTextMathOperation(raw: Record<string, unknown>): TextMathOperation {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !isTextMathOperationType(raw.type)) {
    throw new CanvasAgentParseError('schema', 'Unknown text math operation.');
  }
  const target_element_id = requireTarget(raw);

  switch (raw.type) {
    case 'insert_inline_math': {
      const latex = requireLatex(raw, 'insert_inline_math');
      const anchor = parseInsertAnchor(raw, 'insert_inline_math');
      return {
        type: 'insert_inline_math',
        target_element_id,
        latex,
        ...anchorFields(anchor),
      };
    }
    case 'insert_display_math': {
      const latex = requireLatex(raw, 'insert_display_math');
      const anchor = parseInsertAnchor(raw, 'insert_display_math');
      return {
        type: 'insert_display_math',
        target_element_id,
        latex,
        ...anchorFields(anchor),
      };
    }
    case 'update_text_math': {
      if (typeof raw.math_id !== 'string' || !raw.math_id.trim()) {
        throw new CanvasAgentParseError('schema', 'update_text_math needs math_id.');
      }
      return {
        type: 'update_text_math',
        target_element_id,
        math_id: raw.math_id.trim(),
        latex: requireLatex(raw, 'update_text_math'),
      };
    }
    case 'remove_text_math': {
      if (typeof raw.math_id !== 'string' || !raw.math_id.trim()) {
        throw new CanvasAgentParseError('schema', 'remove_text_math needs math_id.');
      }
      return {
        type: 'remove_text_math',
        target_element_id,
        math_id: raw.math_id.trim(),
      };
    }
    case 'convert_text_math': {
      if (typeof raw.math_id !== 'string' || !raw.math_id.trim()) {
        throw new CanvasAgentParseError('schema', 'convert_text_math needs math_id.');
      }
      if (raw.to !== 'inline' && raw.to !== 'display') {
        throw new CanvasAgentParseError(
          'schema',
          'convert_text_math.to must be "inline" or "display".',
        );
      }
      return {
        type: 'convert_text_math',
        target_element_id,
        math_id: raw.math_id.trim(),
        to: raw.to,
      };
    }
  }
}

function anchorFields(anchor: MathInsertAnchor): Partial<InsertInlineMathOperation> {
  if ('after_block_id' in anchor) return { after_block_id: anchor.after_block_id };
  if ('before_block_id' in anchor) return { before_block_id: anchor.before_block_id };
  if ('after_text' in anchor) {
    return {
      after_text: anchor.after_text,
      ...(anchor.block_id ? { block_id: anchor.block_id } : {}),
      ...(anchor.occurrence !== undefined ? { occurrence: anchor.occurrence } : {}),
    };
  }
  if ('before_text' in anchor) {
    return {
      before_text: anchor.before_text,
      ...(anchor.block_id ? { block_id: anchor.block_id } : {}),
      ...(anchor.occurrence !== undefined ? { occurrence: anchor.occurrence } : {}),
    };
  }
  return {};
}

function toAnchor(op: InsertInlineMathOperation | InsertDisplayMathOperation): MathInsertAnchor {
  if (op.after_block_id) return { after_block_id: op.after_block_id };
  if (op.before_block_id) return { before_block_id: op.before_block_id };
  if (op.after_text !== undefined) {
    return {
      after_text: op.after_text,
      ...(op.block_id ? { block_id: op.block_id } : {}),
      ...(op.occurrence !== undefined ? { occurrence: op.occurrence } : {}),
    };
  }
  if (op.before_text !== undefined) {
    return {
      before_text: op.before_text,
      ...(op.block_id ? { block_id: op.block_id } : {}),
      ...(op.occurrence !== undefined ? { occurrence: op.occurrence } : {}),
    };
  }
  return { at_end: true };
}

function remeasure(el: TextElement): TextElement {
  const measured = measureTextElementWithFeatures(el, el.width);
  return { ...el, height: measured.height };
}

export function applyTextMathOperation(
  el: TextElement,
  op: TextMathOperation,
): TextElement {
  try {
    let next: TextElement;
    switch (op.type) {
      case 'insert_inline_math':
        next = insertInlineMathInElement(el, op.latex, toAnchor(op));
        break;
      case 'insert_display_math':
        next = insertDisplayMathInElement(el, op.latex, toAnchor(op));
        break;
      case 'update_text_math':
        next = updateTextMathInElement(el, op.math_id, op.latex);
        break;
      case 'remove_text_math':
        next = removeTextMathFromElement(el, op.math_id);
        break;
      case 'convert_text_math':
        next = convertTextMathInElement(el, op.math_id, op.to);
        break;
    }
    return remeasure(next);
  } catch (err) {
    if (err instanceof TextMathError) {
      throw new CanvasAgentParseError('schema', err.message);
    }
    throw err;
  }
}
