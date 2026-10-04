import type { GraphElement } from '../../types/canvas';
import { createBaseFields, createId } from '../../utils/ids';
import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_SETTINGS,
  DEFAULT_GRAPH_VIEWPORT,
  DEFAULT_GRAPH_WIDTH,
  nextExpressionColor,
  type GraphExpression,
  type GraphPoint,
} from './types';

export function createEmptyGraphExpression(
  index = 0,
  sourceText = '',
): GraphExpression {
  return {
    id: createId(),
    sourceText,
    visible: true,
    domainMin: null,
    domainMax: null,
    style: {
      color: nextExpressionColor(index),
      strokeWidth: 2,
    },
  };
}

export function createGraphPoint(
  x: number,
  y: number,
  label = '',
  color = '#111827',
): GraphPoint {
  return {
    id: createId(),
    x,
    y,
    visible: true,
    label,
    color,
  };
}

export function createGraphElement(options: {
  x: number;
  y: number;
  zIndex: number;
  width?: number;
  height?: number;
  opacity?: number;
}): GraphElement {
  const width = options.width ?? DEFAULT_GRAPH_WIDTH;
  const height = options.height ?? DEFAULT_GRAPH_HEIGHT;
  return {
    ...createBaseFields({
      x: options.x,
      y: options.y,
      width,
      height,
      zIndex: options.zIndex,
      opacity: options.opacity ?? 1,
    }),
    type: 'graph',
    expressions: [],
    points: [],
    viewport: { ...DEFAULT_GRAPH_VIEWPORT },
    settings: { ...DEFAULT_GRAPH_SETTINGS },
  };
}
