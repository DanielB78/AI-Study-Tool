/**
 * Parse + apply helpers for GraphElement edit operations.
 * Expressions go through GraphExpressionCodec (strict) — never eval.
 */

import type { GraphElement } from '../../../types/canvas';
import { encodeGraphExpression } from '../../graphs/expressionCodec';
import {
  createEmptyGraphExpression,
  createGraphPoint,
} from '../../graphs/createGraphElement';
import { isValidViewport } from '../../graphs/types';
import { touch } from '../../../utils/ids';
import type {
  AddGraphExpressionOperation,
  AddGraphPointOperation,
  CreateGraphExpressionSpec,
  RemoveGraphExpressionOperation,
  RemoveGraphPointOperation,
  SetGraphExpressionVisibilityOperation,
  UpdateGraphExpressionOperation,
  UpdateGraphPointOperation,
  UpdateGraphSettingsOperation,
  UpdateGraphViewportOperation,
} from './operations';

export type GraphOpParseErrorCode =
  | 'schema'
  | 'invalid_graph_expression'
  | 'invalid_graph_domain'
  | 'invalid_graph_viewport'
  | 'empty_text';

export class GraphOpParseError extends Error {
  readonly code: GraphOpParseErrorCode;
  readonly detail?: string;
  constructor(code: GraphOpParseErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'GraphOpParseError';
    this.code = code;
    this.detail = detail;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new GraphOpParseError('schema', `${field} must be a non-empty string.`);
  }
  return v.trim();
}

function optionalFinite(
  v: unknown,
  field: string,
): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new GraphOpParseError('schema', `${field} must be a finite number or null.`);
  }
  return v;
}

function requireFinite(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new GraphOpParseError('schema', `${field} must be a finite number.`);
  }
  return v;
}

function encodeStrictExpression(raw: string, field: string): string {
  const encoded = encodeGraphExpression(raw, 'strict');
  if (!encoded.ok) {
    throw new GraphOpParseError(
      'invalid_graph_expression',
      `Invalid graph expression (${field}): ${encoded.error}`,
      raw,
    );
  }
  return encoded.canonical;
}

function parseExpressionSpec(raw: unknown, path: string): CreateGraphExpressionSpec {
  if (!isRecord(raw)) {
    throw new GraphOpParseError('schema', `${path} must be an object.`);
  }
  if (typeof raw.expression !== 'string' || !raw.expression.trim()) {
    throw new GraphOpParseError('empty_text', `${path}.expression must be a non-empty string.`);
  }
  const expression = encodeStrictExpression(raw.expression, path);
  const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
  const domain_min = optionalFinite(raw.domain_min, `${path}.domain_min`) ?? null;
  const domain_max = optionalFinite(raw.domain_max, `${path}.domain_max`) ?? null;
  if (domain_min != null && domain_max != null && !(domain_min < domain_max)) {
    throw new GraphOpParseError(
      'invalid_graph_domain',
      `${path} domain_min must be less than domain_max.`,
    );
  }
  return { expression, visible, domain_min, domain_max };
}

export function parseAddGraphExpression(raw: Record<string, unknown>): AddGraphExpressionOperation {
  return {
    type: 'add_graph_expression',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    expression: parseExpressionSpec(raw.expression, 'expression'),
  };
}

export function parseUpdateGraphExpression(
  raw: Record<string, unknown>,
): UpdateGraphExpressionOperation {
  const op: UpdateGraphExpressionOperation = {
    type: 'update_graph_expression',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    expression_id: requireId(raw.expression_id, 'expression_id'),
  };
  if ('expression' in raw) {
    if (typeof raw.expression !== 'string' || !raw.expression.trim()) {
      throw new GraphOpParseError('empty_text', 'expression must be a non-empty string when provided.');
    }
    op.expression = encodeStrictExpression(raw.expression, 'expression');
  }
  if ('domain_min' in raw) op.domain_min = optionalFinite(raw.domain_min, 'domain_min') ?? null;
  if ('domain_max' in raw) op.domain_max = optionalFinite(raw.domain_max, 'domain_max') ?? null;
  if (
    op.domain_min != null &&
    op.domain_max != null &&
    !(op.domain_min < op.domain_max)
  ) {
    throw new GraphOpParseError(
      'invalid_graph_domain',
      'domain_min must be less than domain_max.',
    );
  }
  if (!('expression' in op) && !('domain_min' in op) && !('domain_max' in op)) {
    throw new GraphOpParseError(
      'schema',
      'update_graph_expression requires at least one of expression, domain_min, domain_max.',
    );
  }
  return op;
}

export function parseRemoveGraphExpression(
  raw: Record<string, unknown>,
): RemoveGraphExpressionOperation {
  return {
    type: 'remove_graph_expression',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    expression_id: requireId(raw.expression_id, 'expression_id'),
  };
}

export function parseSetGraphExpressionVisibility(
  raw: Record<string, unknown>,
): SetGraphExpressionVisibilityOperation {
  if (typeof raw.visible !== 'boolean') {
    throw new GraphOpParseError('schema', 'visible must be a boolean.');
  }
  return {
    type: 'set_graph_expression_visibility',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    expression_id: requireId(raw.expression_id, 'expression_id'),
    visible: raw.visible,
  };
}

export function parseUpdateGraphViewport(
  raw: Record<string, unknown>,
): UpdateGraphViewportOperation {
  const op: UpdateGraphViewportOperation = {
    type: 'update_graph_viewport',
    graph_id: requireId(raw.graph_id, 'graph_id'),
  };
  if ('x_min' in raw) op.x_min = requireFinite(raw.x_min, 'x_min');
  if ('x_max' in raw) op.x_max = requireFinite(raw.x_max, 'x_max');
  if ('y_min' in raw) op.y_min = requireFinite(raw.y_min, 'y_min');
  if ('y_max' in raw) op.y_max = requireFinite(raw.y_max, 'y_max');
  if (
    !('x_min' in op) &&
    !('x_max' in op) &&
    !('y_min' in op) &&
    !('y_max' in op)
  ) {
    throw new GraphOpParseError(
      'schema',
      'update_graph_viewport requires at least one of x_min, x_max, y_min, y_max.',
    );
  }
  return op;
}

export function parseUpdateGraphSettings(
  raw: Record<string, unknown>,
): UpdateGraphSettingsOperation {
  const op: UpdateGraphSettingsOperation = {
    type: 'update_graph_settings',
    graph_id: requireId(raw.graph_id, 'graph_id'),
  };
  const strOrNull = (v: unknown, field: string): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string') {
      throw new GraphOpParseError('schema', `${field} must be a string or null.`);
    }
    const t = v.trim();
    return t.length ? t : null;
  };
  if ('title' in raw) op.title = strOrNull(raw.title, 'title');
  if ('x_axis_label' in raw) op.x_axis_label = strOrNull(raw.x_axis_label, 'x_axis_label');
  if ('y_axis_label' in raw) op.y_axis_label = strOrNull(raw.y_axis_label, 'y_axis_label');
  if ('show_grid' in raw) {
    if (typeof raw.show_grid !== 'boolean') {
      throw new GraphOpParseError('schema', 'show_grid must be boolean.');
    }
    op.show_grid = raw.show_grid;
  }
  if ('show_x_axis' in raw) {
    if (typeof raw.show_x_axis !== 'boolean') {
      throw new GraphOpParseError('schema', 'show_x_axis must be boolean.');
    }
    op.show_x_axis = raw.show_x_axis;
  }
  if ('show_y_axis' in raw) {
    if (typeof raw.show_y_axis !== 'boolean') {
      throw new GraphOpParseError('schema', 'show_y_axis must be boolean.');
    }
    op.show_y_axis = raw.show_y_axis;
  }
  if (
    !('title' in op) &&
    !('x_axis_label' in op) &&
    !('y_axis_label' in op) &&
    !('show_grid' in op) &&
    !('show_x_axis' in op) &&
    !('show_y_axis' in op)
  ) {
    throw new GraphOpParseError(
      'schema',
      'update_graph_settings requires at least one settings field.',
    );
  }
  return op;
}

export function parseAddGraphPoint(raw: Record<string, unknown>): AddGraphPointOperation {
  return {
    type: 'add_graph_point',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    x: requireFinite(raw.x, 'x'),
    y: requireFinite(raw.y, 'y'),
    label: typeof raw.label === 'string' ? raw.label : '',
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
  };
}

export function parseUpdateGraphPoint(
  raw: Record<string, unknown>,
): UpdateGraphPointOperation {
  const op: UpdateGraphPointOperation = {
    type: 'update_graph_point',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    point_id: requireId(raw.point_id, 'point_id'),
  };
  if ('x' in raw) op.x = requireFinite(raw.x, 'x');
  if ('y' in raw) op.y = requireFinite(raw.y, 'y');
  if ('label' in raw) {
    if (typeof raw.label !== 'string') {
      throw new GraphOpParseError('schema', 'label must be a string.');
    }
    op.label = raw.label;
  }
  if ('visible' in raw) {
    if (typeof raw.visible !== 'boolean') {
      throw new GraphOpParseError('schema', 'visible must be boolean.');
    }
    op.visible = raw.visible;
  }
  if (!('x' in op) && !('y' in op) && !('label' in op) && !('visible' in op)) {
    throw new GraphOpParseError(
      'schema',
      'update_graph_point requires at least one of x, y, label, visible.',
    );
  }
  return op;
}

export function parseRemoveGraphPoint(
  raw: Record<string, unknown>,
): RemoveGraphPointOperation {
  return {
    type: 'remove_graph_point',
    graph_id: requireId(raw.graph_id, 'graph_id'),
    point_id: requireId(raw.point_id, 'point_id'),
  };
}

export type GraphEditOperation =
  | AddGraphExpressionOperation
  | UpdateGraphExpressionOperation
  | RemoveGraphExpressionOperation
  | SetGraphExpressionVisibilityOperation
  | UpdateGraphViewportOperation
  | UpdateGraphSettingsOperation
  | AddGraphPointOperation
  | UpdateGraphPointOperation
  | RemoveGraphPointOperation;

export function isGraphEditOperationType(type: string): boolean {
  return (
    type === 'add_graph_expression' ||
    type === 'update_graph_expression' ||
    type === 'remove_graph_expression' ||
    type === 'set_graph_expression_visibility' ||
    type === 'update_graph_viewport' ||
    type === 'update_graph_settings' ||
    type === 'add_graph_point' ||
    type === 'update_graph_point' ||
    type === 'remove_graph_point'
  );
}

export function parseGraphEditOperation(
  raw: Record<string, unknown>,
): GraphEditOperation {
  switch (raw.type) {
    case 'add_graph_expression':
      return parseAddGraphExpression(raw);
    case 'update_graph_expression':
      return parseUpdateGraphExpression(raw);
    case 'remove_graph_expression':
      return parseRemoveGraphExpression(raw);
    case 'set_graph_expression_visibility':
      return parseSetGraphExpressionVisibility(raw);
    case 'update_graph_viewport':
      return parseUpdateGraphViewport(raw);
    case 'update_graph_settings':
      return parseUpdateGraphSettings(raw);
    case 'add_graph_point':
      return parseAddGraphPoint(raw);
    case 'update_graph_point':
      return parseUpdateGraphPoint(raw);
    case 'remove_graph_point':
      return parseRemoveGraphPoint(raw);
    default:
      throw new GraphOpParseError('schema', `Unknown graph edit type ${String(raw.type)}`);
  }
}

export function graphIdOf(op: GraphEditOperation): string {
  return op.graph_id;
}

/** Apply a validated graph edit onto a GraphElement (immutable). */
export function applyGraphEditOperation(
  graph: GraphElement,
  op: GraphEditOperation,
): GraphElement {
  switch (op.type) {
    case 'add_graph_expression': {
      const expr = createEmptyGraphExpression(
        graph.expressions.length,
        op.expression.expression,
      );
      return touch({
        ...graph,
        expressions: [
          ...graph.expressions,
          {
            ...expr,
            visible: op.expression.visible,
            domainMin: op.expression.domain_min,
            domainMax: op.expression.domain_max,
          },
        ],
      });
    }
    case 'update_graph_expression': {
      const idx = graph.expressions.findIndex((e) => e.id === op.expression_id);
      if (idx < 0) throw new Error(`Unknown expression_id ${op.expression_id}`);
      const prev = graph.expressions[idx]!;
      const nextDomainMin =
        'domain_min' in op ? (op.domain_min ?? null) : prev.domainMin;
      const nextDomainMax =
        'domain_max' in op ? (op.domain_max ?? null) : prev.domainMax;
      if (
        nextDomainMin != null &&
        nextDomainMax != null &&
        !(nextDomainMin < nextDomainMax)
      ) {
        throw new Error('domain_min must be less than domain_max');
      }
      const expressions = graph.expressions.map((e, i) =>
        i === idx
          ? {
              ...e,
              sourceText:
                'expression' in op && op.expression != null
                  ? op.expression
                  : e.sourceText,
              domainMin: nextDomainMin,
              domainMax: nextDomainMax,
            }
          : e,
      );
      return touch({ ...graph, expressions });
    }
    case 'remove_graph_expression': {
      if (!graph.expressions.some((e) => e.id === op.expression_id)) {
        throw new Error(`Unknown expression_id ${op.expression_id}`);
      }
      return touch({
        ...graph,
        expressions: graph.expressions.filter((e) => e.id !== op.expression_id),
      });
    }
    case 'set_graph_expression_visibility': {
      if (!graph.expressions.some((e) => e.id === op.expression_id)) {
        throw new Error(`Unknown expression_id ${op.expression_id}`);
      }
      return touch({
        ...graph,
        expressions: graph.expressions.map((e) =>
          e.id === op.expression_id ? { ...e, visible: op.visible } : e,
        ),
      });
    }
    case 'update_graph_viewport': {
      const viewport = {
        xMin: 'x_min' in op && op.x_min != null ? op.x_min : graph.viewport.xMin,
        xMax: 'x_max' in op && op.x_max != null ? op.x_max : graph.viewport.xMax,
        yMin: 'y_min' in op && op.y_min != null ? op.y_min : graph.viewport.yMin,
        yMax: 'y_max' in op && op.y_max != null ? op.y_max : graph.viewport.yMax,
      };
      if (!isValidViewport(viewport)) {
        throw new Error('viewport requires x_min < x_max and y_min < y_max');
      }
      return touch({ ...graph, viewport });
    }
    case 'update_graph_settings': {
      const settings = { ...graph.settings };
      if ('title' in op) settings.title = op.title ?? '';
      if ('x_axis_label' in op) settings.xAxisLabel = op.x_axis_label ?? '';
      if ('y_axis_label' in op) settings.yAxisLabel = op.y_axis_label ?? '';
      if ('show_grid' in op && op.show_grid != null) settings.showGrid = op.show_grid;
      if ('show_x_axis' in op && op.show_x_axis != null) {
        settings.showXAxis = op.show_x_axis;
      }
      if ('show_y_axis' in op && op.show_y_axis != null) {
        settings.showYAxis = op.show_y_axis;
      }
      return touch({ ...graph, settings });
    }
    case 'add_graph_point': {
      const point = createGraphPoint(op.x, op.y, op.label);
      return touch({
        ...graph,
        points: [...graph.points, { ...point, visible: op.visible }],
      });
    }
    case 'update_graph_point': {
      if (!graph.points.some((p) => p.id === op.point_id)) {
        throw new Error(`Unknown point_id ${op.point_id}`);
      }
      return touch({
        ...graph,
        points: graph.points.map((p) =>
          p.id === op.point_id
            ? {
                ...p,
                x: 'x' in op && op.x != null ? op.x : p.x,
                y: 'y' in op && op.y != null ? op.y : p.y,
                label: 'label' in op && op.label != null ? op.label : p.label,
                visible:
                  'visible' in op && op.visible != null ? op.visible : p.visible,
              }
            : p,
        ),
      });
    }
    case 'remove_graph_point': {
      if (!graph.points.some((p) => p.id === op.point_id)) {
        throw new Error(`Unknown point_id ${op.point_id}`);
      }
      return touch({
        ...graph,
        points: graph.points.filter((p) => p.id !== op.point_id),
      });
    }
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function prettyCurve(canonical: string): string {
  return canonical.replaceAll('**', '^').replace(/\*/g, '·');
}
