import { sanitizeLatexSource, validateLatex } from '../equations/latex';
import {
  RICH_TEXT_LIMITS,
  RICH_TEXT_SIZE_PRESETS,
  isCodeBlock,
  isDisplayMathBlock,
  isInlineCodeSpan,
  isInlineMathSpan,
  isTableBlock,
  type RichTextBlock,
  type RichTextBlockType,
  type RichTextCodeBlock,
  type RichTextDocument,
  type RichTextInlineCodeSpan,
  type RichTextInlineMathSpan,
  type RichTextSizePreset,
  type RichTextSpan,
  type RichTextSpanStyle,
  type RichTextTableAlignment,
  type RichTextTableBlock,
  type RichTextTableCell,
  type RichTextTableRow,
  type RichTextTextSpan,
} from './richText';
import { normalizeCodeLanguage } from './syntaxHighlight';
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
  'table',
  'code_block',
  'blockquote',
]);

const TABLE_ALIGNMENTS = new Set<RichTextTableAlignment>([
  'left',
  'center',
  'right',
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

  if (spanType === 'inline_code') {
    if (typeof raw.text !== 'string') {
      throw new RichTextParseError(`${path}.text must be a string.`);
    }
    if (raw.text.length > RICH_TEXT_LIMITS.maxSpanChars) {
      throw new RichTextParseError(
        `${path}.text exceeds ${RICH_TEXT_LIMITS.maxSpanChars} characters.`,
      );
    }
    const codeSpan: RichTextInlineCodeSpan = {
      type: 'inline_code',
      text: raw.text,
      style: parseMathChromeStyle(raw.style, `${path}.style`),
    };
    return codeSpan;
  }

  // Legacy / text spans: type omitted or type === 'text'
  if (spanType !== undefined && spanType !== 'text') {
    throw new RichTextParseError(
      `${path}.type must be "text", "inline_math", or "inline_code" when present.`,
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

function parseCodeBlock(
  raw: Record<string, unknown>,
  path: string,
  id?: string,
): RichTextCodeBlock {
  if (typeof raw.code !== 'string') {
    throw new RichTextParseError(`${path}.code must be a string.`);
  }
  if (raw.code.length > RICH_TEXT_LIMITS.maxCodeBlockChars) {
    throw new RichTextParseError(
      `${path}.code exceeds ${RICH_TEXT_LIMITS.maxCodeBlockChars} characters.`,
    );
  }
  let language: string | null = null;
  if (raw.language !== undefined && raw.language !== null) {
    if (typeof raw.language !== 'string') {
      throw new RichTextParseError(`${path}.language must be a string or null.`);
    }
    language = normalizeCodeLanguage(raw.language);
  }
  return {
    type: 'code_block',
    code: raw.code,
    language,
    ...(id ? { id } : {}),
  };
}

function parseTableCell(raw: unknown, path: string): RichTextTableCell {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  if (!Array.isArray(raw.spans)) {
    throw new RichTextParseError(`${path}.spans must be an array.`);
  }
  if (raw.spans.length > RICH_TEXT_LIMITS.maxSpansPerBlock) {
    throw new RichTextParseError(
      `${path}.spans exceeds ${RICH_TEXT_LIMITS.maxSpansPerBlock}.`,
    );
  }
  const spans =
    raw.spans.length === 0
      ? ([{ text: '' }] as RichTextSpan[])
      : raw.spans.map((s, i) => parseSpan(s, `${path}.spans[${i}]`));
  return { spans };
}

function parseTableRow(raw: unknown, path: string): RichTextTableRow {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  if (!Array.isArray(raw.cells) || raw.cells.length === 0) {
    throw new RichTextParseError(`${path}.cells must be a non-empty array.`);
  }
  if (raw.cells.length > RICH_TEXT_LIMITS.maxTableCols) {
    throw new RichTextParseError(
      `${path}.cells exceeds ${RICH_TEXT_LIMITS.maxTableCols} columns.`,
    );
  }
  const cells = raw.cells.map((c, i) => parseTableCell(c, `${path}.cells[${i}]`));
  const row: RichTextTableRow = { cells };
  if (raw.header !== undefined) {
    if (typeof raw.header !== 'boolean') {
      throw new RichTextParseError(`${path}.header must be boolean.`);
    }
    if (raw.header) row.header = true;
  }
  return row;
}

function parseTableBlock(raw: Record<string, unknown>, path: string, id?: string): RichTextTableBlock {
  if (!Array.isArray(raw.columns) || raw.columns.length === 0) {
    throw new RichTextParseError(`${path}.columns must be a non-empty array.`);
  }
  if (raw.columns.length > RICH_TEXT_LIMITS.maxTableCols) {
    throw new RichTextParseError(
      `${path}.columns exceeds ${RICH_TEXT_LIMITS.maxTableCols}.`,
    );
  }
  const columns = raw.columns.map((col, i) => {
    if (!isRecord(col)) {
      throw new RichTextParseError(`${path}.columns[${i}] must be an object.`);
    }
    const alignment = col.alignment ?? 'left';
    if (
      typeof alignment !== 'string' ||
      !TABLE_ALIGNMENTS.has(alignment as RichTextTableAlignment)
    ) {
      throw new RichTextParseError(
        `${path}.columns[${i}].alignment must be left, center, or right.`,
      );
    }
    return { alignment: alignment as RichTextTableAlignment };
  });

  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    throw new RichTextParseError(`${path}.rows must be a non-empty array.`);
  }
  if (raw.rows.length > RICH_TEXT_LIMITS.maxTableRows) {
    throw new RichTextParseError(
      `${path}.rows exceeds ${RICH_TEXT_LIMITS.maxTableRows}.`,
    );
  }
  const rows = raw.rows.map((r, i) => parseTableRow(r, `${path}.rows[${i}]`));
  return {
    type: 'table',
    columns,
    rows,
    ...(id ? { id } : {}),
  };
}

function parseBlock(raw: unknown, path: string): RichTextBlock {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  let type = raw.type;
  if (type === undefined && raw.role === 'heading') type = 'heading';
  if (typeof type !== 'string' || !BLOCK_TYPES.has(type as RichTextBlockType)) {
    throw new RichTextParseError(
      `${path}.type must be one of: paragraph, heading, bullet, numbered, display_math, table, code_block, blockquote.`,
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

  if (type === 'table') {
    return parseTableBlock(raw, path, id);
  }

  if (type === 'code_block') {
    return parseCodeBlock(raw, path, id);
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

  let depth: number | undefined;
  if (raw.depth !== undefined) {
    if (typeof raw.depth !== 'number' || !Number.isFinite(raw.depth)) {
      throw new RichTextParseError(`${path}.depth must be a finite number.`);
    }
    const maxDepth =
      type === 'blockquote'
        ? RICH_TEXT_LIMITS.maxQuoteDepth
        : RICH_TEXT_LIMITS.maxListDepth;
    depth = Math.max(0, Math.min(maxDepth, Math.round(raw.depth)));
  }

  let start: number | undefined;
  if (raw.start !== undefined) {
    if (typeof raw.start !== 'number' || !Number.isFinite(raw.start)) {
      throw new RichTextParseError(`${path}.start must be a finite number.`);
    }
    start = Math.max(1, Math.round(raw.start));
  }

  return {
    type: type as Exclude<
      RichTextBlockType,
      'display_math' | 'table' | 'code_block'
    >,
    spans,
    ...(id ? { id } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(start !== undefined && type === 'numbered' ? { start } : {}),
  };
}

function spanCharCount(span: RichTextSpan): number {
  if (isInlineMathSpan(span)) return span.latex.length;
  return span.text.length;
}

function totalPlainChars(doc: RichTextDocument): number {
  let total = 0;
  for (const block of doc.blocks) {
    if (isDisplayMathBlock(block)) {
      total += block.latex.length;
      continue;
    }
    if (isTableBlock(block)) {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const span of cell.spans) total += spanCharCount(span);
        }
      }
      continue;
    }
    if (isCodeBlock(block)) {
      total += block.code.length;
      continue;
    }
    for (const span of block.spans) total += spanCharCount(span);
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
