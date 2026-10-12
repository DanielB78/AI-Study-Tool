/**
 * Validate grid layout specs against create operations.
 */

import { GRID_LAYOUT_CONFIG } from './layout/gridConfig';
import { isGridCreatableOp } from './layout/measure';
import type {
  CanvasOperation,
  GridLayoutItemSpec,
  GridLayoutSpec,
  Placement,
} from './operations';
import { CanvasAgentParseError } from './parseErrors';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseGridLayout(
  raw: unknown,
  parsePlacement: (raw: unknown) => Placement,
): GridLayoutSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', 'layout must be an object.');
  }
  if (raw.type !== 'grid') {
    throw new CanvasAgentParseError(
      'schema',
      'layout.type must be "grid".',
      String(raw.type),
    );
  }
  const columns = raw.columns;
  // Accept up to maxItems here — dynamic max_columns = min(4, ceil(sqrt(N))) is
  // enforced later by grid reflow so oversized LLM requests are normalised, not rejected.
  if (
    typeof columns !== 'number' ||
    !Number.isInteger(columns) ||
    columns < GRID_LAYOUT_CONFIG.minColumns ||
    columns > GRID_LAYOUT_CONFIG.maxItems
  ) {
    throw new CanvasAgentParseError(
      'schema',
      `layout.columns must be an integer from ${GRID_LAYOUT_CONFIG.minColumns} to ${GRID_LAYOUT_CONFIG.maxItems}.`,
    );
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new CanvasAgentParseError('schema', 'layout.items must be a non-empty array.');
  }
  if (raw.items.length > GRID_LAYOUT_CONFIG.maxItems) {
    throw new CanvasAgentParseError(
      'schema',
      `layout.items exceeds maximum of ${GRID_LAYOUT_CONFIG.maxItems}.`,
    );
  }

  const placement = parsePlacement(raw.placement);
  const items: GridLayoutItemSpec[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = raw.items[i];
    if (!isRecord(item)) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}] must be an object.`);
    }
    if (typeof item.ref !== 'string' || !item.ref.trim()) {
      throw new CanvasAgentParseError('schema', `layout.items[${i}].ref must be a non-empty string.`);
    }
    if (typeof item.row !== 'number' || !Number.isInteger(item.row) || item.row < 0) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].row must be a non-negative integer.`,
      );
    }
    if (item.row >= GRID_LAYOUT_CONFIG.maxRows) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].row exceeds maximum of ${GRID_LAYOUT_CONFIG.maxRows - 1}.`,
      );
    }
    if (
      typeof item.column !== 'number' ||
      !Number.isInteger(item.column) ||
      item.column < 0
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].column must be a non-negative integer.`,
      );
    }
    const span =
      item.column_span === undefined
        ? 1
        : item.column_span;
    if (typeof span !== 'number' || !Number.isInteger(span) || span < 1) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}].column_span must be a positive integer.`,
      );
    }
    if (item.column + span > columns) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items[${i}] column ${item.column} + span ${span} exceeds grid width ${columns}.`,
      );
    }
    items.push({
      ref: item.ref.trim(),
      row: item.row,
      column: item.column,
      column_span: span === 1 ? undefined : span,
    });
  }

  return { type: 'grid', columns, placement, items };
}

/**
 * Ensure refs/cells are valid and multi-create viewport_default plans use a grid.
 */
export function validateLayoutAgainstOperations(
  layout: GridLayoutSpec | undefined,
  operations: readonly CanvasOperation[],
): void {
  const creates = operations.filter(isGridCreatableOp);

  if (!layout) {
    if (creates.length < 2) return;
    const allExplicit = creates.every(
      (c) => c.placement.mode === 'relative_to_element' || c.placement.mode === 'absolute',
    );
    if (allExplicit) return;
    throw new CanvasAgentParseError(
      'schema',
      'Multiple create operations require a grid "layout" (or explicit relative/absolute placement on each). Do not assign viewport_default to every object.',
    );
  }

  const createByRef = new Map<string, CanvasOperation>();
  for (const op of creates) {
    if (!op.ref) {
      throw new CanvasAgentParseError(
        'schema',
        `${op.type} is missing "ref" required by layout.items.`,
      );
    }
    if (createByRef.has(op.ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `Duplicate operation ref "${op.ref}".`,
      );
    }
    createByRef.set(op.ref, op);
  }

  const assigned = new Set<string>();
  const occupied = new Set<string>();

  for (const item of layout.items) {
    if (!createByRef.has(item.ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items references unknown ref "${item.ref}".`,
      );
    }
    if (assigned.has(item.ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `layout.items assigns ref "${item.ref}" more than once.`,
      );
    }
    assigned.add(item.ref);

    const span = item.column_span ?? 1;
    for (let c = item.column; c < item.column + span; c++) {
      const key = `${item.row}:${c}`;
      if (occupied.has(key)) {
        throw new CanvasAgentParseError(
          'schema',
          `layout cell (${item.row}, ${c}) is occupied by more than one item.`,
        );
      }
      occupied.add(key);
    }
  }

  for (const ref of createByRef.keys()) {
    if (!assigned.has(ref)) {
      throw new CanvasAgentParseError(
        'schema',
        `Create operation ref "${ref}" is not assigned in layout.items.`,
      );
    }
  }
}
