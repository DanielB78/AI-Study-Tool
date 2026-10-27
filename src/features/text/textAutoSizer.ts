/**
 * Deterministic textbox auto-sizing from actual rendered content.
 * Uses the same HTML layout primitives as TextHtmlLayer / rich-text overlay
 * when DOM is available; never mutates CanvasDocument.
 */

import type { TextElement } from '../../types/canvas';
import {
  resolveRichTextFontSize,
  richTextToPlainText,
  type RichTextDocument,
} from './richText';
import { measureRichTextHeight, richTextToHtml } from './richTextHtml';
import { TEXT_FEATURE_LAYOUT, sortedNotes } from './textFeatures';

export type TextStyleConfig = {
  fontSize: number;
  fontFamily: string;
  fontWeight?: 'normal' | 'bold';
  fontItalic?: boolean;
  underline?: boolean;
  lineHeight: number;
  color: string;
  padding: number;
};

export type TextWidthLimits = {
  minWidth: number;
  maxWidth: number;
  defaultWidth: number;
  /** Floor for very short single-line labels. */
  compactMinWidth?: number;
};

/** Matches GRID_LAYOUT_CONFIG text widths (kept local to avoid feature cycles). */
export const TEXT_AUTO_SIZE_WIDTH_DEFAULTS: TextWidthLimits = {
  minWidth: 200,
  maxWidth: 520,
  defaultWidth: 360,
  compactMinWidth: 140,
};

export type TextContentInput = {
  text: string;
  richText?: RichTextDocument;
};

export type TextMeasureResult = {
  /** Final textbox width (outer). */
  width: number;
  /** Final textbox height (outer, includes padding). */
  height: number;
  /** Inner content width used for wrapping. */
  contentWidth: number;
  /** Inner content height before outer padding is applied. */
  contentHeight: number;
  padding: number;
  /** Approximate wrapped line count when available. */
  wrappedLines: number | null;
  measuredWithDom: boolean;
  /** Preferred width chosen before any external constraint. */
  preferredWidth: number;
  autoSized: boolean;
};

/** Pathological content safety — explicit cap, not silent clip of ordinary notes. */
export const TEXT_AUTO_SIZE_MAX_HEIGHT = 20_000;

const AVG_CHAR_FACTOR = 0.55;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function plainFrom(content: TextContentInput): string {
  if (content.richText) return richTextToPlainText(content.richText);
  return content.text.replace(/\r\n/g, '\n');
}

function estimateLineWidth(line: string, fontSize: number): number {
  return Math.max(line.length, 1) * fontSize * AVG_CHAR_FACTOR;
}

/**
 * Sensible preferred width: compact for short labels, readable wrap width
 * for explanations — never full-canvas wide by default.
 */
export function choosePreferredTextWidth(
  content: TextContentInput,
  style: Pick<TextStyleConfig, 'fontSize' | 'padding'>,
  limits: TextWidthLimits = TEXT_AUTO_SIZE_WIDTH_DEFAULTS,
): number {
  const plain = plainFrom(content);
  const pad = Math.max(style.padding, 0) * 2;
  const lines = plain.length === 0 ? [''] : plain.split('\n');
  const longest = Math.max(...lines.map((l) => estimateLineWidth(l, style.fontSize)));
  const intrinsic = Math.ceil(longest + pad + 8);
  const compactMin = limits.compactMinWidth ?? 140;

  const hasBreaks = lines.length > 1;
  const charCount = plain.trim().length;

  if (charCount === 0) {
    return limits.minWidth;
  }

  // Single short label — stay compact.
  if (!hasBreaks && charCount <= 48) {
    return clamp(intrinsic, compactMin, limits.defaultWidth);
  }

  // Short note — between min and default.
  if (charCount <= 160) {
    return clamp(Math.max(intrinsic, limits.minWidth), limits.minWidth, limits.defaultWidth);
  }

  // Medium explanation — comfortable reading width.
  if (charCount <= 600) {
    return limits.defaultWidth;
  }

  // Long content — allow up toward max, but prefer wrapping over extreme width.
  const longTarget = clamp(intrinsic, limits.defaultWidth, limits.maxWidth);
  return Math.min(limits.maxWidth, Math.max(limits.defaultWidth, longTarget));
}

/**
 * Wrap a single paragraph into line counts, breaking long tokens (overflow-wrap).
 * Used when DOM layout is unavailable or returns a zero-height stub (happy-dom).
 */
function countWrappedLinesForParagraph(
  paragraph: string,
  contentWidth: number,
  fontSize: number,
): number {
  const avg = Math.max(fontSize * AVG_CHAR_FACTOR, 1);
  const cpl = Math.max(1, Math.floor(contentWidth / avg));
  if (paragraph.length === 0) return 1;

  const words = paragraph.split(/(\s+)/);
  let lines = 1;
  let col = 0;
  for (const token of words) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      col += token.length;
      continue;
    }
    // Hard-break tokens longer than a line (math / unbroken strings).
    if (token.length > cpl) {
      if (col > 0) {
        lines += 1;
        col = 0;
      }
      lines += Math.ceil(token.length / cpl);
      col = token.length % cpl;
      if (col === 0) col = 0;
      continue;
    }
    if (col > 0 && col + token.length > cpl) {
      lines += 1;
      col = token.length;
    } else {
      col += token.length;
    }
  }
  return Math.max(1, lines);
}

function countApproxWrappedLines(
  plain: string,
  contentWidth: number,
  fontSize: number,
): number {
  let lines = 0;
  for (const paragraph of plain.split('\n')) {
    lines += countWrappedLinesForParagraph(paragraph, contentWidth, fontSize);
  }
  return Math.max(1, lines);
}

function finalizeHeight(
  contentHeight: number,
  pad: number,
): number {
  return Math.min(
    TEXT_AUTO_SIZE_MAX_HEIGHT,
    Math.max(56, Math.ceil(contentHeight + pad * 2 + 4)),
  );
}

function estimatePlainLayout(
  plain: string,
  contentWidth: number,
  style: TextStyleConfig,
): { contentHeight: number; wrappedLines: number } {
  const lines = countApproxWrappedLines(plain, contentWidth, style.fontSize);
  const contentHeight = Math.ceil(lines * style.fontSize * style.lineHeight);
  return { contentHeight, wrappedLines: lines };
}

/**
 * Structured rich-text height estimate mirroring richTextToHtml margins/sizes.
 */
function estimateRichLayout(
  richText: RichTextDocument,
  contentWidth: number,
  style: TextStyleConfig,
): { contentHeight: number; wrappedLines: number } {
  let contentHeight = 0;
  let wrappedLines = 0;
  for (const block of richText.blocks) {
    if (block.type === 'display_math') {
      // Display equations: taller than body, with vertical spacing.
      const displaySize = style.fontSize * 1.15;
      const approxLines = Math.max(1.8, 1.2 + block.latex.length / 48);
      const blockH = approxLines * displaySize * 1.35 + style.fontSize * 1.3;
      contentHeight += blockH;
      wrappedLines += Math.ceil(approxLines);
      continue;
    }

    if (block.type === 'table') {
      const colCount = Math.max(block.columns.length, 1);
      const cellWidth = Math.max(40, contentWidth / colCount);
      let tableLines = 0;
      for (const row of block.rows) {
        let rowLines = 1;
        for (const cell of row.cells) {
          let text = '';
          for (const s of cell.spans) {
            if (s.type === 'inline_math') {
              text += 'M'.repeat(Math.max(2, Math.ceil(s.latex.length * 0.65)));
            } else {
              text += s.text;
            }
          }
          rowLines = Math.max(
            rowLines,
            countWrappedLinesForParagraph(text || ' ', cellWidth, style.fontSize),
          );
        }
        // Cell padding ≈ 0.8em vertical per row.
        tableLines += rowLines;
        contentHeight +=
          rowLines * style.fontSize * (style.lineHeight || 1.35) +
          style.fontSize * 0.8;
      }
      contentHeight += style.fontSize * 1.5; // table margins
      wrappedLines += Math.max(1, tableLines);
      continue;
    }

    // Approximate inline math width contribution for wrap estimates.
    let text = '';
    for (const s of block.spans) {
      if (s.type === 'inline_math') {
        text += 'M'.repeat(Math.max(2, Math.ceil(s.latex.length * 0.65)));
      } else {
        text += s.text;
      }
    }
    const spanSize = block.spans.reduce((max, s) => {
      if (s.type === 'inline_math') {
        return Math.max(max, style.fontSize * 1.1);
      }
      const sz = resolveRichTextFontSize(s.style?.font_size, style.fontSize);
      return Math.max(max, sz);
    }, style.fontSize);

    if (block.type === 'heading') {
      const headingSpan = block.spans.find((s) => s.type !== 'inline_math');
      const size = resolveRichTextFontSize(
        headingSpan && 'style' in headingSpan
          ? headingSpan.style?.font_size ?? 'heading'
          : 'heading',
        style.fontSize,
      );
      const lines = countWrappedLinesForParagraph(text, contentWidth, size);
      const lineH = size * 1.25;
      contentHeight += lines * lineH + size * 0.35; // margin-bottom 0.35em
      wrappedLines += lines;
      continue;
    }

    const listIndent = block.type === 'bullet' || block.type === 'numbered' ? 28 : 0;
    const innerW = Math.max(40, contentWidth - listIndent);
    const fontSize = Math.max(spanSize, style.fontSize);
    const lines = countWrappedLinesForParagraph(text || ' ', innerW, fontSize);
    const lineH = fontSize * (style.lineHeight || 1.35);
    const margin =
      block.type === 'paragraph' ? fontSize * 0.45 : fontSize * 0.2;
    contentHeight += lines * lineH + margin;
    wrappedLines += lines;
  }
  return {
    contentHeight: Math.ceil(contentHeight),
    wrappedLines: Math.max(1, wrappedLines),
  };
}

function tryDomContentHeight(host: HTMLElement): number {
  const rectH = host.getBoundingClientRect().height;
  const scrollH = host.scrollHeight;
  const offsetH = (host as HTMLElement).offsetHeight;
  return Math.ceil(Math.max(rectH, scrollH, offsetH, 0));
}

/**
 * Measure plain text height matching TextNode / textarea styling
 * (pre-wrap, word wrap, padding, font metrics).
 */
export function measurePlainTextHeight(
  text: string,
  width: number,
  style: TextStyleConfig,
): { height: number; contentHeight: number; wrappedLines: number | null; measuredWithDom: boolean } {
  const pad = Math.max(style.padding, 0);
  const contentWidth = Math.max(width - pad * 2, 40);
  const plain = text.replace(/\r\n/g, '\n');

  if (typeof document !== 'undefined') {
    const host = document.createElement('div');
    host.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'visibility:hidden',
      `width:${contentWidth}px`,
      'box-sizing:border-box',
      `font-size:${style.fontSize}px`,
      `font-family:${style.fontFamily}`,
      `font-weight:${style.fontWeight === 'bold' ? 700 : 400}`,
      `font-style:${style.fontItalic ? 'italic' : 'normal'}`,
      `text-decoration:${style.underline ? 'underline' : 'none'}`,
      `line-height:${style.lineHeight}`,
      `color:${style.color}`,
      'white-space:pre-wrap',
      'word-wrap:break-word',
      'overflow-wrap:anywhere',
      'margin:0',
      'padding:0',
    ].join(';');
    host.textContent = plain.length > 0 ? plain : ' ';
    document.body.appendChild(host);
    const domHeight = tryDomContentHeight(host);
    document.body.removeChild(host);

    // Real browsers return a positive layout height; stub DOMs (happy-dom) return 0.
    if (domHeight >= style.fontSize * 0.5) {
      const lineCount = Math.max(
        1,
        Math.round(domHeight / (style.fontSize * style.lineHeight)),
      );
      return {
        height: finalizeHeight(domHeight, pad),
        contentHeight: domHeight,
        wrappedLines: lineCount,
        measuredWithDom: true,
      };
    }
  }

  const estimated = estimatePlainLayout(plain, contentWidth, style);
  return {
    height: finalizeHeight(estimated.contentHeight, pad),
    contentHeight: estimated.contentHeight,
    wrappedLines: estimated.wrappedLines,
    measuredWithDom: false,
  };
}

function measureRichAtWidth(
  richText: RichTextDocument,
  width: number,
  style: TextStyleConfig,
): { height: number; contentHeight: number; wrappedLines: number | null; measuredWithDom: boolean } {
  const pad = Math.max(style.padding, 0);
  const contentWidth = Math.max(width - pad * 2, 40);

  if (typeof document !== 'undefined') {
    const host = document.createElement('div');
    host.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'visibility:hidden',
      `width:${contentWidth}px`,
      'box-sizing:border-box',
      // World-space base font — rich HTML uses em relative to this (never zoom).
      `font-size:${style.fontSize}px`,
      `font-family:${style.fontFamily}`,
      `color:${style.color}`,
      `line-height:${style.lineHeight}`,
    ].join(';');
    host.innerHTML = richTextToHtml(richText, {
      color: style.color,
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
    });
    document.body.appendChild(host);
    const domHeight = tryDomContentHeight(host);
    document.body.removeChild(host);

    if (domHeight >= style.fontSize * 0.5) {
      return {
        height: finalizeHeight(domHeight, pad),
        contentHeight: domHeight,
        wrappedLines: Math.max(
          1,
          Math.round(domHeight / (style.fontSize * (style.lineHeight || 1.35))),
        ),
        measuredWithDom: true,
      };
    }
  }

  const estimated = estimateRichLayout(richText, contentWidth, style);
  // Keep measureRichTextHeight as a floor so existing call sites stay consistent.
  const legacy = measureRichTextHeight(richText, width, {
    color: style.color,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    padding: pad,
    lineHeight: style.lineHeight,
  });
  const height = Math.max(finalizeHeight(estimated.contentHeight, pad), legacy);
  return {
    height: Math.min(height, TEXT_AUTO_SIZE_MAX_HEIGHT),
    contentHeight: Math.max(estimated.contentHeight, height - pad * 2),
    wrappedLines: estimated.wrappedLines,
    measuredWithDom: false,
  };
}

export class TextElementAutoSizer {
  /**
   * Measure required textbox size for content at a resolved width.
   * Does not mutate any document state.
   */
  static measure(input: {
    content: TextContentInput;
    /** When set, height is measured at this outer width. */
    availableWidth?: number;
    style: TextStyleConfig;
    limits?: TextWidthLimits;
    /** When false, still measures but marks autoSized false. */
    autoSized?: boolean;
  }): TextMeasureResult {
    const limits = input.limits ?? TEXT_AUTO_SIZE_WIDTH_DEFAULTS;
    const padding = Math.max(input.style.padding, 0);
    const preferredWidth = choosePreferredTextWidth(input.content, input.style, limits);
    // Explicit availableWidth (e.g. grid cell) is authoritative — do not clamp it
    // down to maxTextWidth, or height would disagree with the renderer.
    const width =
      input.availableWidth != null
        ? Math.max(40, input.availableWidth)
        : clamp(preferredWidth, limits.minWidth, limits.maxWidth);

    const style: TextStyleConfig = { ...input.style, padding };
    const measured = input.content.richText
      ? measureRichAtWidth(input.content.richText, width, style)
      : measurePlainTextHeight(input.content.text, width, style);

    return {
      width,
      height: measured.height,
      contentWidth: Math.max(width - padding * 2, 40),
      contentHeight: measured.contentHeight,
      padding,
      wrappedLines: measured.wrappedLines,
      measuredWithDom: measured.measuredWithDom,
      preferredWidth,
      autoSized: input.autoSized !== false,
    };
  }

  /** Height-only remasure at a known outer width (grid reflow). */
  static measureHeightAtWidth(
    content: TextContentInput,
    width: number,
    style: TextStyleConfig,
  ): number {
    return TextElementAutoSizer.measure({
      content,
      availableWidth: width,
      style,
    }).height;
  }
}

export function textElementIsAiManaged(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false;
  // Prefer explicit autoSize / AI creation — not merely lastEditedBy.
  return meta.autoSize === true || meta.createdBy === 'ai';
}

export function textElementIsUserResized(meta: Record<string, unknown> | undefined): boolean {
  return meta?.userResized === true;
}

/**
 * Whether AI updates may change width (and freely set height).
 * User-resized boxes keep their width; height still expands to avoid clipping.
 */
export function textElementAllowsAiAutoWidth(
  meta: Record<string, unknown> | undefined,
): boolean {
  return textElementIsAiManaged(meta) && !textElementIsUserResized(meta);
}

/**
 * Measure a TextElement including optional title + supplementary notes.
 * Comment popovers are overlays and do not expand persistent bounds.
 */
export function measureTextElementWithFeatures(
  el: Pick<
    TextElement,
    'text' | 'richText' | 'title' | 'notes' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'fontItalic' | 'underline' | 'lineHeight' | 'color' | 'padding' | 'width'
  >,
  opts?: { availableWidth?: number },
): TextMeasureResult {
  const style: TextStyleConfig = {
    fontSize: el.fontSize,
    fontFamily: el.fontFamily,
    fontWeight: el.fontWeight,
    fontItalic: el.fontItalic,
    underline: el.underline,
    lineHeight: el.lineHeight,
    color: el.color,
    padding: el.padding,
  };
  const body = TextElementAutoSizer.measure({
    content: { text: el.text, richText: el.richText },
    availableWidth: opts?.availableWidth ?? el.width,
    style,
  });

  let extra = 0;
  if (el.title?.text.trim()) {
    const titleSize = Math.round(el.fontSize * 1.35);
    const titleMeasure = measurePlainTextHeight(el.title.text, body.width, {
      ...style,
      fontSize: titleSize,
      fontWeight: 'bold',
      padding: 0,
    });
    extra += titleMeasure.contentHeight + TEXT_FEATURE_LAYOUT.titleGap;
  }

  const notes = sortedNotes(el as TextElement).filter((n) => n.layoutMode !== 'manual');
  if (notes.length > 0) {
    extra += TEXT_FEATURE_LAYOUT.noteSeparatorGap;
    const noteSize = Math.max(11, Math.round(el.fontSize * TEXT_FEATURE_LAYOUT.noteFontScale));
    for (const note of notes) {
      const nm = measurePlainTextHeight(note.text, body.width, {
        ...style,
        fontSize: noteSize,
        color: '#64748B',
        padding: 0,
      });
      extra += nm.contentHeight + TEXT_FEATURE_LAYOUT.noteGap;
    }
  }

  const height = Math.min(body.height + extra, TEXT_AUTO_SIZE_MAX_HEIGHT);
  return {
    ...body,
    height,
    contentHeight: Math.max(0, height - body.padding * 2),
  };
}
