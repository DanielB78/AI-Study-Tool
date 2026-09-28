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
  type CreateTextOperation,
  type Placement,
  type PlacementRelation,
  type RelativePlacement,
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
  | 'invalid_coordinates';

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
  throw new CanvasAgentParseError(
    'unknown_operation',
    `Unsupported operation type "${raw.type}". Only create_text and update_text are allowed.`,
    String(raw.type),
  );
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
