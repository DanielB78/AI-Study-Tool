import { sanitizeLatexSource, validateLatex } from '../equations/latex';
import {
  RICH_TEXT_LIMITS,
  RICH_TEXT_SIZE_PRESETS,
  isDisplayMathBlock,
  isInlineMathSpan,
  type RichTextBlock,
  type RichTextBlockType,
  type RichTextDocument,
  type RichTextInlineMathSpan,
  type RichTextSizePreset,
  type RichTextSpan,
  type RichTextSpanStyle,
  type RichTextTextSpan,
} from './richText';
import { ensureBlockIds, ensureMathIds } from './textFeatures';

export class RichTextParseError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'RichTextParseError';
    this.detail = detail;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const BLOCK_TYPES = new Set<RichTextBlockType>([
  'paragraph',
  'heading',
  'bullet',
  'numbered',
  'display_math',
]);

function parseStyle(raw: unknown, path: string): RichTextSpanStyle | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    throw new RichTextParseError(`${path} must be an object.`);
  }
  const style: RichTextSpanStyle = {};
  if (raw.bold !== undefined) {
    if (typeof raw.bold !== 'boolean') throw new RichTextParseError(`${path}.bold must be boolean.`);
    style.bold = raw.bold;
  }
  if (raw.italic !== undefined) {
    if (typeof raw.italic !== 'boolean') {
      throw new RichTextParseError(`${path}.italic must be boolean.`);
    }
    style.italic = raw.italic;
  }
  if (raw.underline !== undefined) {
    if (typeof raw.underline !== 'boolean') {
      throw new RichTextParseError(`${path}.underline must be boolean.`);
    }
    style.underline = raw.underline;
  }
  if (raw.color !== undefined) {
    if (typeof raw.color !== 'string' || !raw.color.trim()) {
      throw new RichTextParseError(`${path}.color must be a non-empty string.`);
    }
    style.color = raw.color.trim();
  }
  if (raw.highlight_color !== undefined) {
    if (typeof raw.highlight_color !== 'string' || !raw.highlight_color.trim()) {
      throw new RichTextParseError(`${path}.highlight_color must be a non-empty string.`);
    }
    style.highlight_color = raw.highlight_color.trim();
  }
  if (raw.linked_comment_id !== undefined) {
    if (typeof raw.linked_comment_id !== 'string' || !raw.linked_comment_id.trim()) {
      throw new RichTextParseError(`${path}.linked_comment_id must be a non-empty string.`);
    }
    style.linked_comment_id = raw.linked_comment_id.trim();
  }
  if (raw.font_size !== undefined) {
    if (typeof raw.font_size === 'string') {
      if (!(raw.font_size in RICH_TEXT_SIZE_PRESETS)) {
        throw new RichTextParseError(
          `${path}.font_size preset must be one of: ${Object.keys(RICH_TEXT_SIZE_PRESETS).join(', ')}.`,
        );
      }
      style.font_size = raw.font_size as RichTextSizePreset;
    } else if (typeof raw.font_size === 'number' && Number.isFinite(raw.font_size)) {
      style.font_size = raw.font_size;
    } else {
      throw new RichTextParseError(`${path}.font_size must be a preset name or number.`);
    }
  }
  return style;
}

function parseMathChromeStyle(
  raw: unknown,
  path: string,
): RichTextInlineMathSpan['style'] | undefined {
  const full = parseStyle(raw, path);
  if (!full) return undefined;
  const style: RichTextInlineMathSpan['style'] = {};
  if (full.color !== undefined) style.color = full.color;
  if (full.highlight_color !== undefined) style.highlight_color = full.highlight_color;
  if (full.linked_comment_id !== undefined) {
    style.linked_comment_id = full.linked_comment_id;
  }
  return Object.keys(style).length ? style : undefined;
}

function parseLatexField(raw: unknown, path: string, displayMode: boolean): string {
  if (typeof raw !== 'string') {
    throw new RichTextParseError(`${path} must be a string.`);
  }
  const latex = sanitizeLatexSource(raw);
  if (!latex) {
    throw new RichTextParseError(`${path} must be non-empty LaTeX.`);
  }
  if (latex.length > RICH_TEXT_LIMITS.maxLatexChars) {
    throw new RichTextParseError(
      `${path} exceeds ${RICH_TEXT_LIMITS.maxLatexChars} characters.`,
    );
  }
  const check = validateLatex(latex, displayMode);
  if (!check.ok) {
    throw new RichTextParseError(`${path} is invalid LaTeX: ${check.error ?? 'unknown error'}`);
  }
  return latex;
}

function parseSpan(raw: unknown, path: string): RichTextSpan {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);

  const spanType = raw.type;
  if (spanType === 'inline_math') {
    const latex = parseLatexField(raw.latex, `${path}.latex`, false);
    const id =
      typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;
    return {
      type: 'inline_math',
      latex,
      ...(id ? { id } : {}),
      style: parseMathChromeStyle(raw.style, `${path}.style`),
    };
  }

  // Legacy / text spans: type omitted or type === 'text'
  if (spanType !== undefined && spanType !== 'text') {
    throw new RichTextParseError(
      `${path}.type must be "text" or "inline_math" when present.`,
    );
  }
  if (typeof raw.text !== 'string') {
    throw new RichTextParseError(`${path}.text must be a string.`);
  }
  if (raw.text.length > RICH_TEXT_LIMITS.maxSpanChars) {
    throw new RichTextParseError(
      `${path}.text exceeds ${RICH_TEXT_LIMITS.maxSpanChars} characters.`,
    );
  }
  const textSpan: RichTextTextSpan = {
    text: raw.text,
    style: parseStyle(raw.style, `${path}.style`),
  };
  if (spanType === 'text') textSpan.type = 'text';
  return textSpan;
}

function parseBlock(raw: unknown, path: string): RichTextBlock {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  let type = raw.type;
  if (type === undefined && raw.role === 'heading') type = 'heading';
  if (typeof type !== 'string' || !BLOCK_TYPES.has(type as RichTextBlockType)) {
    throw new RichTextParseError(
      `${path}.type must be one of: paragraph, heading, bullet, numbered, display_math.`,
    );
  }

  const id =
    typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : undefined;

  if (type === 'display_math') {
    const latex = parseLatexField(raw.latex, `${path}.latex`, true);
    return {
      type: 'display_math',
      latex,
      spans: [],
      ...(id ? { id } : {}),
    };
  }

  if (!Array.isArray(raw.spans) || raw.spans.length === 0) {
    throw new RichTextParseError(`${path}.spans must be a non-empty array.`);
  }
  if (raw.spans.length > RICH_TEXT_LIMITS.maxSpansPerBlock) {
    throw new RichTextParseError(
      `${path}.spans exceeds ${RICH_TEXT_LIMITS.maxSpansPerBlock}.`,
    );
  }
  const spans = raw.spans.map((s, i) => parseSpan(s, `${path}.spans[${i}]`));
  return {
    type: type as Exclude<RichTextBlockType, 'display_math'>,
    spans,
    ...(id ? { id } : {}),
  };
}

function totalPlainChars(doc: RichTextDocument): number {
  let total = 0;
  for (const block of doc.blocks) {
    if (isDisplayMathBlock(block)) {
      total += block.latex.length;
      continue;
    }
    for (const span of block.spans) {
      if (isInlineMathSpan(span)) total += span.latex.length;
      else total += span.text.length;
    }
  }
  return total;
}

/** Parse + validate LLM rich_text payload. Assigns stable block/math ids when missing. */
export function parseRichTextDocument(raw: unknown): RichTextDocument {
  if (!isRecord(raw)) {
    throw new RichTextParseError('rich_text must be an object with blocks.');
  }
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    throw new RichTextParseError('rich_text.blocks must be a non-empty array.');
  }
  if (raw.blocks.length > RICH_TEXT_LIMITS.maxBlocks) {
    throw new RichTextParseError(
      `rich_text.blocks exceeds ${RICH_TEXT_LIMITS.maxBlocks}.`,
    );
  }
  const blocks = raw.blocks.map((b, i) => parseBlock(b, `rich_text.blocks[${i}]`));
  const total = totalPlainChars({ blocks });
  if (total > RICH_TEXT_LIMITS.maxTotalChars) {
    throw new RichTextParseError(
      `rich_text total text exceeds ${RICH_TEXT_LIMITS.maxTotalChars} characters.`,
    );
  }
  if (total === 0) {
    throw new RichTextParseError('rich_text must contain non-empty text.');
  }
  return ensureMathIds(ensureBlockIds({ blocks }));
}
