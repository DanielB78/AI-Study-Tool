/**
 * CanvasAgentResponseParser — JSON parse + semantic validation.
 * Does not mutate the canvas. All-or-nothing: any invalid op rejects the plan.
 */

import {
  AI_TEXT_MAX_HEIGHT,
  AI_TEXT_MAX_WIDTH,
  AI_TEXT_MIN_HEIGHT,
  AI_TEXT_MIN_WIDTH,
  CANVAS_AGENT_JSON_SCHEMA,
  PLACEMENT_RELATIONS,
  type AbsolutePlacement,
  type CanvasAgentResponse,
  type CanvasOperation,
  type CreateTextOperation,
  type DeleteTextOperation,
  type MoveTextOperation,
  type Placement,
  type PlacementRelation,
  type RelativePlacement,
  type ResizeTextOperation,
  type UpdateTextOperation,
} from './operations';
import { describeOperationPlanLines } from './actionSummary';

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
  | 'invalid_size'
  | 'missing_size'
  | 'self_anchor';

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

function requireTargetId(raw: Record<string, unknown>, opName: string): string {
  const target = raw.target_element_id;
  if (typeof target !== 'string' || !target.trim()) {
    throw new CanvasAgentParseError('missing_target', `${opName} needs target_element_id.`);
  }
  return target.trim();
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

function validateDimension(
  value: unknown,
  field: 'width' | 'height',
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CanvasAgentParseError(
      'invalid_size',
      `resize_text.${field} must be a finite number.`,
      String(value),
    );
  }
  const min = field === 'width' ? AI_TEXT_MIN_WIDTH : AI_TEXT_MIN_HEIGHT;
  const max = field === 'width' ? AI_TEXT_MAX_WIDTH : AI_TEXT_MAX_HEIGHT;
  if (value < min || value > max) {
    throw new CanvasAgentParseError(
      'invalid_size',
      `resize_text.${field} must be between ${min} and ${max}.`,
      String(value),
    );
  }
  return value;
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
    const target_element_id = requireTargetId(raw, 'update_text');
    const text = requireNonEmptyString(raw.text, 'update_text.text');
    return {
      type: 'update_text',
      target_element_id,
      text,
    } satisfies UpdateTextOperation;
  }
  if (raw.type === 'move_text') {
    const target_element_id = requireTargetId(raw, 'move_text');
    const placement = parsePlacement(raw.placement);
    return { type: 'move_text', target_element_id, placement } satisfies MoveTextOperation;
  }
  if (raw.type === 'resize_text') {
    const target_element_id = requireTargetId(raw, 'resize_text');
    const hasWidth = raw.width !== undefined;
    const hasHeight = raw.height !== undefined;
    if (!hasWidth && !hasHeight) {
      throw new CanvasAgentParseError(
        'missing_size',
        'resize_text requires width and/or height.',
      );
    }
    const op: ResizeTextOperation = { type: 'resize_text', target_element_id };
    if (hasWidth) op.width = validateDimension(raw.width, 'width');
    if (hasHeight) op.height = validateDimension(raw.height, 'height');
    return op;
  }
  if (raw.type === 'delete_text') {
    const target_element_id = requireTargetId(raw, 'delete_text');
    return { type: 'delete_text', target_element_id } satisfies DeleteTextOperation;
  }
  throw new CanvasAgentParseError(
    'unknown_operation',
    `Unsupported operation type "${raw.type}". Allowed: create_text, update_text, move_text, resize_text, delete_text.`,
    String(raw.type),
  );
}

function assertTargetInContext(id: string, ctx: ParseContext): void {
  if (!ctx.allowedElementIds.has(id)) {
    throw new CanvasAgentParseError(
      'target_not_in_context',
      `target_element_id "${id}" was not in the supplied canvas context.`,
      id,
    );
  }
  const t = ctx.elementTypes?.get(id);
  if (t !== undefined && t !== 'text') {
    throw new CanvasAgentParseError(
      'target_not_text',
      `target_element_id "${id}" is not a TextElement.`,
      id,
    );
  }
}

function assertRelativePlacement(
  placement: Placement,
  ctx: ParseContext,
  targetId?: string,
): void {
  if (placement.mode !== 'relative_to_element') return;
  const id = placement.anchor_element_id;
  if (!ctx.allowedElementIds.has(id)) {
    throw new CanvasAgentParseError(
      'anchor_not_in_context',
      `anchor_element_id "${id}" was not in the supplied canvas context.`,
      id,
    );
  }
  if (targetId && id === targetId) {
    throw new CanvasAgentParseError(
      'self_anchor',
      'move_text cannot use the target as its own placement anchor.',
      id,
    );
  }
}

function semanticValidate(op: CanvasOperation, ctx: ParseContext): void {
  if (op.type === 'update_text' || op.type === 'move_text' || op.type === 'resize_text' || op.type === 'delete_text') {
    assertTargetInContext(op.target_element_id, ctx);
  }
  if (op.type === 'create_text') {
    assertRelativePlacement(op.placement, ctx);
  }
  if (op.type === 'move_text') {
    assertRelativePlacement(op.placement, ctx, op.target_element_id);
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

/** Human-readable plan lines for the debug UI. */
export function describeOperationPlan(ops: readonly CanvasOperation[]): string[] {
  return describeOperationPlanLines(ops);
}

export { CANVAS_AGENT_JSON_SCHEMA };
