/**
 * CanvasAgentResponseParser — JSON parse + schema-ish + semantic validation.
 * Does not mutate the canvas.
 */

import {
  CANVAS_AGENT_JSON_SCHEMA,
  PLACEMENT_RELATIONS,
  type AbsolutePlacement,
  type CanvasAgentResponse,
  type CanvasOperation,
  type CreateGraphExpressionSpec,
  type CreateGraphOperation,
  type CreateGraphPointSpec,
  type CreateGraphSettingsSpec,
  type CreateGraphViewportSpec,
  type CreateStructuredNoteOperation,
  type CreateTextOperation,
  type Placement,
  type PlacementRelation,
  type RelativePlacement,
  type StructuredFieldPayload,
  type StructuredHierarchyNode,
  type UpdateTextOperation,
} from './operations';
import {
  countHierarchyNodes,
  formatHierarchyTreePreview,
  maxHierarchyDepth,
  type HierarchyNode,
} from '../../structures/hierarchy';
import type { NoteStructure } from '../../structures/types';
import { isNodeSection, isStructureField } from '../../structures/types';
import { validateLatex } from '../../equations/latex';
import { encodeGraphExpression } from '../../graphs/expressionCodec';
import {
  DEFAULT_GRAPH_SETTINGS,
  DEFAULT_GRAPH_VIEWPORT,
  isValidViewport,
} from '../../graphs/types';
import {
  GraphOpParseError,
  isGraphEditOperationType,
  parseGraphEditOperation,
  prettyCurve,
  type GraphEditOperation,
} from './graphOperations';

export type ParseErrorCode =
  | 'empty'
  | 'invalid_json'
  | 'schema'
  | 'unknown_operation'
  | 'empty_text'
  | 'missing_target'
  | 'target_not_in_context'
  | 'target_not_text'
  | 'missing_anchor'
  | 'anchor_not_in_context'
  | 'invalid_relation'
  | 'invalid_coordinates'
  | 'structure_not_selected'
  | 'structure_mismatch'
  | 'unknown_structure_field'
  | 'missing_required_field'
  | 'invalid_field_payload'
  | 'invalid_latex'
  | 'hierarchy_too_deep'
  | 'hierarchy_too_large'
  | 'hierarchy_too_many_children'
  | 'invalid_graph_expression'
  | 'invalid_graph_viewport'
  | 'invalid_graph_domain'
  | 'empty_graph_content'
  | 'target_not_graph'
  | 'expression_not_on_graph'
  | 'point_not_on_graph';

export class CanvasAgentParseError extends Error {
  readonly code: ParseErrorCode;
  readonly detail?: string;

  constructor(code: ParseErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'CanvasAgentParseError';
    this.code = code;
    this.detail = detail;
  }
}

export interface ParseContext {
  /** Element IDs included in the RAG context sent to the model. */
  allowedElementIds: ReadonlySet<string>;
  /** Optional: map id → type for TextElement / GraphElement checks. */
  elementTypes?: ReadonlyMap<string, string>;
  /**
   * Structure selected for this request (snapshot).
   * null/undefined = No Structure mode (create_structured_note forbidden).
   */
  selectedStructure?: NoteStructure | null;
  /** graph_id → expression ids currently on that graph (from CanvasDocument). */
  graphExpressionIds?: ReadonlyMap<string, ReadonlySet<string>>;
  /** graph_id → point ids currently on that graph. */
  graphPointIds?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Strip optional ```json fences; still require JSON object body. */
export function stripCodeFences(raw: string): string {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  return text;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireNonEmptyString(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new CanvasAgentParseError('empty_text', `${field} must be a non-empty string.`);
  }
  return v;
}

function parsePlacement(raw: unknown): Placement {
  if (!isRecord(raw) || typeof raw.mode !== 'string') {
    throw new CanvasAgentParseError('schema', 'placement.mode is required.');
  }
  if (raw.mode === 'viewport_default') {
    return { mode: 'viewport_default' };
  }
  if (raw.mode === 'relative_to_element') {
    const anchor = raw.anchor_element_id;
    if (typeof anchor !== 'string' || !anchor.trim()) {
      throw new CanvasAgentParseError('missing_anchor', 'relative placement needs anchor_element_id.');
    }
    const relation = raw.relation;
    if (typeof relation !== 'string' || !PLACEMENT_RELATIONS.includes(relation as PlacementRelation)) {
      throw new CanvasAgentParseError(
        'invalid_relation',
        `relation must be one of: ${PLACEMENT_RELATIONS.join(', ')}.`,
        String(relation),
      );
    }
    return {
      mode: 'relative_to_element',
      anchor_element_id: anchor.trim(),
      relation: relation as PlacementRelation,
    } satisfies RelativePlacement;
  }
  if (raw.mode === 'absolute') {
    const x = raw.x;
    const y = raw.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new CanvasAgentParseError(
        'invalid_coordinates',
        'absolute placement requires finite x and y numbers.',
      );
    }
    return { mode: 'absolute', x, y } satisfies AbsolutePlacement;
  }
  throw new CanvasAgentParseError('schema', `Unknown placement mode: ${String(raw.mode)}`);
}

function parseHierarchyNode(raw: unknown, path: string): StructuredHierarchyNode {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError(
      'invalid_field_payload',
      `${path} must be an object with content and children.`,
    );
  }
  if ('x' in raw || 'y' in raw || 'id' in raw) {
    throw new CanvasAgentParseError(
      'invalid_field_payload',
      `${path} must not include coordinates or IDs — content and children only.`,
    );
  }
  const content = requireNonEmptyString(raw.content, `${path}.content`);
  if (!Array.isArray(raw.children)) {
    throw new CanvasAgentParseError(
      'invalid_field_payload',
      `${path}.children must be an array (use [] for leaves).`,
    );
  }
  const children = raw.children.map((child, i) =>
    parseHierarchyNode(child, `${path}.children[${i}]`),
  );
  return { content, children };
}

function parseFieldPayload(raw: unknown, fieldId: string): StructuredFieldPayload {
  if (raw === null) return null;
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError(
      'invalid_field_payload',
      `fields.${fieldId} must be an object or null.`,
    );
  }
  if ('root' in raw && !('content' in raw) && !('latex' in raw)) {
    return { root: parseHierarchyNode(raw.root, `fields.${fieldId}.root`) };
  }
  if ('content' in raw && !('latex' in raw) && !('root' in raw)) {
    return { content: requireNonEmptyString(raw.content, `fields.${fieldId}.content`) };
  }
  if ('latex' in raw && !('content' in raw) && !('root' in raw)) {
    return { latex: requireNonEmptyString(raw.latex, `fields.${fieldId}.latex`) };
  }
  throw new CanvasAgentParseError(
    'invalid_field_payload',
    `fields.${fieldId} must be {content}, {latex}, or {root:{content,children}}.`,
  );
}

function parseStructuredNote(raw: Record<string, unknown>): CreateStructuredNoteOperation {
  const structureId = raw.structure_id;
  if (typeof structureId !== 'string' || !structureId.trim()) {
    throw new CanvasAgentParseError('schema', 'create_structured_note needs structure_id.');
  }
  if (!isRecord(raw.fields)) {
    throw new CanvasAgentParseError('schema', 'create_structured_note needs fields object.');
  }
  const fields: Record<string, StructuredFieldPayload> = {};
  for (const [fieldId, payload] of Object.entries(raw.fields)) {
    fields[fieldId] = parseFieldPayload(payload, fieldId);
  }
  const placement = parsePlacement(raw.placement);
  return {
    type: 'create_structured_note',
    structure_id: structureId.trim(),
    fields,
    placement,
  };
}

function optionalFiniteNumber(
  v: unknown,
  field: string,
): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new CanvasAgentParseError(
      'schema',
      `${field} must be a finite number or null.`,
    );
  }
  return v;
}

function parseGraphExpressionSpec(
  raw: unknown,
  index: number,
): CreateGraphExpressionSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError(
      'schema',
      `expressions[${index}] must be an object.`,
    );
  }
  const expression = requireNonEmptyString(
    raw.expression,
    `expressions[${index}].expression`,
  );
  const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
  const domain_min = optionalFiniteNumber(
    raw.domain_min,
    `expressions[${index}].domain_min`,
  );
  const domain_max = optionalFiniteNumber(
    raw.domain_max,
    `expressions[${index}].domain_max`,
  );
  if (
    domain_min != null &&
    domain_max != null &&
    !(domain_min < domain_max)
  ) {
    throw new CanvasAgentParseError(
      'invalid_graph_domain',
      `expressions[${index}] domain_min must be less than domain_max.`,
    );
  }

  // Strict AI contract — GraphExpressionCodec, same pipeline as human graphs.
  const encoded = encodeGraphExpression(expression, 'strict');
  if (!encoded.ok) {
    throw new CanvasAgentParseError(
      'invalid_graph_expression',
      `Invalid graph expression at index ${index}: ${encoded.error}`,
      expression,
    );
  }

  return {
    expression: encoded.canonical,
    visible,
    domain_min,
    domain_max,
  };
}

function parseGraphPointSpec(raw: unknown, index: number): CreateGraphPointSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', `points[${index}] must be an object.`);
  }
  const x = raw.x;
  const y = raw.y;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new CanvasAgentParseError(
      'schema',
      `points[${index}] requires finite x and y numbers.`,
    );
  }
  const label = typeof raw.label === 'string' ? raw.label : '';
  const visible = typeof raw.visible === 'boolean' ? raw.visible : true;
  return { x, y, label, visible };
}

function parseGraphViewport(raw: unknown): CreateGraphViewportSpec {
  const defaults = DEFAULT_GRAPH_VIEWPORT;
  if (raw === undefined || raw === null) {
    return {
      x_min: defaults.xMin,
      x_max: defaults.xMax,
      y_min: defaults.yMin,
      y_max: defaults.yMax,
    };
  }
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', 'viewport must be an object.');
  }
  const read = (key: string, fallback: number): number => {
    const v = raw[key];
    if (v === undefined || v === null) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new CanvasAgentParseError(
        'invalid_graph_viewport',
        `viewport.${key} must be a finite number.`,
      );
    }
    return v;
  };
  const viewport: CreateGraphViewportSpec = {
    x_min: read('x_min', defaults.xMin),
    x_max: read('x_max', defaults.xMax),
    y_min: read('y_min', defaults.yMin),
    y_max: read('y_max', defaults.yMax),
  };
  if (
    !isValidViewport({
      xMin: viewport.x_min,
      xMax: viewport.x_max,
      yMin: viewport.y_min,
      yMax: viewport.y_max,
    })
  ) {
    throw new CanvasAgentParseError(
      'invalid_graph_viewport',
      'viewport requires x_min < x_max and y_min < y_max.',
    );
  }
  return viewport;
}

function parseGraphSettings(raw: unknown): CreateGraphSettingsSpec {
  const d = DEFAULT_GRAPH_SETTINGS;
  if (raw === undefined || raw === null) {
    return {
      title: null,
      x_axis_label: null,
      y_axis_label: null,
      show_grid: d.showGrid,
      show_x_axis: d.showXAxis,
      show_y_axis: d.showYAxis,
    };
  }
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', 'settings must be an object.');
  }
  const strOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') {
      throw new CanvasAgentParseError('schema', 'settings string fields must be string or null.');
    }
    const t = v.trim();
    return t.length ? t : null;
  };
  const bool = (v: unknown, fallback: boolean): boolean => {
    if (v === undefined || v === null) return fallback;
    if (typeof v !== 'boolean') {
      throw new CanvasAgentParseError('schema', 'settings boolean fields must be boolean.');
    }
    return v;
  };
  return {
    title: strOrNull(raw.title),
    x_axis_label: strOrNull(raw.x_axis_label),
    y_axis_label: strOrNull(raw.y_axis_label),
    show_grid: bool(raw.show_grid, d.showGrid),
    show_x_axis: bool(raw.show_x_axis, d.showXAxis),
    show_y_axis: bool(raw.show_y_axis, d.showYAxis),
  };
}

function parseCreateGraph(raw: Record<string, unknown>): CreateGraphOperation {
  if (!Array.isArray(raw.expressions)) {
    throw new CanvasAgentParseError('schema', 'create_graph needs an expressions array.');
  }
  if (!Array.isArray(raw.points)) {
    throw new CanvasAgentParseError('schema', 'create_graph needs a points array (use [] if none).');
  }

  const expressions = raw.expressions.map((item, i) => parseGraphExpressionSpec(item, i));
  const points = raw.points.map((item, i) => parseGraphPointSpec(item, i));

  if (expressions.length === 0 && points.length === 0) {
    throw new CanvasAgentParseError(
      'empty_graph_content',
      'create_graph requires at least one expression or point.',
    );
  }

  const viewport = parseGraphViewport(raw.viewport);
  const settings = parseGraphSettings(raw.settings);
  const placement = parsePlacement(raw.placement);

  return {
    type: 'create_graph',
    expressions,
    points,
    viewport,
    settings,
    placement,
  };
}

function parseOperation(raw: unknown): CanvasOperation {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new CanvasAgentParseError('schema', 'Each operation needs a type.');
  }
  if (raw.type === 'create_text') {
    const text = requireNonEmptyString(raw.text, 'create_text.text');
    const placement = parsePlacement(raw.placement);
    return { type: 'create_text', text, placement } satisfies CreateTextOperation;
  }
  if (raw.type === 'update_text') {
    const target = raw.target_element_id;
    if (typeof target !== 'string' || !target.trim()) {
      throw new CanvasAgentParseError('missing_target', 'update_text needs target_element_id.');
    }
    const text = requireNonEmptyString(raw.text, 'update_text.text');
    return {
      type: 'update_text',
      target_element_id: target.trim(),
      text,
    } satisfies UpdateTextOperation;
  }
  if (raw.type === 'create_structured_note') {
    return parseStructuredNote(raw);
  }
  if (raw.type === 'create_graph') {
    return parseCreateGraph(raw);
  }
  if (isGraphEditOperationType(raw.type)) {
    try {
      return parseGraphEditOperation(raw);
    } catch (err) {
      if (err instanceof GraphOpParseError) {
        throw new CanvasAgentParseError(
          err.code === 'invalid_graph_expression'
            ? 'invalid_graph_expression'
            : err.code === 'invalid_graph_domain'
              ? 'invalid_graph_domain'
              : err.code === 'invalid_graph_viewport'
                ? 'invalid_graph_viewport'
                : err.code === 'empty_text'
                  ? 'empty_text'
                  : 'schema',
          err.message,
          err.detail,
        );
      }
      throw err;
    }
  }
  throw new CanvasAgentParseError(
    'unknown_operation',
    `Unsupported operation type "${raw.type}".`,
    String(raw.type),
  );
}

function validateStructuredNote(
  op: CreateStructuredNoteOperation,
  ctx: ParseContext,
): void {
  const structure = ctx.selectedStructure;
  if (!structure) {
    throw new CanvasAgentParseError(
      'structure_not_selected',
      'create_structured_note is only allowed when a note structure is selected.',
    );
  }
  if (op.structure_id !== structure.id) {
    throw new CanvasAgentParseError(
      'structure_mismatch',
      `structure_id "${op.structure_id}" does not match the selected structure "${structure.id}".`,
      op.structure_id,
    );
  }

  const fieldById = new Map(structure.fields.map((f) => [f.id, f]));
  for (const fieldId of Object.keys(op.fields)) {
    if (!fieldById.has(fieldId)) {
      throw new CanvasAgentParseError(
        'unknown_structure_field',
        `Unknown structure field "${fieldId}".`,
        fieldId,
      );
    }
  }

  for (const field of structure.fields) {
    const payload = op.fields[field.id];
    const missing = payload === undefined || payload === null;
    if (field.required && missing) {
      throw new CanvasAgentParseError(
        'missing_required_field',
        `Required field "${field.id}" (${field.label}) is missing.`,
        field.id,
      );
    }
    if (missing) continue;

    if (isNodeSection(field)) {
      if (!('root' in payload) || payload.root == null) {
        throw new CanvasAgentParseError(
          'invalid_field_payload',
          `Field "${field.id}" is NODE_SECTION and requires { "root": { "content", "children" } }.`,
          field.id,
        );
      }
      const root = payload.root as HierarchyNode;
      const depth = maxHierarchyDepth(root);
      if (depth > field.maxDepth) {
        throw new CanvasAgentParseError(
          'hierarchy_too_deep',
          `Node section "${field.id}" depth ${depth} exceeds maxDepth ${field.maxDepth}.`,
          field.id,
        );
      }
      const total = countHierarchyNodes(root);
      if (total > field.maxTotalNodes) {
        throw new CanvasAgentParseError(
          'hierarchy_too_large',
          `Node section "${field.id}" has ${total} nodes; maxTotalNodes is ${field.maxTotalNodes}.`,
          field.id,
        );
      }
      if (field.maxChildrenPerNode != null) {
        const walk = (n: HierarchyNode) => {
          if (n.children.length > field.maxChildrenPerNode!) {
            throw new CanvasAgentParseError(
              'hierarchy_too_many_children',
              `Node section "${field.id}" has a node with ${n.children.length} children; max is ${field.maxChildrenPerNode}.`,
              field.id,
            );
          }
          n.children.forEach(walk);
        };
        walk(root);
      }
      continue;
    }

    if (!isStructureField(field)) continue;

    if (field.contentType === 'text') {
      if (!('content' in payload) || typeof payload.content !== 'string') {
        throw new CanvasAgentParseError(
          'invalid_field_payload',
          `Field "${field.id}" is TEXT and requires { "content": "..." }.`,
          field.id,
        );
      }
    } else if (field.contentType === 'equation') {
      if (!('latex' in payload) || typeof payload.latex !== 'string') {
        throw new CanvasAgentParseError(
          'invalid_field_payload',
          `Field "${field.id}" is EQUATION and requires { "latex": "..." }.`,
          field.id,
        );
      }
      const check = validateLatex(payload.latex, true);
      if (!check.ok) {
        throw new CanvasAgentParseError(
          'invalid_latex',
          `Invalid LaTeX for field "${field.id}": ${check.error}`,
          field.id,
        );
      }
    }
  }

  if (op.placement.mode === 'relative_to_element') {
    const id = op.placement.anchor_element_id;
    if (!ctx.allowedElementIds.has(id)) {
      throw new CanvasAgentParseError(
        'anchor_not_in_context',
        `anchor_element_id "${id}" was not in the supplied canvas context.`,
        id,
      );
    }
  }
}

function validateRelativePlacement(placement: Placement, ctx: ParseContext): void {
  if (placement.mode !== 'relative_to_element') return;
  const id = placement.anchor_element_id;
  if (!ctx.allowedElementIds.has(id)) {
    throw new CanvasAgentParseError(
      'anchor_not_in_context',
      `anchor_element_id "${id}" was not in the supplied canvas context.`,
      id,
    );
  }
}

function validateGraphTarget(graphId: string, ctx: ParseContext): void {
  if (!ctx.allowedElementIds.has(graphId)) {
    throw new CanvasAgentParseError(
      'target_not_in_context',
      `graph_id "${graphId}" was not in the supplied canvas context.`,
      graphId,
    );
  }
  const t = ctx.elementTypes?.get(graphId);
  if (t !== undefined && t !== 'graph') {
    throw new CanvasAgentParseError(
      'target_not_graph',
      `graph_id "${graphId}" is not a GraphElement.`,
      graphId,
    );
  }
}

function validateExpressionOnGraph(
  graphId: string,
  expressionId: string,
  ctx: ParseContext,
): void {
  const ids = ctx.graphExpressionIds?.get(graphId);
  if (ids && !ids.has(expressionId)) {
    throw new CanvasAgentParseError(
      'expression_not_on_graph',
      `expression_id "${expressionId}" is not on graph "${graphId}".`,
      expressionId,
    );
  }
}

function validatePointOnGraph(
  graphId: string,
  pointId: string,
  ctx: ParseContext,
): void {
  const ids = ctx.graphPointIds?.get(graphId);
  if (ids && !ids.has(pointId)) {
    throw new CanvasAgentParseError(
      'point_not_on_graph',
      `point_id "${pointId}" is not on graph "${graphId}".`,
      pointId,
    );
  }
}

function validateGraphEdit(op: GraphEditOperation, ctx: ParseContext): void {
  validateGraphTarget(op.graph_id, ctx);
  if (
    op.type === 'update_graph_expression' ||
    op.type === 'remove_graph_expression' ||
    op.type === 'set_graph_expression_visibility'
  ) {
    validateExpressionOnGraph(op.graph_id, op.expression_id, ctx);
  }
  if (op.type === 'update_graph_point' || op.type === 'remove_graph_point') {
    validatePointOnGraph(op.graph_id, op.point_id, ctx);
  }
  // Final viewport validity for PATCH is checked at execute against live graph.
}

function semanticValidate(op: CanvasOperation, ctx: ParseContext): void {
  if (op.type === 'update_text') {
    if (!ctx.allowedElementIds.has(op.target_element_id)) {
      throw new CanvasAgentParseError(
        'target_not_in_context',
        `target_element_id "${op.target_element_id}" was not in the supplied canvas context.`,
        op.target_element_id,
      );
    }
    const t = ctx.elementTypes?.get(op.target_element_id);
    if (t !== undefined && t !== 'text') {
      throw new CanvasAgentParseError(
        'target_not_text',
        `target_element_id "${op.target_element_id}" is not a TextElement.`,
        op.target_element_id,
      );
    }
  }
  if (op.type === 'create_text') {
    validateRelativePlacement(op.placement, ctx);
  }
  if (op.type === 'create_graph') {
    validateRelativePlacement(op.placement, ctx);
  }
  if (op.type === 'create_structured_note') {
    validateStructuredNote(op, ctx);
  }
  if (isGraphEditOperationType(op.type)) {
    validateGraphEdit(op as GraphEditOperation, ctx);
  }
}

/**
 * Parse + validate a pasted LLM response.
 * Validates ALL operations before returning — never partially accepts.
 */
export function parseCanvasAgentResponse(
  raw: string,
  ctx: ParseContext,
): CanvasAgentResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new CanvasAgentParseError('empty', 'Response cannot be empty.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFences(trimmed));
  } catch (err) {
    throw new CanvasAgentParseError(
      'invalid_json',
      'Response is not valid JSON.',
      err instanceof Error ? err.message : undefined,
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.operations)) {
    throw new CanvasAgentParseError(
      'schema',
      'Response must be an object with an "operations" array.',
    );
  }
  if (parsed.operations.length === 0) {
    throw new CanvasAgentParseError('schema', 'operations must contain at least one item.');
  }

  const operations: CanvasOperation[] = [];
  for (const item of parsed.operations) {
    const op = parseOperation(item);
    semanticValidate(op, ctx);
    operations.push(op);
  }

  return { operations };
}

export interface DescribePlanOptions {
  /** structure_id → human name for plan preview */
  structureNames?: ReadonlyMap<string, string>;
  /** structure_id → fieldId → label */
  structureFieldLabels?: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

function formatPlacementLine(p: Placement, style: 'short' | 'friendly' = 'short'): string {
  if (p.mode === 'viewport_default') {
    return style === 'friendly' ? 'In front of you' : 'viewport_default';
  }
  if (p.mode === 'absolute') return `absolute (${p.x}, ${p.y})`;
  if (style === 'friendly') {
    const rel =
      p.relation === 'near'
        ? 'Near'
        : p.relation === 'left_of'
          ? 'Left of'
          : p.relation === 'right_of'
            ? 'Right of'
            : p.relation === 'above'
              ? 'Above'
              : 'Below';
    return `${rel} ${p.anchor_element_id}`;
  }
  return `${p.relation} ${p.anchor_element_id}`;
}

/** Human-readable plan lines for the debug UI. */
export function describeOperationPlan(
  ops: readonly CanvasOperation[],
  options?: DescribePlanOptions,
): string[] {
  return ops.map((op, i) => {
    const n = i + 1;
    if (op.type === 'update_text') {
      const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
      return `${n}. UPDATE TEXT\n   Target: ${op.target_element_id}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
    }
    if (op.type === 'create_structured_note') {
      const placementLine = formatPlacementLine(op.placement, 'short');
      const structureName =
        options?.structureNames?.get(op.structure_id) ?? op.structure_id;
      const labels = options?.structureFieldLabels?.get(op.structure_id);
      const fieldLines = Object.entries(op.fields)
        .filter(([, v]) => v != null)
        .flatMap(([id, v]) => {
          const label = labels?.get(id) ?? id;
          if (v && 'root' in v && v.root) {
            const root = v.root as HierarchyNode;
            const nodeCount = countHierarchyNodes(root);
            const connectorCount = Math.max(0, nodeCount - 1);
            const tree = formatHierarchyTreePreview(root);
            return [
              `   CREATE NODE STRUCTURE`,
              `   ${label}`,
              `   Nodes: ${nodeCount} TextElements`,
              `   Connections: ${connectorCount} ConnectorElements`,
              '   Preview:',
              ...tree.map((line) => `   ${line}`),
            ];
          }
          if (v && 'content' in v) {
            const preview = v.content.replace(/\s+/g, ' ').slice(0, 80);
            return [`   ${label}:`, `   ${preview}${v.content.length > 80 ? '…' : ''}`];
          }
          if (v && 'latex' in v) {
            return [`   ${label}:`, `   [equation] ${v.latex}`];
          }
          return [`   ${label}: (empty)`];
        });
      return [
        `${n}. CREATE STRUCTURED NOTE`,
        `   Structure: ${structureName}`,
        `   Placement: ${placementLine === 'viewport_default' ? 'Viewport Default' : placementLine}`,
        '   FIELDS',
        ...fieldLines,
      ].join('\n');
    }
    if (op.type === 'create_graph') {
      const curveLines =
        op.expressions.length === 0
          ? ['   (no curves)']
          : op.expressions.map(
              (e) => `   • y = ${prettyCurve(e.expression)}`,
            );
      const pointLines =
        op.points.length === 0
          ? []
          : [
              '   Points:',
              ...op.points.map(
                (p) =>
                  `   • (${p.x}, ${p.y})${p.label ? ` ${p.label}` : ''}`,
              ),
            ];
      const titleLine = op.settings.title
        ? [`   Title: ${op.settings.title}`]
        : [];
      const labelBits: string[] = [];
      if (op.settings.x_axis_label) {
        labelBits.push(`x: ${op.settings.x_axis_label}`);
      }
      if (op.settings.y_axis_label) {
        labelBits.push(`y: ${op.settings.y_axis_label}`);
      }
      return [
        `${n}. CREATE GRAPH`,
        '   Curves:',
        ...curveLines,
        ...pointLines,
        ...titleLine,
        `   X range: ${op.viewport.x_min} → ${op.viewport.x_max}`,
        `   Y range: ${op.viewport.y_min} → ${op.viewport.y_max}`,
        `   Grid: ${op.settings.show_grid ? 'On' : 'Off'}`,
        ...(labelBits.length ? [`   Axis labels: ${labelBits.join(', ')}`] : []),
        `   Placement: ${formatPlacementLine(op.placement, 'friendly')}`,
      ].join('\n');
    }
    if (isGraphEditOperationType(op.type)) {
      const lines = [`${n}. EDIT GRAPH`, `   Graph: ${op.graph_id}`];
      switch (op.type) {
        case 'add_graph_expression':
          lines.push(`   ADD CURVE`);
          lines.push(`   y = ${prettyCurve(op.expression.expression)}`);
          break;
        case 'update_graph_expression':
          lines.push(`   UPDATE CURVE ${op.expression_id}`);
          if (op.expression) lines.push(`   y = ${prettyCurve(op.expression)}`);
          if ('domain_min' in op || 'domain_max' in op) {
            lines.push(
              `   Domain: ${op.domain_min ?? '…'} → ${op.domain_max ?? '…'}`,
            );
          }
          break;
        case 'remove_graph_expression':
          lines.push(`   REMOVE CURVE ${op.expression_id}`);
          break;
        case 'set_graph_expression_visibility':
          lines.push(
            `   ${op.visible ? 'SHOW' : 'HIDE'} CURVE ${op.expression_id}`,
          );
          break;
        case 'update_graph_viewport': {
          lines.push('   CHANGE VIEWPORT');
          if ('x_min' in op || 'x_max' in op) {
            lines.push(`   X: ${op.x_min ?? '…'} → ${op.x_max ?? '…'}`);
          }
          if ('y_min' in op || 'y_max' in op) {
            lines.push(`   Y: ${op.y_min ?? '…'} → ${op.y_max ?? '…'}`);
          }
          break;
        }
        case 'update_graph_settings': {
          lines.push('   UPDATE SETTINGS');
          if ('title' in op) lines.push(`   Title: ${op.title ?? '(none)'}`);
          if ('show_grid' in op) {
            lines.push(`   Grid: ${op.show_grid ? 'On' : 'Off'}`);
          }
          if ('x_axis_label' in op) {
            lines.push(`   X label: ${op.x_axis_label ?? '(none)'}`);
          }
          if ('y_axis_label' in op) {
            lines.push(`   Y label: ${op.y_axis_label ?? '(none)'}`);
          }
          break;
        }
        case 'add_graph_point':
          lines.push(
            `   ADD POINT (${op.x}, ${op.y})${op.label ? ` ${op.label}` : ''}`,
          );
          break;
        case 'update_graph_point':
          lines.push(`   UPDATE POINT ${op.point_id}`);
          break;
        case 'remove_graph_point':
          lines.push(`   REMOVE POINT ${op.point_id}`);
          break;
        default:
          break;
      }
      return lines.join('\n');
    }
    const placementLine = formatPlacementLine(op.placement, 'short');
    const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
    return `${n}. CREATE TEXT\n   Placement: ${placementLine}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
  });
}

export { CANVAS_AGENT_JSON_SCHEMA };
