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
  type CreateEquationOperation,
  type CreateTextOperation,
  type DeleteEquationOperation,
  type DeleteTextOperation,
  type MoveEquationOperation,
  type MoveTextOperation,
  type Placement,
  type PlacementRelation,
  type RelativePlacement,
  type ResizeEquationOperation,
  type ResizeTextOperation,
  type UpdateEquationOperation,
  type UpdateTextOperation,
  type UpdateTextStyleOperation,
} from './operations';
import { describeOperationPlanLines } from './actionSummary';
import {
  detectSilentLatexJsonCorruption,
  explainJsonParseFailure,
  parsedLatexLooksCorrupted,
} from './latexJsonEscaping';
import {
  LATEX_JSON_REPAIR_INDICATOR,
  collectLatexStrings,
  repairLatexJsonFields,
  type LatexJsonRepairMeta,
} from './latexJsonRepair';
import {
  ColorNormalizeFailure,
  isEmptyStylePatch,
  normalizeTextStylePatch,
  type TextStylePatch,
} from './textStyle';
import {
  sanitizeLatexSource,
  validateLatex,
} from '../../equations/latex';

export type { LatexJsonRepairMeta } from './latexJsonRepair';
export { LATEX_JSON_REPAIR_INDICATOR } from './latexJsonRepair';

export type ParseErrorCode =
  | 'empty'
  | 'invalid_json'
  | 'schema'
  | 'unknown_operation'
  | 'empty_text'
  | 'empty_latex'
  | 'invalid_latex'
  | 'missing_target'
  | 'target_not_in_context'
  | 'target_not_text'
  | 'target_not_equation'
  | 'missing_anchor'
  | 'anchor_not_in_context'
  | 'invalid_anchor_operation_index'
  | 'invalid_relation'
  | 'invalid_coordinates'
  | 'invalid_size'
  | 'missing_size'
  | 'self_anchor'
  | 'invalid_style'
  | 'empty_style'
  | 'unknown_style_property';

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
  /** Optional: map id → type for TextElement / EquationElement checks. */
  elementTypes?: ReadonlyMap<string, string>;
}

const ALLOWED_STYLE_KEYS = new Set([
  'text_color',
  'background_color',
  'bold',
  'italic',
  'underline',
]);

const ALLOWED_OPERATIONS =
  'create_text, update_text, move_text, resize_text, delete_text, update_text_style, create_equation, update_equation, move_equation, resize_equation, delete_equation';

const CREATE_OPS_FOR_SAME_PLAN_ANCHOR = new Set(['create_text', 'create_equation']);

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

function requireValidLatex(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new CanvasAgentParseError('empty_latex', `${field} must be a non-empty LaTeX string.`);
  }
  const corruption = detectSilentLatexJsonCorruption(raw);
  if (corruption) {
    throw new CanvasAgentParseError('invalid_latex', corruption, raw.slice(0, 120));
  }
  const cleaned = sanitizeLatexSource(raw);
  if (!cleaned) {
    throw new CanvasAgentParseError('empty_latex', `${field} must be a non-empty LaTeX string.`);
  }
  const validation = validateLatex(cleaned, true);
  if (!validation.ok) {
    throw new CanvasAgentParseError(
      'invalid_latex',
      `${field} is not valid KaTeX LaTeX: ${validation.error ?? 'unknown error'}`,
      validation.error ?? undefined,
    );
  }
  return cleaned;
}

function requireTargetId(raw: Record<string, unknown>, opName: string): string {
  const target = raw.target_element_id;
  if (typeof target !== 'string' || !target.trim()) {
    throw new CanvasAgentParseError('missing_target', `${opName} needs target_element_id.`);
  }
  return target.trim();
}

/**
 * Parse + normalize a style patch object.
 * Rejects unknown keys. For update_text_style, requireNonEmpty rejects {}.
 */
export function parseTextStylePatch(
  raw: unknown,
  options: { requireNonEmpty: boolean } = { requireNonEmpty: false },
): TextStylePatch {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('invalid_style', 'style must be an object.');
  }

  const unknownKeys = Object.keys(raw).filter((k) => !ALLOWED_STYLE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new CanvasAgentParseError(
      'unknown_style_property',
      `Unknown style propert${unknownKeys.length === 1 ? 'y' : 'ies'}: ${unknownKeys.join(', ')}.`,
      unknownKeys.join(','),
    );
  }

  const draft: TextStylePatch = {};
  if ('text_color' in raw) {
    if (typeof raw.text_color !== 'string') {
      throw new CanvasAgentParseError('invalid_style', 'text_color must be a string.');
    }
    draft.text_color = raw.text_color;
  }
  if ('background_color' in raw) {
    if (raw.background_color !== null && typeof raw.background_color !== 'string') {
      throw new CanvasAgentParseError(
        'invalid_style',
        'background_color must be a string or null.',
      );
    }
    draft.background_color = raw.background_color as string | null;
  }
  if ('bold' in raw) {
    draft.bold = raw.bold as boolean;
  }
  if ('italic' in raw) {
    draft.italic = raw.italic as boolean;
  }
  if ('underline' in raw) {
    draft.underline = raw.underline as boolean;
  }

  let normalized: TextStylePatch;
  try {
    normalized = normalizeTextStylePatch(draft);
  } catch (err) {
    if (err instanceof ColorNormalizeFailure) {
      throw new CanvasAgentParseError('invalid_style', err.message, err.code);
    }
    throw err;
  }

  if (options.requireNonEmpty && isEmptyStylePatch(normalized)) {
    throw new CanvasAgentParseError(
      'empty_style',
      'update_text_style.style must include at least one property.',
    );
  }

  return normalized;
}

function parsePlacement(raw: unknown): Placement {
  if (!isRecord(raw) || typeof raw.mode !== 'string') {
    throw new CanvasAgentParseError('schema', 'placement.mode is required.');
  }
  if (raw.mode === 'viewport_default') {
    return { mode: 'viewport_default' };
  }
  if (raw.mode === 'relative_to_element') {
    const relation = raw.relation;
    if (typeof relation !== 'string' || !PLACEMENT_RELATIONS.includes(relation as PlacementRelation)) {
      throw new CanvasAgentParseError(
        'invalid_relation',
        `relation must be one of: ${PLACEMENT_RELATIONS.join(', ')}.`,
        String(relation),
      );
    }

    const hasElementId =
      typeof raw.anchor_element_id === 'string' && raw.anchor_element_id.trim().length > 0;
    const hasOpIndex =
      typeof raw.anchor_operation_index === 'number' &&
      Number.isInteger(raw.anchor_operation_index);

    if (!hasElementId && raw.anchor_operation_index !== undefined && !hasOpIndex) {
      throw new CanvasAgentParseError(
        'invalid_anchor_operation_index',
        'anchor_operation_index must be a non-negative integer.',
        String(raw.anchor_operation_index),
      );
    }

    if (!hasElementId && !hasOpIndex) {
      throw new CanvasAgentParseError(
        'missing_anchor',
        'relative placement needs anchor_element_id or anchor_operation_index.',
      );
    }

    const placement: RelativePlacement = {
      mode: 'relative_to_element',
      relation: relation as PlacementRelation,
    };
    if (hasElementId) {
      placement.anchor_element_id = (raw.anchor_element_id as string).trim();
    }
    if (hasOpIndex) {
      placement.anchor_operation_index = raw.anchor_operation_index as number;
    }
    return placement;
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
  opName: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CanvasAgentParseError(
      'invalid_size',
      `${opName}.${field} must be a finite number.`,
      String(value),
    );
  }
  const min = field === 'width' ? AI_TEXT_MIN_WIDTH : AI_TEXT_MIN_HEIGHT;
  const max = field === 'width' ? AI_TEXT_MAX_WIDTH : AI_TEXT_MAX_HEIGHT;
  if (value < min || value > max) {
    throw new CanvasAgentParseError(
      'invalid_size',
      `${opName}.${field} must be between ${min} and ${max}.`,
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
    const op: CreateTextOperation = { type: 'create_text', text, placement };
    if (raw.style !== undefined) {
      op.style = parseTextStylePatch(raw.style, { requireNonEmpty: false });
    }
    return op;
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
    if (hasWidth) op.width = validateDimension(raw.width, 'width', 'resize_text');
    if (hasHeight) op.height = validateDimension(raw.height, 'height', 'resize_text');
    return op;
  }
  if (raw.type === 'delete_text') {
    const target_element_id = requireTargetId(raw, 'delete_text');
    return { type: 'delete_text', target_element_id } satisfies DeleteTextOperation;
  }
  if (raw.type === 'update_text_style') {
    const target_element_id = requireTargetId(raw, 'update_text_style');
    if (raw.style === undefined) {
      throw new CanvasAgentParseError(
        'invalid_style',
        'update_text_style requires a style object.',
      );
    }
    const style = parseTextStylePatch(raw.style, { requireNonEmpty: true });
    return {
      type: 'update_text_style',
      target_element_id,
      style,
    } satisfies UpdateTextStyleOperation;
  }
  if (raw.type === 'create_equation') {
    const latex = requireValidLatex(raw.latex, 'create_equation.latex');
    const placement = parsePlacement(raw.placement);
    return { type: 'create_equation', latex, placement } satisfies CreateEquationOperation;
  }
  if (raw.type === 'update_equation') {
    const target_element_id = requireTargetId(raw, 'update_equation');
    const latex = requireValidLatex(raw.latex, 'update_equation.latex');
    return {
      type: 'update_equation',
      target_element_id,
      latex,
    } satisfies UpdateEquationOperation;
  }
  if (raw.type === 'move_equation') {
    const target_element_id = requireTargetId(raw, 'move_equation');
    const placement = parsePlacement(raw.placement);
    return {
      type: 'move_equation',
      target_element_id,
      placement,
    } satisfies MoveEquationOperation;
  }
  if (raw.type === 'resize_equation') {
    const target_element_id = requireTargetId(raw, 'resize_equation');
    const hasWidth = raw.width !== undefined;
    const hasHeight = raw.height !== undefined;
    if (!hasWidth && !hasHeight) {
      throw new CanvasAgentParseError(
        'missing_size',
        'resize_equation requires width and/or height.',
      );
    }
    const op: ResizeEquationOperation = { type: 'resize_equation', target_element_id };
    if (hasWidth) op.width = validateDimension(raw.width, 'width', 'resize_equation');
    if (hasHeight) op.height = validateDimension(raw.height, 'height', 'resize_equation');
    return op;
  }
  if (raw.type === 'delete_equation') {
    const target_element_id = requireTargetId(raw, 'delete_equation');
    return { type: 'delete_equation', target_element_id } satisfies DeleteEquationOperation;
  }
  throw new CanvasAgentParseError(
    'unknown_operation',
    `Unsupported operation type "${raw.type}". Allowed: ${ALLOWED_OPERATIONS}.`,
    String(raw.type),
  );
}

function assertTargetInContext(
  id: string,
  ctx: ParseContext,
  expectedType: 'text' | 'equation',
): void {
  if (!ctx.allowedElementIds.has(id)) {
    throw new CanvasAgentParseError(
      'target_not_in_context',
      `target_element_id "${id}" was not in the supplied canvas context.`,
      id,
    );
  }
  const t = ctx.elementTypes?.get(id);
  if (t === undefined) return;
  if (expectedType === 'text' && t !== 'text') {
    throw new CanvasAgentParseError(
      'target_not_text',
      `target_element_id "${id}" is not a TextElement.`,
      id,
    );
  }
  if (expectedType === 'equation' && t !== 'equation') {
    throw new CanvasAgentParseError(
      'target_not_equation',
      `target_element_id "${id}" is not an EquationElement.`,
      id,
    );
  }
}

function assertRelativePlacement(
  placement: Placement,
  ctx: ParseContext,
  ops: readonly CanvasOperation[],
  opIndex: number,
  targetId?: string,
): void {
  if (placement.mode !== 'relative_to_element') return;

  if (placement.anchor_element_id) {
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
        'Cannot use the target as its own placement anchor.',
        id,
      );
    }
  }

  if (placement.anchor_operation_index !== undefined) {
    const j = placement.anchor_operation_index;
    if (!Number.isInteger(j) || j < 0 || j >= opIndex) {
      throw new CanvasAgentParseError(
        'invalid_anchor_operation_index',
        `anchor_operation_index ${j} must be an integer in [0, ${opIndex}) for operation ${opIndex}.`,
        String(j),
      );
    }
    const anchorOp = ops[j];
    if (!anchorOp || !CREATE_OPS_FOR_SAME_PLAN_ANCHOR.has(anchorOp.type)) {
      throw new CanvasAgentParseError(
        'invalid_anchor_operation_index',
        `anchor_operation_index ${j} must refer to an earlier create_text or create_equation.`,
        String(j),
      );
    }
  }

  if (!placement.anchor_element_id && placement.anchor_operation_index === undefined) {
    throw new CanvasAgentParseError(
      'missing_anchor',
      'relative placement needs anchor_element_id or anchor_operation_index.',
    );
  }
}

function semanticValidate(
  op: CanvasOperation,
  ctx: ParseContext,
  ops: readonly CanvasOperation[],
  opIndex: number,
): void {
  if (
    op.type === 'update_text' ||
    op.type === 'move_text' ||
    op.type === 'resize_text' ||
    op.type === 'delete_text' ||
    op.type === 'update_text_style'
  ) {
    assertTargetInContext(op.target_element_id, ctx, 'text');
  }
  if (
    op.type === 'update_equation' ||
    op.type === 'move_equation' ||
    op.type === 'resize_equation' ||
    op.type === 'delete_equation'
  ) {
    assertTargetInContext(op.target_element_id, ctx, 'equation');
  }
  if (op.type === 'create_text' || op.type === 'create_equation') {
    assertRelativePlacement(op.placement, ctx, ops, opIndex);
  }
  if (op.type === 'move_text' || op.type === 'move_equation') {
    assertRelativePlacement(op.placement, ctx, ops, opIndex, op.target_element_id);
  }
}

export interface ParseCanvasAgentResult {
  response: CanvasAgentResponse;
  repair: LatexJsonRepairMeta;
}

function tryJsonParse(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

function emptyRepairMeta(rawResponse: string): LatexJsonRepairMeta {
  return {
    applied: false,
    rawResponse,
    repairedResponse: null,
    repairCount: 0,
    message: null,
  };
}

/**
 * Manual-LLM ingestion path:
 *   raw → try JSON.parse → if fail OR silent latex corruption →
 *   targeted latex-field repair on ORIGINAL → JSON.parse again →
 *   schema → latex validation.
 *
 * Does not invent ops or touch non-latex fields. System prompt rules for
 * correct escaping remain in force; repair is a recovery layer only.
 */
export function parseCanvasAgentResponse(
  raw: string,
  ctx: ParseContext,
): ParseCanvasAgentResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new CanvasAgentParseError('empty', 'Response cannot be empty.');
  }

  const source = stripCodeFences(trimmed);
  let repair = emptyRepairMeta(source);
  let parsed: unknown;

  const first = tryJsonParse(source);
  const needsRepair =
    !first.ok ||
    (first.ok && parsedLatexLooksCorrupted(collectLatexStrings(first.value)));

  if (!needsRepair && first.ok) {
    parsed = first.value;
  } else {
    const { repaired, changed, repairCount } = repairLatexJsonFields(source);
    repair = {
      applied: changed,
      rawResponse: source,
      repairedResponse: repaired,
      repairCount,
      message: changed ? LATEX_JSON_REPAIR_INDICATOR : null,
    };

    const second = tryJsonParse(repaired);
    if (!second.ok) {
      const firstDetail =
        !first.ok
          ? explainJsonParseFailure(source, first.error).detail
          : 'JSON parsed but latex fields contained control-character corruption.';
      const secondDetail = explainJsonParseFailure(repaired, second.error).detail;
      throw new CanvasAgentParseError(
        'invalid_json',
        'Could not parse the LLM response as structured JSON.',
        [
          firstDetail,
          `After latex-field repair: ${secondDetail}`,
          '--- RAW RESPONSE ---',
          source,
          '--- REPAIRED RESPONSE ---',
          repaired,
        ].join('\n'),
      );
    }

    if (parsedLatexLooksCorrupted(collectLatexStrings(second.value))) {
      throw new CanvasAgentParseError(
        'invalid_latex',
        'LaTeX fields still look corrupted after escape recovery.',
        [
          '--- RAW RESPONSE ---',
          source,
          '--- REPAIRED RESPONSE ---',
          repaired,
        ].join('\n'),
      );
    }

    parsed = second.value;
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

  // First pass: structural parse of every op (all-or-nothing).
  const operations: CanvasOperation[] = [];
  for (const item of parsed.operations) {
    operations.push(parseOperation(item));
  }

  // Second pass: semantic validation with same-plan index awareness.
  for (let i = 0; i < operations.length; i++) {
    semanticValidate(operations[i]!, ctx, operations, i);
  }

  return { response: { operations }, repair };
}

/** Human-readable plan lines for the debug UI. */
export function describeOperationPlan(ops: readonly CanvasOperation[]): string[] {
  return describeOperationPlanLines(ops);
}

export { CANVAS_AGENT_JSON_SCHEMA };
