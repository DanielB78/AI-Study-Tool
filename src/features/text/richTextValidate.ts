import {
  RICH_TEXT_LIMITS,
  RICH_TEXT_SIZE_PRESETS,
  type RichTextBlock,
  type RichTextBlockType,
  type RichTextDocument,
  type RichTextSizePreset,
  type RichTextSpan,
  type RichTextSpanStyle,
} from './richText';

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

function parseSpan(raw: unknown, path: string): RichTextSpan {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  if (typeof raw.text !== 'string') {
    throw new RichTextParseError(`${path}.text must be a string.`);
  }
  if (raw.text.length > RICH_TEXT_LIMITS.maxSpanChars) {
    throw new RichTextParseError(
      `${path}.text exceeds ${RICH_TEXT_LIMITS.maxSpanChars} characters.`,
    );
  }
  return {
    text: raw.text,
    style: parseStyle(raw.style, `${path}.style`),
  };
}

function parseBlock(raw: unknown, path: string): RichTextBlock {
  if (!isRecord(raw)) throw new RichTextParseError(`${path} must be an object.`);
  let type = raw.type;
  if (type === undefined && raw.role === 'heading') type = 'heading';
  if (typeof type !== 'string' || !BLOCK_TYPES.has(type as RichTextBlockType)) {
    throw new RichTextParseError(
      `${path}.type must be one of: paragraph, heading, bullet, numbered.`,
    );
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
  return { type: type as RichTextBlockType, spans };
}

/** Parse + validate LLM rich_text payload. */
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
  const total = blocks.reduce(
    (n, b) => n + b.spans.reduce((m, s) => m + s.text.length, 0),
    0,
  );
  if (total > RICH_TEXT_LIMITS.maxTotalChars) {
    throw new RichTextParseError(
      `rich_text total text exceeds ${RICH_TEXT_LIMITS.maxTotalChars} characters.`,
    );
  }
  if (total === 0) {
    throw new RichTextParseError('rich_text must contain non-empty text.');
  }
  return { blocks };
}
