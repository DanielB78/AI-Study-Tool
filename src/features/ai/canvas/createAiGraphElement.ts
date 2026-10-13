/**
 * Build a normal GraphElement from a validated create_graph operation.
 * Same model as human-created graphs — not an AI-only representation.
 *
 * Code-style mathematical syntax is a DSL, not executable code.
 * Expressions must already be validated via GraphExpressionCodec (strict).
 */

import type { GraphElement } from '../../../types/canvas';
import type { CreateGraphOperation } from '../agent/operations';
import {
  createEmptyGraphExpression,
  createGraphElement,
  createGraphPoint,
} from '../../graphs/createGraphElement';
import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
  type GraphSettings,
  type GraphViewport,
} from '../../graphs/types';

export interface AiGraphCreateOptions {
  x: number;
  y: number;
  zIndex: number;
  width?: number;
  height?: number;
  metadata?: Record<string, unknown>;
}

function toViewport(op: CreateGraphOperation['viewport']): GraphViewport {
  return {
    xMin: op.x_min,
    xMax: op.x_max,
    yMin: op.y_min,
    yMax: op.y_max,
  };
}

function toSettings(op: CreateGraphOperation['settings']): GraphSettings {
  return {
    title: op.title?.trim() ?? '',
    xAxisLabel: op.x_axis_label?.trim() ?? '',
    yAxisLabel: op.y_axis_label?.trim() ?? '',
    showGrid: op.show_grid,
    showXAxis: op.show_x_axis,
    showYAxis: op.show_y_axis,
    legendVisibility: 'auto',
  };
}

/**
 * Map a validated CreateGraphOperation onto a GraphElement at a placed origin.
 * `canonicalExpressions` must match op.expressions length (strict codec output).
 */
export function createAiGraphElement(
  op: CreateGraphOperation,
  canonicalExpressions: readonly string[],
  options: AiGraphCreateOptions,
): GraphElement {
  if (canonicalExpressions.length !== op.expressions.length) {
    throw new Error('canonicalExpressions length must match create_graph expressions.');
  }

  const base = createGraphElement({
    x: options.x,
    y: options.y,
    zIndex: options.zIndex,
    width: options.width ?? DEFAULT_GRAPH_WIDTH,
    height: options.height ?? DEFAULT_GRAPH_HEIGHT,
  });

  const expressions = op.expressions.map((spec, index) => {
    const expr = createEmptyGraphExpression(
      index,
      canonicalExpressions[index]!,
      spec.label?.trim() ?? '',
    );
    return {
      ...expr,
      visible: spec.visible,
      domainMin: spec.domain_min,
      domainMax: spec.domain_max,
    };
  });

  const points = op.points.map((p) => {
    const point = createGraphPoint(p.x, p.y, p.label, '#111827');
    return { ...point, visible: p.visible };
  });

  return {
    ...base,
    expressions,
    points,
    viewport: toViewport(op.viewport),
    settings: toSettings(op.settings),
    metadata: {
      ...base.metadata,
      createdBy: 'ai',
      source: 'agent',
      operation: 'create_graph',
      ...(options.metadata ?? {}),
    },
  };
}
