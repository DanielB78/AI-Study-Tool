/**
 * Structured rich text for TextElements.
 * Plain `text` on TextElement remains the RAG / legacy extract.
 *
 * Mathematical expressions are first-class nodes:
 * - inline_math spans participate in paragraph flow
 * - display_math blocks are dedicated centred equation blocks
 * Both store original LaTeX source (never rendered image bytes).
 */

export type RichTextColorName =
  | 'default'
  | 'blue'
  | 'green'
  | 'red'
  | 'orange'
  | 'purple'
  | 'grey';

export type RichTextSizePreset =
  | 'heading_large'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'small';

export type RichTextSpanStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Named palette or #RRGGBB */
  color?: RichTextColorName | string;
  /** Ordinary semantic/manual highlight (named palette or #RRGGBB). */
  highlight_color?: RichTextColorName | string;
  /**
   * Linked-comment mark — coexists with highlight_color.
   * Comment highlights must not overwrite ordinary highlights.
   */
  linked_comment_id?: string;
  /** Preset name or numeric px (validated/capped) */
  font_size?: RichTextSizePreset | number;
};

/** Ordinary text run (legacy spans omit `type`). */
export type RichTextTextSpan = {
  type?: 'text';
  text: string;
  style?: RichTextSpanStyle;
};

/** Atomic inline LaTeX expression embedded in a paragraph/list/heading. */
export type RichTextInlineMathSpan = {
  type: 'inline_math';
  /** Stable id assigned on parse/normalize when missing. */
  id?: string;
  latex: string;
  /** Optional chrome styles (color / highlight / comment mark). */
  style?: Pick<
    RichTextSpanStyle,
    'color' | 'highlight_color' | 'linked_comment_id'
  >;
};

export type RichTextSpan = RichTextTextSpan | RichTextInlineMathSpan;

export type RichTextBlockType =
  | 'paragraph'
  | 'heading'
  | 'bullet'
  | 'numbered'
  | 'display_math';

export type RichTextContentBlockType = Exclude<RichTextBlockType, 'display_math'>;

export type RichTextContentBlock = {
  /**
   * Stable block id for headings / comment anchors.
   * Assigned on parse/normalize when missing (backward compatible).
   */
  id?: string;
  type: RichTextContentBlockType;
  /** Optional role hint for paragraphs (e.g. heading) — normalized into type. */
  role?: 'heading' | 'body';
  spans: RichTextSpan[];
};

/** Dedicated block-level LaTeX equation (display style, centred). */
export type RichTextDisplayMathBlock = {
  id?: string;
  type: 'display_math';
  latex: string;
  /** Always empty — display math has no text spans. */
  spans: [];
};

export type RichTextBlock = RichTextContentBlock | RichTextDisplayMathBlock;

export type RichTextDocument = {
  blocks: RichTextBlock[];
};

export const RICH_TEXT_COLOR_PALETTE: Record<RichTextColorName, string> = {
  default: '#1a1a1a',
  blue: '#2563EB',
  green: '#16A34A',
  red: '#DC2626',
  orange: '#EA580C',
  purple: '#7C3AED',
  grey: '#64748B',
};

export const RICH_TEXT_HIGHLIGHT_PALETTE: Record<RichTextColorName, string> = {
  default: '#FEF08A',
  blue: '#BFDBFE',
  green: '#BBF7D0',
  red: '#FECACA',
  orange: '#FED7AA',
  purple: '#DDD6FE',
  grey: '#E2E8F0',
};

export const RICH_TEXT_SIZE_PRESETS: Record<RichTextSizePreset, number> = {
  heading_large: 28,
  heading: 22,
  subheading: 18,
  body: 16,
  small: 13,
};

export const RICH_TEXT_LIMITS = {
  maxBlocks: 80,
  maxSpansPerBlock: 40,
  maxSpanChars: 4000,
  maxTotalChars: 20000,
  maxLatexChars: 2000,
  minFontSize: 10,
  maxFontSize: 48,
} as const;

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isInlineMathSpan(span: RichTextSpan): span is RichTextInlineMathSpan {
  return span.type === 'inline_math';
}

export function isTextSpan(span: RichTextSpan): span is RichTextTextSpan {
  return span.type !== 'inline_math';
}

export function isDisplayMathBlock(
  block: RichTextBlock,
): block is RichTextDisplayMathBlock {
  return block.type === 'display_math';
}

/** Searchable plain extract for one math node — used by RAG / anchors. */
export function latexPlainExtract(latex: string): string {
  return `[LaTeX: ${latex}]`;
}

/** Plain-text contribution of a single span (math → searchable token). */
export function spanPlainText(span: RichTextSpan): string {
  if (isInlineMathSpan(span)) return latexPlainExtract(span.latex);
  return span.text;
}

export function resolveRichTextColor(
  value: string | undefined,
  kind: 'text' | 'highlight',
  fallback: string,
): string {
  if (!value) return fallback;
  if (value in RICH_TEXT_COLOR_PALETTE) {
    return kind === 'highlight'
      ? RICH_TEXT_HIGHLIGHT_PALETTE[value as RichTextColorName]
      : RICH_TEXT_COLOR_PALETTE[value as RichTextColorName];
  }
  if (HEX_RE.test(value)) {
    if (value.length === 4) {
      const r = value[1]!;
      const g = value[2]!;
      const b = value[3]!;
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
    return value.toUpperCase();
  }
  return fallback;
}

export function resolveRichTextFontSize(
  value: RichTextSizePreset | number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && value in RICH_TEXT_SIZE_PRESETS) {
    return RICH_TEXT_SIZE_PRESETS[value];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(
      RICH_TEXT_LIMITS.maxFontSize,
      Math.max(RICH_TEXT_LIMITS.minFontSize, Math.round(value)),
    );
  }
  return fallback;
}

/** Plain-text extract for RAG / legacy — reading order, no style metadata. */
export function richTextToPlainText(doc: RichTextDocument): string {
  const lines: string[] = [];
  for (const block of doc.blocks) {
    if (isDisplayMathBlock(block)) {
      lines.push(latexPlainExtract(block.latex));
      continue;
    }
    const content = block.spans.map(spanPlainText).join('');
    lines.push(content);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

export function plainTextToRichText(text: string): RichTextDocument {
  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  return {
    blocks: paragraphs.map((line) => ({
      type: 'paragraph' as const,
      spans: [{ text: line }],
    })),
  };
}

/** Effective document: richText if present, else wrap plain text. */
export function getRichTextDocument(el: {
  text: string;
  richText?: RichTextDocument | null;
}): RichTextDocument {
  if (el.richText && el.richText.blocks.length > 0) return el.richText;
  return plainTextToRichText(el.text);
}

export function isPlainRichText(doc: RichTextDocument): boolean {
  return doc.blocks.every(
    (b) =>
      b.type === 'paragraph' &&
      b.spans.every(
        (s) =>
          isTextSpan(s) &&
          (!s.style ||
            Object.values(s.style).every((v) => v === undefined || v === false)),
      ),
  );
}

/** Create an inline math span (id optional — assigned on normalize). */
export function createInlineMathSpan(
  latex: string,
  options?: { id?: string; style?: RichTextInlineMathSpan['style'] },
): RichTextInlineMathSpan {
  return {
    type: 'inline_math',
    latex,
    ...(options?.id ? { id: options.id } : {}),
    ...(options?.style ? { style: options.style } : {}),
  };
}

/** Create a display math block (id optional — assigned on normalize). */
export function createDisplayMathBlock(
  latex: string,
  options?: { id?: string },
): RichTextDisplayMathBlock {
  return {
    type: 'display_math',
    latex,
    spans: [],
    ...(options?.id ? { id: options.id } : {}),
  };
}
