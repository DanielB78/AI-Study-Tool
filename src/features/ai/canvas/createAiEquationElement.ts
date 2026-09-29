import type { EquationElement, StyleDefaults } from '../../../types/canvas';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { createBaseFields } from '../../../utils/ids';
import {
  EQUATION_DEFAULT_FONT_SIZE,
  measureEquationSize,
  sanitizeLatexSource,
} from '../../equations/latex';

export interface AiEquationDefaults {
  style?: StyleDefaults;
  fontSize?: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

/** Build a normal EquationElement for AI / toolbar creation. */
export function createAiEquationElement(
  latex: string,
  position: { x: number; y: number },
  options: AiEquationDefaults & { zIndex: number },
): EquationElement {
  const style = options.style ?? DEFAULT_STYLE;
  const fontSize = options.fontSize ?? EQUATION_DEFAULT_FONT_SIZE;
  const color = options.color ?? style.textColor;
  const cleaned = sanitizeLatexSource(latex);
  const size = measureEquationSize(cleaned, { fontSize, displayMode: true });

  const base = createBaseFields({
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    zIndex: options.zIndex,
    opacity: style.opacity,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      operation: 'create_equation',
      ...(options.metadata ?? {}),
    },
  });

  return {
    ...base,
    type: 'equation',
    latex: cleaned,
    fontSize,
    color,
    displayMode: 'display',
  };
}
