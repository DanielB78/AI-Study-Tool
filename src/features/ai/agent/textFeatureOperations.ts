/**
 * AI operations for TextElement optional features (title, heading, highlight, comment, note).
 * Same mutations as the manual UI (textFeatures helpers).
 */

import type { TextElement } from '../../../types/canvas';
import {
  TEXT_COMMENT_TYPES,
  TEXT_HIGHLIGHT_STYLES,
  TEXT_NOTE_TYPES,
  type TextCommentType,
  type TextHighlightStyle,
  type TextNoteType,
} from '../../text/textFeatureTypes';
import {
  addCommentToElement,
  addNoteToElement,
  highlightQuoteInElement,
  insertHeadingInElement,
  removeCommentFromElement,
  removeNoteFromElement,
  removeTitleFromElement,
  setTitleOnElement,
  updateCommentOnElement,
  updateNoteOnElement,
  type QuoteAnchorSpec,
} from '../../text/textFeatures';
import { measureTextElementWithFeatures } from '../../text/textAutoSizer';
import { CanvasAgentParseError } from './parseErrors';

export type TextAnchorSpec = QuoteAnchorSpec;

export type SetTextTitleOperation = {
  type: 'set_text_title';
  target_element_id: string;
  text: string;
};

export type RemoveTextTitleOperation = {
  type: 'remove_text_title';
  target_element_id: string;
};

export type InsertTextHeadingOperation = {
  type: 'insert_text_heading';
  target_element_id: string;
  text: string;
  level?: 1 | 2;
  /** Insert after this existing block id. */
  after_block_id?: string;
  /** Insert before this existing block id. */
  before_block_id?: string;
  /** Insert before this quote (may split a paragraph). */
  before_quote?: TextAnchorSpec;
  /** Insert after this quote (may split a paragraph). */
  after_quote?: TextAnchorSpec;
};

export type HighlightTextOperation = {
  type: 'highlight_text';
  target_element_id: string;
  anchor: TextAnchorSpec;
  style?: TextHighlightStyle;
};

export type AddTextCommentOperation = {
  type: 'add_text_comment';
  target_element_id: string;
  anchor: TextAnchorSpec;
  comment: string;
  comment_type?: TextCommentType;
};

export type UpdateTextCommentOperation = {
  type: 'update_text_comment';
  target_element_id: string;
  comment_id: string;
  comment: string;
};

export type RemoveTextCommentOperation = {
  type: 'remove_text_comment';
  target_element_id: string;
  comment_id: string;
};

export type AddTextNoteOperation = {
  type: 'add_text_note';
  target_element_id: string;
  text: string;
  note_type?: TextNoteType;
};

export type UpdateTextNoteOperation = {
  type: 'update_text_note';
  target_element_id: string;
  note_id: string;
  text: string;
};

export type RemoveTextNoteOperation = {
  type: 'remove_text_note';
  target_element_id: string;
  note_id: string;
};

export type TextFeatureOperation =
  | SetTextTitleOperation
  | RemoveTextTitleOperation
  | InsertTextHeadingOperation
  | HighlightTextOperation
  | AddTextCommentOperation
  | UpdateTextCommentOperation
  | RemoveTextCommentOperation
  | AddTextNoteOperation
  | UpdateTextNoteOperation
  | RemoveTextNoteOperation;

export const TEXT_FEATURE_OPERATION_TYPES = [
  'set_text_title',
  'remove_text_title',
  'insert_text_heading',
  'highlight_text',
  'add_text_comment',
  'update_text_comment',
  'remove_text_comment',
  'add_text_note',
  'update_text_note',
  'remove_text_note',
] as const;

export function isTextFeatureOperationType(
  t: string,
): t is TextFeatureOperation['type'] {
  return (TEXT_FEATURE_OPERATION_TYPES as readonly string[]).includes(t);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireTarget(raw: Record<string, unknown>): string {
  const id = raw.target_element_id ?? raw.target_id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new CanvasAgentParseError(
      'missing_target',
      'Text feature operation needs target_element_id.',
    );
  }
  return id.trim();
}

function parseAnchor(raw: unknown, path: string): TextAnchorSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', `${path} must be an object.`);
  }
  if (typeof raw.quote !== 'string' || !raw.quote.trim()) {
    throw new CanvasAgentParseError('schema', `${path}.quote must be a non-empty string.`);
  }
  const anchor: TextAnchorSpec = { quote: raw.quote.trim() };
  if (typeof raw.block_id === 'string' && raw.block_id.trim()) {
    anchor.block_id = raw.block_id.trim();
  }
  if (typeof raw.block_ref === 'string' && raw.block_ref.trim()) {
    anchor.block_ref = raw.block_ref.trim();
  }
  if (raw.occurrence !== undefined) {
    if (typeof raw.occurrence !== 'number' || !Number.isInteger(raw.occurrence) || raw.occurrence < 0) {
      throw new CanvasAgentParseError('schema', `${path}.occurrence must be a non-negative integer.`);
    }
    anchor.occurrence = raw.occurrence;
  }
  return anchor;
}

export function parseTextFeatureOperation(raw: Record<string, unknown>): TextFeatureOperation {
  const type = raw.type;
  if (typeof type !== 'string' || !isTextFeatureOperationType(type)) {
    throw new CanvasAgentParseError('schema', 'Unknown text feature operation.');
  }
  const target_element_id = requireTarget(raw);

  switch (type) {
    case 'set_text_title': {
      if (typeof raw.text !== 'string' || !raw.text.trim()) {
        throw new CanvasAgentParseError('empty_text', 'set_text_title needs non-empty text.');
      }
      return { type, target_element_id, text: raw.text.trim() };
    }
    case 'remove_text_title':
      return { type, target_element_id };
    case 'insert_text_heading': {
      if (typeof raw.text !== 'string' || !raw.text.trim()) {
        throw new CanvasAgentParseError('empty_text', 'insert_text_heading needs non-empty text.');
      }
      let level: 1 | 2 | undefined;
      if (raw.level !== undefined) {
        if (raw.level !== 1 && raw.level !== 2) {
          throw new CanvasAgentParseError('schema', 'insert_text_heading.level must be 1 or 2.');
        }
        level = raw.level;
      }
      const after_block_id =
        typeof raw.after_block_id === 'string' && raw.after_block_id.trim()
          ? raw.after_block_id.trim()
          : undefined;
      const before_block_id =
        typeof raw.before_block_id === 'string' && raw.before_block_id.trim()
          ? raw.before_block_id.trim()
          : undefined;
      const before_quote =
        raw.before_quote !== undefined
          ? parseAnchor(raw.before_quote, 'insert_text_heading.before_quote')
          : undefined;
      const after_quote =
        raw.after_quote !== undefined
          ? parseAnchor(raw.after_quote, 'insert_text_heading.after_quote')
          : undefined;
      if (!after_block_id && !before_block_id && !before_quote && !after_quote) {
        throw new CanvasAgentParseError(
          'schema',
          'insert_text_heading requires a position: after_block_id, before_block_id, before_quote, or after_quote.',
        );
      }
      return {
        type,
        target_element_id,
        text: raw.text.trim(),
        ...(level ? { level } : {}),
        ...(after_block_id ? { after_block_id } : {}),
        ...(before_block_id ? { before_block_id } : {}),
        ...(before_quote ? { before_quote } : {}),
        ...(after_quote ? { after_quote } : {}),
      };
    }
    case 'highlight_text': {
      const anchor = parseAnchor(raw.anchor, 'highlight_text.anchor');
      let style: TextHighlightStyle | undefined;
      if (raw.style !== undefined) {
        if (
          typeof raw.style !== 'string' ||
          !(TEXT_HIGHLIGHT_STYLES as readonly string[]).includes(raw.style)
        ) {
          throw new CanvasAgentParseError(
            'schema',
            `highlight_text.style must be one of: ${TEXT_HIGHLIGHT_STYLES.join(', ')}.`,
          );
        }
        style = raw.style as TextHighlightStyle;
      }
      return { type, target_element_id, anchor, ...(style ? { style } : {}) };
    }
    case 'add_text_comment': {
      const anchor = parseAnchor(raw.anchor, 'add_text_comment.anchor');
      const comment =
        typeof raw.comment === 'string'
          ? raw.comment
          : typeof raw.text === 'string'
            ? raw.text
            : '';
      if (!comment.trim()) {
        throw new CanvasAgentParseError('empty_text', 'add_text_comment needs non-empty comment.');
      }
      let comment_type: TextCommentType | undefined;
      if (raw.comment_type !== undefined) {
        if (
          typeof raw.comment_type !== 'string' ||
          !(TEXT_COMMENT_TYPES as readonly string[]).includes(raw.comment_type)
        ) {
          throw new CanvasAgentParseError(
            'schema',
            `comment_type must be one of: ${TEXT_COMMENT_TYPES.join(', ')}.`,
          );
        }
        comment_type = raw.comment_type as TextCommentType;
      }
      return {
        type,
        target_element_id,
        anchor,
        comment: comment.trim(),
        ...(comment_type ? { comment_type } : {}),
      };
    }
    case 'update_text_comment': {
      if (typeof raw.comment_id !== 'string' || !raw.comment_id.trim()) {
        throw new CanvasAgentParseError('schema', 'update_text_comment needs comment_id.');
      }
      const comment =
        typeof raw.comment === 'string'
          ? raw.comment
          : typeof raw.text === 'string'
            ? raw.text
            : '';
      if (!comment.trim()) {
        throw new CanvasAgentParseError('empty_text', 'update_text_comment needs non-empty comment.');
      }
      return {
        type,
        target_element_id,
        comment_id: raw.comment_id.trim(),
        comment: comment.trim(),
      };
    }
    case 'remove_text_comment': {
      if (typeof raw.comment_id !== 'string' || !raw.comment_id.trim()) {
        throw new CanvasAgentParseError('schema', 'remove_text_comment needs comment_id.');
      }
      return { type, target_element_id, comment_id: raw.comment_id.trim() };
    }
    case 'add_text_note': {
      if (typeof raw.text !== 'string' || !raw.text.trim()) {
        throw new CanvasAgentParseError('empty_text', 'add_text_note needs non-empty text.');
      }
      let note_type: TextNoteType | undefined;
      if (raw.note_type !== undefined) {
        if (
          typeof raw.note_type !== 'string' ||
          !(TEXT_NOTE_TYPES as readonly string[]).includes(raw.note_type)
        ) {
          throw new CanvasAgentParseError(
            'schema',
            `note_type must be one of: ${TEXT_NOTE_TYPES.join(', ')}.`,
          );
        }
        note_type = raw.note_type as TextNoteType;
      }
      return {
        type,
        target_element_id,
        text: raw.text.trim(),
        ...(note_type ? { note_type } : {}),
      };
    }
    case 'update_text_note': {
      if (typeof raw.note_id !== 'string' || !raw.note_id.trim()) {
        throw new CanvasAgentParseError('schema', 'update_text_note needs note_id.');
      }
      if (typeof raw.text !== 'string' || !raw.text.trim()) {
        throw new CanvasAgentParseError('empty_text', 'update_text_note needs non-empty text.');
      }
      return {
        type,
        target_element_id,
        note_id: raw.note_id.trim(),
        text: raw.text.trim(),
      };
    }
    case 'remove_text_note': {
      if (typeof raw.note_id !== 'string' || !raw.note_id.trim()) {
        throw new CanvasAgentParseError('schema', 'remove_text_note needs note_id.');
      }
      return { type, target_element_id, note_id: raw.note_id.trim() };
    }
    default:
      throw new CanvasAgentParseError('schema', 'Unknown text feature operation.');
  }
}

/** Apply a feature op to a TextElement; returns updated element (resized). */
export function applyTextFeatureOperation(
  el: TextElement,
  op: TextFeatureOperation,
): TextElement {
  let next: TextElement;
  switch (op.type) {
    case 'set_text_title':
      next = setTitleOnElement(el, op.text);
      break;
    case 'remove_text_title':
      next = removeTitleFromElement(el);
      break;
    case 'insert_text_heading':
      next = insertHeadingInElement(el, {
        text: op.text,
        level: op.level,
        afterBlockId: op.after_block_id,
        beforeBlockId: op.before_block_id,
        beforeQuote: op.before_quote,
        afterQuote: op.after_quote,
      }).element;
      break;
    case 'highlight_text':
      next = highlightQuoteInElement(el, { ...op.anchor, style: op.style });
      break;
    case 'add_text_comment':
      next = addCommentToElement(el, {
        anchor: op.anchor,
        text: op.comment,
        commentType: op.comment_type,
      }).element;
      break;
    case 'update_text_comment':
      next = updateCommentOnElement(el, op.comment_id, { text: op.comment });
      break;
    case 'remove_text_comment':
      next = removeCommentFromElement(el, op.comment_id);
      break;
    case 'add_text_note':
      next = addNoteToElement(el, op.text, op.note_type).element;
      break;
    case 'update_text_note':
      next = updateNoteOnElement(el, op.note_id, { text: op.text });
      break;
    case 'remove_text_note':
      next = removeNoteFromElement(el, op.note_id);
      break;
    default:
      return el;
  }

  const measured = measureTextElementWithFeatures(next, {
    availableWidth: next.width,
  });
  return {
    ...next,
    height: Math.max(next.height, measured.height),
    metadata: {
      ...next.metadata,
      lastEditedBy: 'ai',
      source: 'agent',
      operation: op.type,
    },
  };
}
