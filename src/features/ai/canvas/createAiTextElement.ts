import type { StyleDefaults, TextElement } from '../../../types/canvas';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { createBaseFields } from '../../../utils/ids';
import { AI_TEXT_DEFAULT_WIDTH } from './placement';

export interface AiTextDefaults {
  width?: number;
  style?: StyleDefaults;
  metadata?: Record<string, unknown>;
}

/**
 * Approximate wrapped text height without depending on Konva measurement.
 * Good enough for initial placement; users can resize afterward.
 */
export function estimateTextHeight(
  text: string,
  width: number,
  style: Pick<StyleDefaults, 'fontSize' | 'lineHeight' | 'textPadding'>,
): number {
  const padding = style.textPadding;
  const contentWidth = Math.max(width - padding * 2, 40);
  const avgCharWidth = style.fontSize * 0.52;
  const charsPerLine = Math.max(1, Math.floor(contentWidth / avgCharWidth));

  const paragraphs = text.replace(/\r\n/g, '\n').split('\n');
  let lines = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines += 1;
      continue;
    }
    lines += Math.max(1, Math.ceil(paragraph.length / charsPerLine));
  }

  const contentHeight = lines * style.fontSize * style.lineHeight;
  return Math.max(56, Math.ceil(contentHeight + padding * 2 + 4));
}

/** Build a normal TextElement for an AI chat response (same type as user text). */
export function createAiTextElement(
  text: string,
  position: { x: number; y: number },
  options: AiTextDefaults & { zIndex: number },
): TextElement {
  const style = options.style ?? DEFAULT_STYLE;
  const width = options.width ?? AI_TEXT_DEFAULT_WIDTH;
  const padding = Math.max(style.textPadding, 12);
  const height = estimateTextHeight(text, width, {
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    textPadding: padding,
  });

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
      ...(options.metadata ?? {}),
    },
  });

  return {
    ...base,
    type: 'text',
    text,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontItalic: style.fontItalic,
    underline: style.underline,
    strikethrough: style.strikethrough,
    color: style.textColor,
    alignment: style.textAlignment,
    lineHeight: style.lineHeight,
    // Light readable note card — user can restyle via contextual toolbar.
    backgroundColor: style.textBackgroundColor ?? '#ffffff',
    padding,
    cornerRadius: Math.max(style.textCornerRadius, 10),
  };
}
