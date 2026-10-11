import type { StyleDefaults, TextElement } from '../../../types/canvas';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { createBaseFields } from '../../../utils/ids';
import type { RichTextDocument } from '../../text/richText';
import { richTextToPlainText } from '../../text/richText';
import {
  TextElementAutoSizer,
  type TextMeasureResult,
  type TextStyleConfig,
} from '../../text/textAutoSizer';

export interface AiTextDefaults {
  width?: number;
  style?: StyleDefaults;
  metadata?: Record<string, unknown>;
  richText?: RichTextDocument;
  /** When false, skip autoSize metadata (rare). Default true for AI creates. */
  autoSize?: boolean;
}

function styleConfigFrom(
  style: StyleDefaults,
  padding: number,
): TextStyleConfig {
  return {
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontItalic: style.fontItalic,
    underline: style.underline,
    lineHeight: style.lineHeight,
    color: style.textColor,
    padding,
  };
}

/**
 * @deprecated Prefer TextElementAutoSizer — kept for tests comparing legacy estimates.
 */
export function estimateTextHeight(
  text: string,
  width: number,
  style: Pick<StyleDefaults, 'fontSize' | 'lineHeight' | 'textPadding'>,
): number {
  return TextElementAutoSizer.measureHeightAtWidth(
    { text },
    width,
    {
      fontSize: style.fontSize,
      fontFamily: 'Arial, Helvetica, sans-serif',
      lineHeight: style.lineHeight,
      color: '#1a1a1a',
      padding: style.textPadding,
    },
  );
}

/** Measure content height at a given outer width (plain or rich). */
export function estimateContentHeight(
  text: string,
  width: number,
  style: Pick<StyleDefaults, 'fontSize' | 'lineHeight' | 'textPadding' | 'fontFamily' | 'textColor'> & {
    fontWeight?: StyleDefaults['fontWeight'];
    fontItalic?: boolean;
    underline?: boolean;
  },
  richText?: RichTextDocument,
): number {
  const padding = Math.max(style.textPadding, 12);
  return TextElementAutoSizer.measureHeightAtWidth(
    { text, richText },
    width,
    {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontItalic: style.fontItalic,
      underline: style.underline,
      lineHeight: style.lineHeight,
      color: style.textColor,
      padding,
    },
  );
}

export function measureAiTextSize(
  text: string,
  options: {
    width?: number;
    style?: StyleDefaults;
    richText?: RichTextDocument;
  } = {},
): TextMeasureResult {
  const style = options.style ?? DEFAULT_STYLE;
  const padding = Math.max(style.textPadding, 12);
  return TextElementAutoSizer.measure({
    content: { text, richText: options.richText },
    availableWidth: options.width,
    style: styleConfigFrom(style, padding),
    autoSized: true,
  });
}

/** Build a normal TextElement for an AI chat response (same type as user text). */
export function createAiTextElement(
  text: string,
  position: { x: number; y: number },
  options: AiTextDefaults & { zIndex: number },
): TextElement {
  const style = options.style ?? DEFAULT_STYLE;
  const padding = Math.max(style.textPadding, 12);
  const richText = options.richText;
  const plain = richText ? richTextToPlainText(richText) : text;
  const autoSize = options.autoSize !== false;
  const measured = TextElementAutoSizer.measure({
    content: { text: plain, richText },
    availableWidth: options.width,
    style: styleConfigFrom(style, padding),
    autoSized: autoSize,
  });
  const width = measured.width;
  const height = measured.height;

  const base = createBaseFields({
    x: position.x,
    y: position.y,
    width,
    height,
    zIndex: options.zIndex,
    opacity: style.opacity,
    metadata: {
      createdBy: 'ai',
      source: 'chat',
      autoSize,
      ...(options.metadata ?? {}),
    },
  });

  return {
    ...base,
    type: 'text',
    text: plain,
    ...(richText ? { richText } : {}),
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontItalic: style.fontItalic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    color: style.textColor,
    alignment: style.textAlignment,
    lineHeight: style.lineHeight,
    backgroundColor: style.textBackgroundColor ?? '#ffffff',
    padding,
    cornerRadius: Math.max(style.textCornerRadius, 10),
  };
}
