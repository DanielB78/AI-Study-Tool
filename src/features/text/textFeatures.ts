/**
 * Optional TextElement features: title, notes, linked comments, highlight styles.
 * Shared by manual UI and AI agent — same mutation helpers.
 */

import { nanoid } from 'nanoid';
import type { TextElement } from '../../types/canvas';
import {
  getRichTextDocument,
  plainTextToRichText,
  richTextToPlainText,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextSpan,
} from './richText';
import type {
  TextComment,
  TextCommentAnchor,
  TextCommentType,
  TextHighlightStyle,
  TextNote,
  TextNoteType,
  TextTitle,
} from './textFeatureTypes';

export type {
  TextComment,
  TextCommentAnchor,
  TextCommentType,
  TextHighlightStyle,
  TextNote,
  TextNoteType,
  TextTitle,
} from './textFeatureTypes';
export {
  TEXT_COMMENT_TYPES,
  TEXT_HIGHLIGHT_STYLES,
  TEXT_NOTE_TYPES,
} from './textFeatureTypes';

/** Maps semantic highlight roles → rich-text highlight_color palette names. */
export const HIGHLIGHT_STYLE_COLORS: Record<TextHighlightStyle, string> = {
  important: 'default',
  definition: 'blue',
  warning: 'orange',
  emphasis: 'purple',
};

export function newFeatureId(prefix: string): string {
  return `${prefix}_${nanoid(8)}`;
}

export function ensureBlockIds(doc: RichTextDocument): RichTextDocument {
  return {
    blocks: doc.blocks.map((b) =>
      b.id?.trim() ? b : { ...b, id: newFeatureId('block') },
    ),
  };
}

export function blockPlainText(block: RichTextBlock): string {
  return block.spans.map((s) => s.text).join('');
}

export function findQuoteOffsets(
  blockText: string,
  quote: string,
): Array<{ start: number; end: number }> {
  const q = quote.trim();
  if (!q) return [];
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= blockText.length) {
    const idx = blockText.indexOf(q, from);
    if (idx < 0) break;
    out.push({ start: idx, end: idx + q.length });
    from = idx + 1;
  }
  return out;
}

export type QuoteAnchorSpec = {
  block_id?: string;
  block_ref?: string;
  quote: string;
  occurrence?: number;
};

/**
 * Resolve a quote-based anchor against a document with block ids.
 * Throws if not found or ambiguous without disambiguation.
 */
export function resolveQuoteAnchor(
  doc: RichTextDocument,
  spec: QuoteAnchorSpec,
): TextCommentAnchor {
  const withIds = ensureBlockIds(doc);
  const quote = spec.quote.trim();
  if (!quote) {
    throw new Error('Comment anchor quote must be non-empty.');
  }

  const preferredId = (spec.block_id ?? spec.block_ref)?.trim();
  const searchBlocks = preferredId
    ? withIds.blocks.filter((b) => b.id === preferredId)
    : withIds.blocks;

  if (preferredId && searchBlocks.length === 0) {
    throw new Error(`Unknown block_id "${preferredId}" in target text.`);
  }

  const candidates: Array<{ blockId: string; start: number; end: number }> = [];
  for (const block of searchBlocks) {
    const plain = blockPlainText(block);
    for (const hit of findQuoteOffsets(plain, quote)) {
      candidates.push({ blockId: block.id!, ...hit });
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Could not find quote "${quote}" in the target text.`);
  }

  if (candidates.length === 1) {
    const pick = candidates[0]!;
    return {
      blockId: pick.blockId,
      start: pick.start,
      end: pick.end,
      quote,
      status: 'resolved',
    };
  }

  if (spec.occurrence !== undefined) {
    const occ = spec.occurrence;
    if (occ < 0 || occ >= candidates.length) {
      throw new Error(
        `Ambiguous quote "${quote}": ${candidates.length} match(es); occurrence must be 0–${candidates.length - 1}.`,
      );
    }
    const pick = candidates[occ]!;
    return {
      blockId: pick.blockId,
      start: pick.start,
      end: pick.end,
      quote,
      status: 'resolved',
    };
  }

  throw new Error(
    `Ambiguous quote "${quote}": found ${candidates.length} matches. Provide block_id or occurrence.`,
  );
}

export type SpanDecorationPatch = {
  /** Ordinary highlight — does not clear linked_comment_id. */
  highlightColor?: string;
  /** Linked-comment mark — does not clear highlight_color. */
  linkedCommentId?: string;
  /** Clear linked_comment_id when it matches this id. */
  clearLinkedCommentId?: string;
};

/** Apply range decorations without destroying coexisting highlight/comment marks. */
export function applyDecorationToBlock(
  block: RichTextBlock,
  start: number,
  end: number,
  patch: SpanDecorationPatch,
): RichTextBlock {
  if (start >= end) return block;
  const plain = blockPlainText(block);
  const lo = Math.max(0, Math.min(start, plain.length));
  const hi = Math.max(lo, Math.min(end, plain.length));

  const chars: Array<{ ch: string; style?: RichTextSpan['style'] }> = [];
  let cursor = 0;
  for (const span of block.spans) {
    for (const ch of span.text) {
      const inRange = cursor >= lo && cursor < hi;
      let style = span.style ? { ...span.style } : undefined;
      if (inRange) {
        style = { ...(style ?? {}) };
        if (patch.highlightColor !== undefined) {
          style.highlight_color = patch.highlightColor;
        }
        if (patch.linkedCommentId !== undefined) {
          style.linked_comment_id = patch.linkedCommentId;
        }
        if (
          patch.clearLinkedCommentId &&
          style.linked_comment_id === patch.clearLinkedCommentId
        ) {
          delete style.linked_comment_id;
        }
        if (Object.keys(style).length === 0) style = undefined;
      }
      chars.push({ ch, style });
      cursor += 1;
    }
  }

  const spans: RichTextSpan[] = [];
  for (const c of chars) {
    const last = spans[spans.length - 1];
    const styleKey = JSON.stringify(c.style ?? null);
    const lastKey = last ? JSON.stringify(last.style ?? null) : null;
    if (last && styleKey === lastKey) {
      last.text += c.ch;
    } else {
      spans.push({
        text: c.ch,
        ...(c.style ? { style: c.style } : {}),
      });
    }
  }

  return { ...block, spans: spans.length ? spans : [{ text: '' }] };
}

/** @deprecated Prefer applyDecorationToBlock — kept for call-site clarity. */
export function applyHighlightToBlock(
  block: RichTextBlock,
  start: number,
  end: number,
  highlightColor: string,
): RichTextBlock {
  return applyDecorationToBlock(block, start, end, { highlightColor });
}

export function applyHighlightInDocument(
  doc: RichTextDocument,
  anchor: Pick<TextCommentAnchor, 'blockId' | 'start' | 'end'>,
  highlightColor: string,
): RichTextDocument {
  const withIds = ensureBlockIds(doc);
  return {
    blocks: withIds.blocks.map((b) =>
      b.id === anchor.blockId
        ? applyDecorationToBlock(b, anchor.start, anchor.end, {
            highlightColor,
          })
        : b,
    ),
  };
}

export function applyCommentMarkInDocument(
  doc: RichTextDocument,
  anchor: Pick<TextCommentAnchor, 'blockId' | 'start' | 'end'>,
  commentId: string,
): RichTextDocument {
  const withIds = ensureBlockIds(doc);
  return {
    blocks: withIds.blocks.map((b) =>
      b.id === anchor.blockId
        ? applyDecorationToBlock(b, anchor.start, anchor.end, {
            linkedCommentId: commentId,
          })
        : b,
    ),
  };
}

export function clearCommentMarkInDocument(
  doc: RichTextDocument,
  commentId: string,
): RichTextDocument {
  const withIds = ensureBlockIds(doc);
  return {
    blocks: withIds.blocks.map((b) => {
      const plainLen = blockPlainText(b).length;
      if (plainLen === 0) return b;
      return applyDecorationToBlock(b, 0, plainLen, {
        clearLinkedCommentId: commentId,
      });
    }),
  };
}

export function composeTextElementIndexText(el: TextElement): string {
  const parts: string[] = [];
  if (el.title?.text.trim()) parts.push(el.title.text.trim());
  const body = el.richText ? richTextToPlainText(el.richText) : el.text;
  if (body.trim()) parts.push(body.trim());
  for (const note of el.notes ?? []) {
    if (note.text.trim()) parts.push(note.text.trim());
  }
  for (const c of el.comments ?? []) {
    if (c.text.trim()) {
      const q = c.anchor.quote ? `"${c.anchor.quote}" — ` : '';
      parts.push(`${q}${c.text.trim()}`);
    }
  }
  return parts.join('\n\n');
}

export function ensureRichText(el: TextElement): RichTextDocument {
  if (el.richText?.blocks?.length) return ensureBlockIds(el.richText);
  return ensureBlockIds(plainTextToRichText(el.text || ''));
}

export function setTitleOnElement(el: TextElement, text: string): TextElement {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ...el, title: undefined };
  }
  return {
    ...el,
    title: {
      id: el.title?.id ?? newFeatureId('title'),
      text: trimmed,
    },
  };
}

export function removeTitleFromElement(el: TextElement): TextElement {
  return { ...el, title: undefined };
}

export function addNoteToElement(
  el: TextElement,
  text: string,
  noteType: TextNoteType = 'extra_information',
): { element: TextElement; noteId: string } {
  const notes = [...(el.notes ?? [])];
  const id = newFeatureId('note');
  const order = notes.length === 0 ? 0 : Math.max(...notes.map((n) => n.order)) + 1;
  notes.push({
    id,
    text: text.trim(),
    noteType,
    layoutMode: 'auto',
    order,
  });
  return { element: { ...el, notes }, noteId: id };
}

export function updateNoteOnElement(
  el: TextElement,
  noteId: string,
  patch: Partial<Pick<TextNote, 'text' | 'noteType' | 'layoutMode' | 'offsetX' | 'offsetY'>>,
): TextElement {
  if (!(el.notes ?? []).some((n) => n.id === noteId)) {
    throw new Error(`Unknown note_id "${noteId}" on text element "${el.id}".`);
  }
  const notes = (el.notes ?? []).map((n) =>
    n.id === noteId
      ? {
          ...n,
          ...patch,
          ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
        }
      : n,
  );
  return { ...el, notes };
}

export function removeNoteFromElement(el: TextElement, noteId: string): TextElement {
  const notes = (el.notes ?? []).filter((n) => n.id !== noteId);
  if (notes.length === (el.notes ?? []).length) {
    throw new Error(`Unknown note_id "${noteId}" on text element "${el.id}".`);
  }
  return { ...el, notes: notes.length ? notes : undefined };
}

export function addCommentToElement(
  el: TextElement,
  spec: {
    anchor: QuoteAnchorSpec;
    text: string;
    commentType?: TextCommentType;
  },
): { element: TextElement; commentId: string } {
  const doc = ensureRichText(el);
  const anchor = resolveQuoteAnchor(doc, spec.anchor);
  const commentId = newFeatureId('comment');
  // Mark via linked_comment_id so ordinary highlight_color is preserved.
  const nextDoc = applyCommentMarkInDocument(doc, anchor, commentId);
  const comment: TextComment = {
    id: commentId,
    anchor,
    text: spec.text.trim(),
    commentType: spec.commentType ?? 'explanation',
    displayState: 'collapsed',
  };
  const comments = [...(el.comments ?? []), comment];
  return {
    element: {
      ...el,
      richText: nextDoc,
      text: richTextToPlainText(nextDoc),
      comments,
    },
    commentId,
  };
}

export function updateCommentOnElement(
  el: TextElement,
  commentId: string,
  patch: Partial<
    Pick<
      TextComment,
      'text' | 'commentType' | 'displayState' | 'panelOffsetX' | 'panelOffsetY'
    >
  >,
): TextElement {
  if (!(el.comments ?? []).some((c) => c.id === commentId)) {
    throw new Error(`Unknown comment_id "${commentId}" on text element "${el.id}".`);
  }
  const comments = (el.comments ?? []).map((c) =>
    c.id === commentId
      ? {
          ...c,
          ...patch,
          ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
        }
      : c,
  );
  return { ...el, comments };
}

export function removeCommentFromElement(
  el: TextElement,
  commentId: string,
): TextElement {
  const comments = (el.comments ?? []).filter((c) => c.id !== commentId);
  if (comments.length === (el.comments ?? []).length) {
    throw new Error(`Unknown comment_id "${commentId}" on text element "${el.id}".`);
  }
  const doc = el.richText ? clearCommentMarkInDocument(el.richText, commentId) : el.richText;
  return {
    ...el,
    ...(doc ? { richText: doc, text: richTextToPlainText(doc) } : {}),
    comments: comments.length ? comments : undefined,
  };
}

export type InsertHeadingPosition = {
  afterBlockId?: string;
  beforeBlockId?: string;
  /** Insert heading immediately before this quote (may split a paragraph). */
  beforeQuote?: QuoteAnchorSpec;
  /** Insert heading immediately after this quote (may split a paragraph). */
  afterQuote?: QuoteAnchorSpec;
};

function splitBlockAt(
  block: RichTextBlock,
  offset: number,
): { before: RichTextBlock; after: RichTextBlock } {
  const plain = blockPlainText(block);
  const cut = Math.max(0, Math.min(offset, plain.length));
  const beforeChars: Array<{ ch: string; style?: RichTextSpan['style'] }> = [];
  const afterChars: Array<{ ch: string; style?: RichTextSpan['style'] }> = [];
  let cursor = 0;
  for (const span of block.spans) {
    for (const ch of span.text) {
      const entry = { ch, style: span.style ? { ...span.style } : undefined };
      if (cursor < cut) beforeChars.push(entry);
      else afterChars.push(entry);
      cursor += 1;
    }
  }
  const toSpans = (chars: typeof beforeChars): RichTextSpan[] => {
    const spans: RichTextSpan[] = [];
    for (const c of chars) {
      const last = spans[spans.length - 1];
      const styleKey = JSON.stringify(c.style ?? null);
      const lastKey = last ? JSON.stringify(last.style ?? null) : null;
      if (last && styleKey === lastKey) last.text += c.ch;
      else spans.push({ text: c.ch, ...(c.style ? { style: c.style } : {}) });
    }
    return spans.length ? spans : [{ text: '' }];
  };
  return {
    before: { ...block, id: block.id, spans: toSpans(beforeChars) },
    after: { ...block, id: newFeatureId('block'), spans: toSpans(afterChars) },
  };
}

/** Remap comment anchors after splitting `oldBlockId` at `cut` into before/after. */
export function remapCommentsAfterSplit(
  comments: TextComment[] | undefined,
  oldBlockId: string,
  cut: number,
  afterBlockId: string,
): TextComment[] | undefined {
  if (!comments?.length) return comments;
  return comments.map((c) => {
    if (c.anchor.blockId !== oldBlockId) return c;
    const { start, end } = c.anchor;
    if (end <= cut) {
      return c;
    }
    if (start >= cut) {
      return {
        ...c,
        anchor: {
          ...c.anchor,
          blockId: afterBlockId,
          start: start - cut,
          end: end - cut,
          status: 'resolved',
        },
      };
    }
    // Span crossed the split — do not silently reattach.
    return {
      ...c,
      anchor: { ...c.anchor, status: 'unresolved' },
    };
  });
}

function buildHeadingBlock(text: string, level: 1 | 2): RichTextBlock {
  return {
    id: newFeatureId('heading'),
    type: 'heading',
    role: 'heading',
    spans: [
      {
        text: text.trim(),
        style: {
          bold: true,
          font_size: level === 1 ? 'heading' : 'subheading',
        },
      },
    ],
  };
}

/**
 * Insert a heading at an explicit position.
 * Rejects missing position — never appends arbitrarily.
 */
export function insertHeadingInElement(
  el: TextElement,
  opts: {
    text: string;
    level?: 1 | 2;
    afterBlockId?: string;
    beforeBlockId?: string;
    beforeQuote?: QuoteAnchorSpec;
    afterQuote?: QuoteAnchorSpec;
  },
): { element: TextElement; blockId: string } {
  const hasPos = !!(
    opts.afterBlockId ||
    opts.beforeBlockId ||
    opts.beforeQuote ||
    opts.afterQuote
  );
  if (!hasPos) {
    throw new Error(
      'insert_text_heading requires a position: after_block_id, before_block_id, before_quote, or after_quote.',
    );
  }

  let doc = ensureRichText(el);
  let comments = el.comments;
  const level = opts.level ?? 1;
  const heading = buildHeadingBlock(opts.text, level);
  const blockId = heading.id!;
  let blocks = [...doc.blocks];

  if (opts.afterBlockId || opts.beforeBlockId) {
    const refId = opts.afterBlockId ?? opts.beforeBlockId!;
    const idx = blocks.findIndex((b) => b.id === refId);
    if (idx < 0) {
      throw new Error(
        `Unknown ${opts.afterBlockId ? 'after_block_id' : 'before_block_id'} "${refId}".`,
      );
    }
    const insertAt = opts.afterBlockId ? idx + 1 : idx;
    blocks.splice(insertAt, 0, heading);
  } else {
    const quoteSpec = opts.beforeQuote ?? opts.afterQuote!;
    const anchor = resolveQuoteAnchor(doc, quoteSpec);
    const idx = blocks.findIndex((b) => b.id === anchor.blockId);
    if (idx < 0) {
      throw new Error(`Anchor block "${anchor.blockId}" not found.`);
    }
    const block = blocks[idx]!;
    const cut = opts.beforeQuote ? anchor.start : anchor.end;
    const plain = blockPlainText(block);

    if (cut <= 0) {
      blocks.splice(idx, 0, heading);
    } else if (cut >= plain.length) {
      blocks.splice(idx + 1, 0, heading);
    } else {
      const { before, after } = splitBlockAt(block, cut);
      comments = remapCommentsAfterSplit(
        comments,
        block.id!,
        cut,
        after.id!,
      );
      blocks.splice(idx, 1, before, heading, after);
    }
  }

  const richText = { blocks };
  return {
    element: {
      ...el,
      richText,
      text: richTextToPlainText(richText),
      ...(comments ? { comments } : {}),
    },
    blockId,
  };
}

export function highlightQuoteInElement(
  el: TextElement,
  spec: QuoteAnchorSpec & { style?: TextHighlightStyle },
): TextElement {
  const doc = ensureRichText(el);
  const anchor = resolveQuoteAnchor(doc, spec);
  const color = HIGHLIGHT_STYLE_COLORS[spec.style ?? 'important'];
  const nextDoc = applyHighlightInDocument(doc, anchor, color);
  return {
    ...el,
    richText: nextDoc,
    text: richTextToPlainText(nextDoc),
  };
}

export const TEXT_FEATURE_LAYOUT = {
  titleGap: 10,
  noteGap: 12,
  noteSeparatorGap: 14,
  noteFontScale: 0.85,
} as const;

export function sortedNotes(el: TextElement): TextNote[] {
  return [...(el.notes ?? [])].sort((a, b) => a.order - b.order);
}

/** True when the HTML overlay (not Konva Text) should paint this element. */
export function textElementNeedsHtmlOverlay(el: TextElement): boolean {
  const componentType = el.componentType;
  const hasComponentChrome =
    !!componentType &&
    componentType !== 'main_text' &&
    componentType !== 'title';
  return (
    !!(el.richText && el.richText.blocks.length > 0) ||
    !!el.title?.text.trim() ||
    !!(el.notes && el.notes.length > 0) ||
    hasComponentChrome
  );
}

export function getDocumentFromElement(el: TextElement): RichTextDocument {
  return getRichTextDocument(el);
}
