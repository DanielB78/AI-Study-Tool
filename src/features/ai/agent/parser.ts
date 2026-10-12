/**
 * CanvasAgentResponseParser — JSON parse + schema-ish + semantic validation.
 * Does not mutate the canvas.
 */

import {
  CANVAS_AGENT_JSON_SCHEMA,
  LAYOUT_ROLES,
  PLACEMENT_RELATIONS,
  type AbsolutePlacement,
  type AgentOutputType,
  type AnyLayoutSpec,
  type CanvasAgentResponse,
  type CanvasOperation,
  type CreateEquationOperation,
  type CreateGraphExpressionSpec,
  type CreateGraphOperation,
  type CreateGraphPointSpec,
  type CreateGraphSettingsSpec,
  type CreateGraphViewportSpec,
  type CreateStructuredNoteOperation,
  type CreateTextOperation,
  type LayoutRole,
  type Placement,
  type PlacementRelation,
  type RelativePlacement,
  type StructuredFieldPayload,
  type StructuredHierarchyNode,
  type UpdateTextOperation,
} from './operations';
import { CanvasAgentParseError, type ParseErrorCode } from './parseErrors';
import { parseGridLayout, validateLayoutAgainstOperations } from './layoutValidate';
import { isAgentOutputType } from './layout/outputLayoutConfig';
import {
  countHierarchyNodes,
  formatHierarchyTreePreview,
  maxHierarchyDepth,
  type HierarchyNode,
} from '../../structures/hierarchy';
import type { NoteStructure } from '../../structures/types';
import { isNodeSection, isStructureField } from '../../structures/types';
import { sanitizeLatexSource, validateLatex } from '../../equations/latex';
import { richTextToPlainText, type RichTextDocument } from '../../text/richText';
import { parseRichTextDocument, RichTextParseError } from '../../text/richTextValidate';
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

export type { ParseErrorCode };
export { CanvasAgentParseError };

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

function parseOptionalRef(raw: Record<string, unknown>): string | undefined {
  if (raw.ref === undefined || raw.ref === null) return undefined;
  if (typeof raw.ref !== 'string' || !raw.ref.trim()) {
    throw new CanvasAgentParseError('schema', 'ref must be a non-empty string when provided.');
  }
  return raw.ref.trim();
}

function parseOptionalLayoutCell(raw: Record<string, unknown>): string | undefined {
  if (raw.layout_cell === undefined || raw.layout_cell === null) return undefined;
  if (typeof raw.layout_cell !== 'string' || !raw.layout_cell.trim()) {
    throw new CanvasAgentParseError(
      'schema',
      'layout_cell must be a non-empty string when provided.',
    );
  }
  return raw.layout_cell.trim();
}

function parseOptionalColumnSpan(raw: Record<string, unknown>): number | undefined {
  if (raw.column_span === undefined || raw.column_span === null) return undefined;
  if (
    typeof raw.column_span !== 'number' ||
    !Number.isInteger(raw.column_span) ||
    raw.column_span < 1 ||
    raw.column_span > 4
  ) {
    throw new CanvasAgentParseError(
      'schema',
      'column_span must be an integer from 1 to 4 when provided.',
    );
  }
  return raw.column_span;
}

function parseOptionalLayoutRole(raw: Record<string, unknown>): LayoutRole | undefined {
  if (raw.layout_role === undefined || raw.layout_role === null) return undefined;
  if (typeof raw.layout_role !== 'string' || !(LAYOUT_ROLES as readonly string[]).includes(raw.layout_role)) {
    throw new CanvasAgentParseError(
      'schema',
      `layout_role must be one of: ${LAYOUT_ROLES.join(', ')}.`,
    );
  }
  return raw.layout_role as LayoutRole;
}

function creationLayoutExtras(raw: Record<string, unknown>): {
  ref?: string;
  layout_cell?: string;
  column_span?: number;
  layout_role?: LayoutRole;
} {
  const ref = parseOptionalRef(raw);
  const layout_cell = parseOptionalLayoutCell(raw);
  const column_span = parseOptionalColumnSpan(raw);
  const layout_role = parseOptionalLayoutRole(raw);
  return {
    ...(ref ? { ref } : {}),
    ...(layout_cell ? { layout_cell } : {}),
    ...(column_span !== undefined ? { column_span } : {}),
    ...(layout_role ? { layout_role } : {}),
  };
}

function parseOutputType(raw: unknown): AgentOutputType | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isAgentOutputType(raw)) {
    throw new CanvasAgentParseError(
      'schema',
      'output_type must be "lesson" or "step_by_step".',
      String(raw),
    );
  }
  return raw;
}

/** Placement is optional on creates assigned to a grid; default viewport_default. */
function parsePlacementOptional(raw: unknown): Placement {
  if (raw === undefined || raw === null) {
    return { mode: 'viewport_default' };
  }
  return parsePlacement(raw);
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
  const placement = parsePlacementOptional(raw.placement);
  return {
    type: 'create_structured_note',
    structure_id: structureId.trim(),
    fields,
    placement,
    ...creationLayoutExtras(raw),
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
  const placement = parsePlacementOptional(raw.placement);

  return {
    type: 'create_graph',
    expressions,
    points,
    viewport,
    settings,
    placement,
    ...creationLayoutExtras(raw),
  };
}

function parseCreateEquation(raw: Record<string, unknown>): CreateEquationOperation {
  const latex = requireNonEmptyString(raw.latex, 'create_equation.latex');
  const validated = validateLatex(latex);
  if (!validated.ok) {
    throw new CanvasAgentParseError(
      'invalid_latex',
      `create_equation latex is invalid: ${validated.error ?? 'unknown error'}`,
    );
  }
  const placement = parsePlacementOptional(raw.placement);
  return {
    type: 'create_equation',
    latex: sanitizeLatexSource(latex),
    placement,
    ...creationLayoutExtras(raw),
  };
}

function parseOperation(raw: unknown): CanvasOperation {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new CanvasAgentParseError('schema', 'Each operation needs a type.');
  }
  if (raw.type === 'create_text') {
    const placement = parsePlacementOptional(raw.placement);
    let rich_text: RichTextDocument | undefined;
    if (raw.rich_text !== undefined && raw.rich_text !== null) {
      try {
        rich_text = parseRichTextDocument(raw.rich_text);
      } catch (err) {
        throw new CanvasAgentParseError(
          'schema',
          err instanceof RichTextParseError ? err.message : 'Invalid rich_text.',
        );
      }
    }
    const plainFromRich = rich_text ? richTextToPlainText(rich_text) : '';
    const textRaw = typeof raw.text === 'string' ? raw.text : '';
    const text = (textRaw.trim() ? textRaw : plainFromRich).trim();
    if (!text) {
      throw new CanvasAgentParseError(
        'empty_text',
        'create_text needs non-empty text or rich_text.',
      );
    }
    return {
      type: 'create_text',
      text,
      placement,
      ...(rich_text ? { rich_text } : {}),
      ...creationLayoutExtras(raw),
    } satisfies CreateTextOperation;
  }
  if (raw.type === 'create_equation') {
    return parseCreateEquation(raw);
  }
  if (raw.type === 'update_text') {
    const target = raw.target_element_id;
    if (typeof target !== 'string' || !target.trim()) {
      throw new CanvasAgentParseError('missing_target', 'update_text needs target_element_id.');
    }
    let rich_text: RichTextDocument | undefined;
    if (raw.rich_text !== undefined && raw.rich_text !== null) {
      try {
        rich_text = parseRichTextDocument(raw.rich_text);
      } catch (err) {
        throw new CanvasAgentParseError(
          'schema',
          err instanceof RichTextParseError ? err.message : 'Invalid rich_text.',
        );
      }
    }
    const plainFromRich = rich_text ? richTextToPlainText(rich_text) : '';
    const textRaw = typeof raw.text === 'string' ? raw.text : '';
    const text = (textRaw.trim() ? textRaw : plainFromRich).trim();
    if (!text) {
      throw new CanvasAgentParseError(
        'empty_text',
        'update_text needs non-empty text or rich_text.',
      );
    }
    return {
      type: 'update_text',
      target_element_id: target.trim(),
      text,
      ...(rich_text ? { rich_text } : {}),
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
  if (op.type === 'create_text' || op.type === 'create_equation' || op.type === 'create_graph') {
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

  let layout: AnyLayoutSpec | undefined;
  if (parsed.layout !== undefined && parsed.layout !== null) {
    layout = parseGridLayout(parsed.layout, parsePlacement);
    validateRelativePlacement(layout.placement, ctx);
  }
  const output_type = parseOutputType(parsed.output_type);
  validateLayoutAgainstOperations(layout, operations, output_type);

  return {
    operations,
    ...(output_type ? { output_type } : {}),
    ...(layout ? { layout } : {}),
  };
}

export interface DescribePlanOptions {
  /** structure_id → human name for plan preview */
  structureNames?: ReadonlyMap<string, string>;
  /** structure_id → fieldId → label */
  structureFieldLabels?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Grid layout from the parsed response */
  layout?: AnyLayoutSpec;
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
  const lines = ops.map((op, i) => {
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
      const edit = op as GraphEditOperation;
      const lines = [`${n}. EDIT GRAPH`, `   Graph: ${edit.graph_id}`];
      switch (edit.type) {
        case 'add_graph_expression':
          lines.push(`   ADD CURVE`);
          lines.push(`   y = ${prettyCurve(edit.expression.expression)}`);
          break;
        case 'update_graph_expression':
          lines.push(`   UPDATE CURVE ${edit.expression_id}`);
          if (edit.expression) lines.push(`   y = ${prettyCurve(edit.expression)}`);
          if ('domain_min' in edit || 'domain_max' in edit) {
            lines.push(
              `   Domain: ${edit.domain_min ?? '…'} → ${edit.domain_max ?? '…'}`,
            );
          }
          break;
        case 'remove_graph_expression':
          lines.push(`   REMOVE CURVE ${edit.expression_id}`);
          break;
        case 'set_graph_expression_visibility':
          lines.push(
            `   ${edit.visible ? 'SHOW' : 'HIDE'} CURVE ${edit.expression_id}`,
          );
          break;
        case 'update_graph_viewport': {
          lines.push('   CHANGE VIEWPORT');
          if ('x_min' in edit || 'x_max' in edit) {
            lines.push(`   X: ${edit.x_min ?? '…'} → ${edit.x_max ?? '…'}`);
          }
          if ('y_min' in edit || 'y_max' in edit) {
            lines.push(`   Y: ${edit.y_min ?? '…'} → ${edit.y_max ?? '…'}`);
          }
          break;
        }
        case 'update_graph_settings': {
          lines.push('   UPDATE SETTINGS');
          if ('title' in edit) lines.push(`   Title: ${edit.title ?? '(none)'}`);
          if ('show_grid' in edit) {
            lines.push(`   Grid: ${edit.show_grid ? 'On' : 'Off'}`);
          }
          if ('x_axis_label' in edit) {
            lines.push(`   X label: ${edit.x_axis_label ?? '(none)'}`);
          }
          if ('y_axis_label' in edit) {
            lines.push(`   Y label: ${edit.y_axis_label ?? '(none)'}`);
          }
          break;
        }
        case 'add_graph_point':
          lines.push(
            `   ADD POINT (${edit.x}, ${edit.y})${edit.label ? ` ${edit.label}` : ''}`,
          );
          break;
        case 'update_graph_point':
          lines.push(`   UPDATE POINT ${edit.point_id}`);
          break;
        case 'remove_graph_point':
          lines.push(`   REMOVE POINT ${edit.point_id}`);
          break;
        default:
          break;
      }
      return lines.join('\n');
    }
    if (op.type === 'create_equation') {
      const placementLine = formatPlacementLine(op.placement, 'short');
      const refLine = op.ref ? `\n   Ref: ${op.ref}` : '';
      return `${n}. CREATE EQUATION${refLine}\n   Placement: ${placementLine}\n   LaTeX: ${op.latex}`;
    }
    if (op.type === 'create_text') {
      const placementLine = formatPlacementLine(op.placement, 'short');
      const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
      const refLine = op.ref ? `\n   Ref: ${op.ref}` : '';
      const richLine = op.rich_text ? `\n   Rich text: ${op.rich_text.blocks.length} block(s)` : '';
      return `${n}. CREATE TEXT${refLine}\n   Placement: ${placementLine}${richLine}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
    }
    return `${n}. UNKNOWN OPERATION`;
  });

  if (options?.layout) {
    const L = options.layout;
    if (L.type === 'chronological_grid') {
      lines.unshift(
        [
          'CHRONOLOGICAL GRID LAYOUT',
          `   Group placement: ${formatPlacementLine(L.placement, 'short')}`,
          L.columns !== undefined ? `   Columns hint: ${L.columns}` : '   Columns: (app-calculated)',
          '   Cell grouping: via operation layout_cell (consecutive ops; max 4)',
        ].join('\n'),
      );
    } else {
      const itemLines = L.items.map(
        (it) =>
          `   ${it.ref} → row ${it.row}, col ${it.column}` +
          (it.column_span && it.column_span > 1 ? ` (span ${it.column_span})` : ''),
      );
      lines.unshift(
        [
          'GRID LAYOUT',
          `   Columns: ${L.columns}`,
          `   Group placement: ${formatPlacementLine(L.placement, 'short')}`,
          '   Cells:',
          ...itemLines,
        ].join('\n'),
      );
    }
  }

  return lines;
}

export { CANVAS_AGENT_JSON_SCHEMA };
