/**
 * Validate grid / chronological-grid layout specs against create operations.
 */

import { GRID_LAYOUT_CONFIG } from './layout/gridConfig';
import {
  ChronologicalCellLayoutError,
  groupCreationOpsIntoCells,
} from './layout/chronologicalCellLayout';
import { isGridCreatableOp } from './layout/measure';
import type {
  AnyLayoutSpec,
  CanvasOperation,
  ChronologicalGridLayoutSpec,
  GridLayoutItemSpec,
  GridLayoutSpec,
  Placement,
} from './operations';
import { CanvasAgentParseError } from './parseErrors';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseExplicitGrid(
  raw: Record<string, unknown>,
  parsePlacement: (raw: unknown) => Placement,
): GridLayoutSpec {
  const columns = raw.columns;
  // Accept up to maxItems — dynamic max enforced by reflow.
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
    const span = item.column_span === undefined ? 1 : item.column_span;
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

function parseChronologicalGrid(
  raw: Record<string, unknown>,
  parsePlacement: (raw: unknown) => Placement,
): ChronologicalGridLayoutSpec {
  let columns: number | undefined;
  if (raw.columns !== undefined) {
    if (
      typeof raw.columns !== 'number' ||
      !Number.isInteger(raw.columns) ||
      raw.columns < 1 ||
      raw.columns > GRID_LAYOUT_CONFIG.maxColumns
    ) {
      throw new CanvasAgentParseError(
        'schema',
        `chronological_grid.columns must be an integer from 1 to ${GRID_LAYOUT_CONFIG.maxColumns}.`,
      );
    }
    columns = raw.columns;
  }
  const placement = parsePlacement(raw.placement);
  return {
    type: 'chronological_grid',
    placement,
    ...(columns !== undefined ? { columns } : {}),
  };
}

/** Parse chronological_grid or explicit grid. Rejects legacy relationship_grid. */
export function parseGridLayout(
  raw: unknown,
  parsePlacement: (raw: unknown) => Placement,
): AnyLayoutSpec {
  if (!isRecord(raw)) {
    throw new CanvasAgentParseError('schema', 'layout must be an object.');
  }
  if (raw.type === 'relationship_grid') {
    throw new CanvasAgentParseError(
      'schema',
      'layout.type "relationship_grid" is no longer supported. Use "chronological_grid" with optional layout_cell on creation operations (operation order is reading order).',
      'relationship_grid',
    );
  }
  if (raw.type === 'chronological_grid') {
    return parseChronologicalGrid(raw, parsePlacement);
  }
  if (raw.type === 'grid') {
    return parseExplicitGrid(raw, parsePlacement);
  }
  throw new CanvasAgentParseError(
    'schema',
    'layout.type must be "chronological_grid" or "grid".',
    String(raw.type),
  );
}

function validateCreateRefs(
  layoutItems: ReadonlyArray<{ ref: string }>,
  operations: readonly CanvasOperation[],
): void {
  const creates = operations.filter(isGridCreatableOp);
  const createByRef = new Map<string, CanvasOperation>();
  for (const op of creates) {
    if (!op.ref) {
      throw new CanvasAgentParseError(
        'schema',
        `${op.type} is missing "ref" required by layout.items.`,
      );
    }
    if (createByRef.has(op.ref)) {
      throw new CanvasAgentParseError('schema', `Duplicate operation ref "${op.ref}".`);
    }
    createByRef.set(op.ref, op);
  }

  const assigned = new Set<string>();
  for (const item of layoutItems) {
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

function validateChronologicalAgainstOperations(
  operations: readonly CanvasOperation[],
): void {
  const creates = operations.filter(isGridCreatableOp);
  for (const op of creates) {
    if (!op.ref?.trim()) {
      throw new CanvasAgentParseError(
        'schema',
        `${op.type} is missing "ref" required by chronological_grid.`,
      );
    }
    if (op.column_span !== undefined) {
      if (
        typeof op.column_span !== 'number' ||
        !Number.isInteger(op.column_span) ||
        op.column_span < 1 ||
        op.column_span > GRID_LAYOUT_CONFIG.maxColumns
      ) {
        throw new CanvasAgentParseError(
          'schema',
          `${op.type} ref "${op.ref}" column_span must be an integer from 1 to ${GRID_LAYOUT_CONFIG.maxColumns}.`,
        );
      }
    }
  }
  const refs = new Set<string>();
  for (const op of creates) {
    if (refs.has(op.ref!)) {
      throw new CanvasAgentParseError('schema', `Duplicate operation ref "${op.ref}".`);
    }
    refs.add(op.ref!);
  }
  try {
    groupCreationOpsIntoCells(operations);
  } catch (err) {
    if (err instanceof ChronologicalCellLayoutError) {
      throw new CanvasAgentParseError('schema', err.message);
    }
    throw err;
  }
}

/**
 * Ensure refs/cells are valid and multi-create viewport_default plans use a grid.
 */
export function validateLayoutAgainstOperations(
  layout: AnyLayoutSpec | undefined,
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
      'Multiple create operations require a "layout" of type chronological_grid or grid (or explicit relative/absolute placement on each). Do not assign viewport_default to every object.',
    );
  }

  if (layout.type === 'chronological_grid') {
    validateChronologicalAgainstOperations(operations);
    return;
  }

  validateCreateRefs(layout.items, operations);

  const occupied = new Set<string>();
  for (const item of layout.items) {
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
}
