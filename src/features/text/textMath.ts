/**
 * Insert / update / remove / convert inline & display math inside TextElement rich text.
 * Shared by manual toolbar UI and AI agent operations.
 */

import type { TextElement } from '../../types/canvas';
import { sanitizeLatexSource, validateLatex } from '../equations/latex';
import {
  createDisplayMathBlock,
  createInlineMathSpan,
  getRichTextDocument,
  isDisplayMathBlock,
  isInlineMathSpan,
  richTextToPlainText,
  spanPlainText,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextInlineMathSpan,
  type RichTextSpan,
} from './richText';
import { ensureBlockIds, ensureMathIds, newFeatureId } from './textFeatures';

export type MathInsertAnchor =
  | { after_block_id: string }
  | { before_block_id: string }
  | { after_text: string; block_id?: string; occurrence?: number }
  | { before_text: string; block_id?: string; occurrence?: number }
  | { at_end?: true };

export class TextMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextMathError';
  }
}

function requireValidLatex(latex: string, displayMode: boolean): string {
  const source = sanitizeLatexSource(latex);
  if (!source) throw new TextMathError('LaTeX cannot be empty.');
  const check = validateLatex(source, displayMode);
  if (!check.ok) {
    throw new TextMathError(check.error ?? 'Invalid LaTeX.');
  }
  return source;
}

function syncPlain(el: TextElement, richText: RichTextDocument): TextElement {
  const normalized = ensureMathIds(ensureBlockIds(richText));
  return {
    ...el,
    richText: normalized,
    text: richTextToPlainText(normalized),
  };
}

function findBlockIndex(doc: RichTextDocument, blockId: string): number {
  const idx = doc.blocks.findIndex((b) => b.id === blockId);
  if (idx < 0) throw new TextMathError(`Unknown block_id "${blockId}".`);
  return idx;
}

/**
 * Insert an inline math span into a content block at a plain-text offset.
 * Offset is measured in `blockPlainText` units (math tokens expand to [LaTeX: …]).
 */
export function insertInlineMathInBlock(
  block: RichTextBlock,
  offset: number,
  latex: string,
  options?: { id?: string },
): RichTextBlock {
  if (isDisplayMathBlock(block)) {
    throw new TextMathError('Cannot insert inline math into a display_math block.');
  }
  const source = requireValidLatex(latex, false);
  const math = createInlineMathSpan(source, {
    id: options?.id ?? newFeatureId('math'),
  });

  const plainLen = block.spans.map(spanPlainText).join('').length;
  const cut = Math.max(0, Math.min(offset, plainLen));

  const before: RichTextSpan[] = [];
  const after: RichTextSpan[] = [];
  let cursor = 0;
  for (const span of block.spans) {
    if (isInlineMathSpan(span)) {
      const token = spanPlainText(span);
      if (cursor + token.length <= cut) before.push(span);
      else after.push(span);
      cursor += token.length;
      continue;
    }
    const start = cursor;
    const end = cursor + span.text.length;
    if (end <= cut) {
      before.push(span);
    } else if (start >= cut) {
      after.push(span);
    } else {
      const local = cut - start;
      if (local > 0) {
        before.push({
          text: span.text.slice(0, local),
          ...(span.style ? { style: span.style } : {}),
          ...(span.type ? { type: span.type } : {}),
        });
      }
      if (local < span.text.length) {
        after.push({
          text: span.text.slice(local),
          ...(span.style ? { style: span.style } : {}),
          ...(span.type ? { type: span.type } : {}),
        });
      }
    }
    cursor = end;
  }

  return {
    ...block,
    spans: [...before, math, ...after],
  };
}

/** Insert a display_math block into the document at a block index. */
export function insertDisplayMathAt(
  doc: RichTextDocument,
  index: number,
  latex: string,
  options?: { id?: string },
): RichTextDocument {
  const source = requireValidLatex(latex, true);
  const block = createDisplayMathBlock(source, {
    id: options?.id ?? newFeatureId('math'),
  });
  const blocks = [...doc.blocks];
  const at = Math.max(0, Math.min(index, blocks.length));
  blocks.splice(at, 0, block);
  return { blocks };
}

function resolveInsertIndex(
  doc: RichTextDocument,
  anchor: MathInsertAnchor,
): { blockIndex: number; inlineOffset?: number; mode: 'inline' | 'block' } {
  if ('after_block_id' in anchor) {
    const idx = findBlockIndex(doc, anchor.after_block_id);
    return { blockIndex: idx + 1, mode: 'block' };
  }
  if ('before_block_id' in anchor) {
    const idx = findBlockIndex(doc, anchor.before_block_id);
    return { blockIndex: idx, mode: 'block' };
  }
  if ('after_text' in anchor) {
    if (anchor.block_id && !doc.blocks.some((b) => b.id === anchor.block_id)) {
      throw new TextMathError(`Unknown block_id "${anchor.block_id}".`);
    }
    const all: Array<{ blockIndex: number; offset: number }> = [];
    for (let i = 0; i < doc.blocks.length; i++) {
      const b = doc.blocks[i]!;
      if (anchor.block_id && b.id !== anchor.block_id) continue;
      if (isDisplayMathBlock(b)) continue;
      const plain = b.spans.map(spanPlainText).join('');
      let from = 0;
      while (from <= plain.length) {
        const idx = plain.indexOf(anchor.after_text, from);
        if (idx < 0) break;
        all.push({ blockIndex: i, offset: idx + anchor.after_text.length });
        from = idx + 1;
      }
    }
    if (all.length === 0) {
      throw new TextMathError(
        `Could not find text "${anchor.after_text}" in the target text.`,
      );
    }
    const occ = anchor.occurrence ?? 0;
    if (all.length > 1 && anchor.occurrence === undefined) {
      throw new TextMathError(
        `Ambiguous text "${anchor.after_text}": ${all.length} match(es); provide block_id or occurrence.`,
      );
    }
    if (occ < 0 || occ >= all.length) {
      throw new TextMathError(
        `Ambiguous text "${anchor.after_text}": ${all.length} match(es); occurrence must be 0–${all.length - 1}.`,
      );
    }
    const pick = all[occ]!;
    return {
      blockIndex: pick.blockIndex,
      inlineOffset: pick.offset,
      mode: 'inline',
    };
  }
  if ('before_text' in anchor) {
    if (anchor.block_id && !doc.blocks.some((b) => b.id === anchor.block_id)) {
      throw new TextMathError(`Unknown block_id "${anchor.block_id}".`);
    }
    const all: Array<{ blockIndex: number; offset: number }> = [];
    for (let i = 0; i < doc.blocks.length; i++) {
      const b = doc.blocks[i]!;
      if (anchor.block_id && b.id !== anchor.block_id) continue;
      if (isDisplayMathBlock(b)) continue;
      const plain = b.spans.map(spanPlainText).join('');
      let from = 0;
      while (from <= plain.length) {
        const idx = plain.indexOf(anchor.before_text, from);
        if (idx < 0) break;
        all.push({ blockIndex: i, offset: idx });
        from = idx + 1;
      }
    }
    if (all.length === 0) {
      throw new TextMathError(
        `Could not find text "${anchor.before_text}" in the target text.`,
      );
    }
    const occ = anchor.occurrence ?? 0;
    if (all.length > 1 && anchor.occurrence === undefined) {
      throw new TextMathError(
        `Ambiguous text "${anchor.before_text}": ${all.length} match(es); provide block_id or occurrence.`,
      );
    }
    if (occ < 0 || occ >= all.length) {
      throw new TextMathError(
        `Ambiguous text "${anchor.before_text}": ${all.length} match(es); occurrence must be 0–${all.length - 1}.`,
      );
    }
    const pick = all[occ]!;
    return {
      blockIndex: pick.blockIndex,
      inlineOffset: pick.offset,
      mode: 'inline',
    };
  }
  // at_end
  return { blockIndex: doc.blocks.length, mode: 'block' };
}

export function insertInlineMathInElement(
  el: TextElement,
  latex: string,
  anchor: MathInsertAnchor,
): TextElement {
  const doc = ensureMathIds(ensureBlockIds(getRichTextDocument(el)));
  const resolved = resolveInsertIndex(doc, anchor);
  if (resolved.mode !== 'inline' || resolved.inlineOffset === undefined) {
    // Insert into last content block at end, or create a paragraph.
    let blocks = [...doc.blocks];
    let targetIdx = blocks.length - 1;
    while (targetIdx >= 0 && isDisplayMathBlock(blocks[targetIdx]!)) {
      targetIdx -= 1;
    }
    if (targetIdx < 0) {
      blocks = [{ type: 'paragraph', id: newFeatureId('block'), spans: [{ text: '' }] }];
      targetIdx = 0;
    }
    const block = blocks[targetIdx]!;
    const offset = isDisplayMathBlock(block)
      ? 0
      : block.spans.map(spanPlainText).join('').length;
    blocks[targetIdx] = insertInlineMathInBlock(block, offset, latex);
    return syncPlain(el, { blocks });
  }
  const blocks = [...doc.blocks];
  const block = blocks[resolved.blockIndex]!;
  blocks[resolved.blockIndex] = insertInlineMathInBlock(
    block,
    resolved.inlineOffset,
    latex,
  );
  return syncPlain(el, { blocks });
}

export function insertDisplayMathInElement(
  el: TextElement,
  latex: string,
  anchor: MathInsertAnchor,
): TextElement {
  const doc = ensureMathIds(ensureBlockIds(getRichTextDocument(el)));
  const resolved = resolveInsertIndex(doc, anchor);
  let index = resolved.blockIndex;
  if (resolved.mode === 'inline' && resolved.inlineOffset !== undefined) {
    // Split the paragraph at the offset and insert display math between parts.
    const block = doc.blocks[resolved.blockIndex]!;
    if (isDisplayMathBlock(block)) {
      index = resolved.blockIndex + 1;
    } else {
      const plain = block.spans.map(spanPlainText).join('');
      const cut = resolved.inlineOffset;
      if (cut <= 0) {
        index = resolved.blockIndex;
      } else if (cut >= plain.length) {
        index = resolved.blockIndex + 1;
      } else {
        // Split via insertInlineMathInBlock-style cut into before/after paragraphs.
        const beforeSpans: RichTextSpan[] = [];
        const afterSpans: RichTextSpan[] = [];
        let cursor = 0;
        for (const span of block.spans) {
          if (isInlineMathSpan(span)) {
            const token = spanPlainText(span);
            if (cursor + token.length <= cut) beforeSpans.push(span);
            else afterSpans.push(span);
            cursor += token.length;
            continue;
          }
          const start = cursor;
          const end = cursor + span.text.length;
          if (end <= cut) beforeSpans.push(span);
          else if (start >= cut) afterSpans.push(span);
          else {
            const local = cut - start;
            if (local > 0) {
              beforeSpans.push({
                text: span.text.slice(0, local),
                ...(span.style ? { style: span.style } : {}),
              });
            }
            if (local < span.text.length) {
              afterSpans.push({
                text: span.text.slice(local),
                ...(span.style ? { style: span.style } : {}),
              });
            }
          }
          cursor = end;
        }
        const before: RichTextBlock = {
          ...block,
          spans: beforeSpans.length ? beforeSpans : [{ text: '' }],
        };
        const after: RichTextBlock = {
          type: block.type,
          id: newFeatureId('block'),
          spans: afterSpans.length ? afterSpans : [{ text: '' }],
        };
        const blocks = [...doc.blocks];
        blocks.splice(resolved.blockIndex, 1, before, after);
        const withMath = insertDisplayMathAt(
          { blocks },
          resolved.blockIndex + 1,
          latex,
        );
        return syncPlain(el, withMath);
      }
    }
  }
  return syncPlain(el, insertDisplayMathAt(doc, index, latex));
}

function findMathNode(
  doc: RichTextDocument,
  mathId: string,
): {
  blockIndex: number;
  spanIndex: number | null;
  kind: 'inline' | 'display';
} {
  for (let i = 0; i < doc.blocks.length; i++) {
    const b = doc.blocks[i]!;
    if (isDisplayMathBlock(b) && b.id === mathId) {
      return { blockIndex: i, spanIndex: null, kind: 'display' };
    }
    if (!isDisplayMathBlock(b)) {
      for (let j = 0; j < b.spans.length; j++) {
        const s = b.spans[j]!;
        if (isInlineMathSpan(s) && s.id === mathId) {
          return { blockIndex: i, spanIndex: j, kind: 'inline' };
        }
      }
    }
  }
  throw new TextMathError(`Unknown math id "${mathId}".`);
}

export function updateTextMathInElement(
  el: TextElement,
  mathId: string,
  latex: string,
): TextElement {
  const doc = ensureMathIds(ensureBlockIds(getRichTextDocument(el)));
  const loc = findMathNode(doc, mathId);
  const displayMode = loc.kind === 'display';
  const source = requireValidLatex(latex, displayMode);
  const blocks = [...doc.blocks];
  if (loc.kind === 'display') {
    const prev = blocks[loc.blockIndex]! as Extract<
      RichTextBlock,
      { type: 'display_math' }
    >;
    blocks[loc.blockIndex] = { ...prev, latex: source };
  } else {
    const block = { ...blocks[loc.blockIndex]! };
    if (isDisplayMathBlock(block)) throw new TextMathError('Internal math location error.');
    const spans = [...block.spans];
    const prev = spans[loc.spanIndex!] as RichTextInlineMathSpan;
    spans[loc.spanIndex!] = { ...prev, latex: source };
    blocks[loc.blockIndex] = { ...block, spans };
  }
  return syncPlain(el, { blocks });
}

export function removeTextMathFromElement(
  el: TextElement,
  mathId: string,
): TextElement {
  const doc = ensureMathIds(ensureBlockIds(getRichTextDocument(el)));
  const loc = findMathNode(doc, mathId);
  let blocks = [...doc.blocks];
  if (loc.kind === 'display') {
    blocks.splice(loc.blockIndex, 1);
    if (blocks.length === 0) {
      blocks = [{ type: 'paragraph', id: newFeatureId('block'), spans: [{ text: '' }] }];
    }
  } else {
    const block = { ...blocks[loc.blockIndex]! };
    if (isDisplayMathBlock(block)) throw new TextMathError('Internal math location error.');
    const spans = block.spans.filter((_, i) => i !== loc.spanIndex);
    blocks[loc.blockIndex] = {
      ...block,
      spans: spans.length ? spans : [{ text: '' }],
    };
  }
  return syncPlain(el, { blocks });
}

/** Convert inline ↔ display while preserving latex and id. */
export function convertTextMathInElement(
  el: TextElement,
  mathId: string,
  to: 'inline' | 'display',
): TextElement {
  const doc = ensureMathIds(ensureBlockIds(getRichTextDocument(el)));
  const loc = findMathNode(doc, mathId);
  if (loc.kind === to) return el;

  if (loc.kind === 'inline' && to === 'display') {
    const block = doc.blocks[loc.blockIndex]!;
    if (isDisplayMathBlock(block)) throw new TextMathError('Internal math location error.');
    const span = block.spans[loc.spanIndex!] as RichTextInlineMathSpan;
    const latex = span.latex;
    // Remove inline, insert display after the block (or split if mid-paragraph).
    const without = removeTextMathFromElement(el, mathId);
    const afterDoc = ensureMathIds(ensureBlockIds(getRichTextDocument(without)));
    // Find original block index (may still exist).
    const idx = afterDoc.blocks.findIndex((b) => b.id === block.id);
    const insertAt = idx >= 0 ? idx + 1 : afterDoc.blocks.length;
    return syncPlain(
      without,
      insertDisplayMathAt(afterDoc, insertAt, latex, { id: mathId }),
    );
  }

  // display → inline: replace display block with a paragraph containing the inline math.
  const disp = doc.blocks[loc.blockIndex]!;
  if (!isDisplayMathBlock(disp)) throw new TextMathError('Internal math location error.');
  const inline = createInlineMathSpan(disp.latex, { id: mathId });
  const paragraph: RichTextBlock = {
    type: 'paragraph',
    id: newFeatureId('block'),
    spans: [inline],
  };
  const blocks = [...doc.blocks];
  blocks.splice(loc.blockIndex, 1, paragraph);
  return syncPlain(el, { blocks });
}

/** List math nodes for UI / agent context. */
export function listMathNodes(doc: RichTextDocument): Array<{
  id: string;
  kind: 'inline' | 'display';
  latex: string;
  blockId?: string;
}> {
  const out: Array<{
    id: string;
    kind: 'inline' | 'display';
    latex: string;
    blockId?: string;
  }> = [];
  for (const b of doc.blocks) {
    if (isDisplayMathBlock(b)) {
      if (b.id) out.push({ id: b.id, kind: 'display', latex: b.latex, blockId: b.id });
      continue;
    }
    for (const s of b.spans) {
      if (isInlineMathSpan(s) && s.id) {
        out.push({ id: s.id, kind: 'inline', latex: s.latex, blockId: b.id });
      }
    }
  }
  return out;
}
