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
  | 'hierarchy_too_many_children';

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
  /** Optional: map id → type for TextElement checks. */
  elementTypes?: ReadonlyMap<string, string>;
  /**
   * Structure selected for this request (snapshot).
   * null/undefined = No Structure mode (create_structured_note forbidden).
   */
  selectedStructure?: NoteStructure | null;
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
  if (op.type === 'create_text' && op.placement.mode === 'relative_to_element') {
    const id = op.placement.anchor_element_id;
    if (!ctx.allowedElementIds.has(id)) {
      throw new CanvasAgentParseError(
        'anchor_not_in_context',
        `anchor_element_id "${id}" was not in the supplied canvas context.`,
        id,
      );
    }
  }
  if (op.type === 'create_structured_note') {
    validateStructuredNote(op, ctx);
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
      const p = op.placement;
      let placementLine = '';
      if (p.mode === 'viewport_default') placementLine = 'Viewport Default';
      else if (p.mode === 'absolute') placementLine = `absolute (${p.x}, ${p.y})`;
      else placementLine = `${p.relation} ${p.anchor_element_id}`;
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
              `   ${label.toUpperCase()}`,
              ...tree.map((line) => `   ${line}`),
              `   Nodes: ${nodeCount}`,
              `   Connectors: ${connectorCount}`,
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
        `   Placement: ${placementLine}`,
        '   FIELDS',
        ...fieldLines,
      ].join('\n');
    }
    const p = op.placement;
    let placementLine = '';
    if (p.mode === 'viewport_default') placementLine = 'viewport_default';
    else if (p.mode === 'absolute') placementLine = `absolute (${p.x}, ${p.y})`;
    else placementLine = `${p.relation} ${p.anchor_element_id}`;
    const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
    return `${n}. CREATE TEXT\n   Placement: ${placementLine}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
  });
}

export { CANVAS_AGENT_JSON_SCHEMA };
