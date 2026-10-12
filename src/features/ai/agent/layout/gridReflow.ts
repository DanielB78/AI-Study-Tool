/**
 * Dynamic column limits and deterministic grid reflow / row wrapping.
 */

import type { GridLayoutItemSpec, GridLayoutSpec } from '../operations';
import { GRID_LAYOUT_CONFIG } from './gridConfig';

/** max_columns = min(4, ceil(sqrt(N))) */
export function maxColumnsForObjectCount(n: number): number {
  if (n <= 0) return GRID_LAYOUT_CONFIG.minColumns;
  return Math.min(GRID_LAYOUT_CONFIG.maxColumns, Math.ceil(Math.sqrt(n)));
}

export type WrapReason =
  | 'none'
  | 'exceeded_max_columns'
  | 'item_overflows_max_columns'
  | 'physical_width'
  | 'cell_conflict';

export type ReflowResult = {
  layout: GridLayoutSpec;
  requestedColumns: number;
  maxColumns: number;
  finalColumns: number;
  wrapped: boolean;
  wrapReason: WrapReason;
  diagnostics: string[];
};

function sortReadingOrder(items: readonly GridLayoutItemSpec[]): GridLayoutItemSpec[] {
  return [...items].sort((a, b) => a.row - b.row || a.column - b.column);
}

function hasCellConflicts(items: readonly GridLayoutItemSpec[]): boolean {
  const occupied = new Set<string>();
  for (const item of items) {
    const span = item.column_span ?? 1;
    for (let c = item.column; c < item.column + span; c++) {
      const key = `${item.row}:${c}`;
      if (occupied.has(key)) return true;
      occupied.add(key);
    }
  }
  return false;
}

/**
 * Reflow items into at most `maxColumns` columns, preserving reading order.
 * Full-width titles (span == original columns or spanning entire row alone) keep full width.
 */
export function reflowGridToMaxColumns(
  layout: GridLayoutSpec,
  maxColumns: number,
): ReflowResult {
  const diagnostics: string[] = [];
  const requestedColumns = layout.columns;
  const n = layout.items.length;
  const cappedMax = Math.max(1, Math.min(maxColumns, GRID_LAYOUT_CONFIG.maxColumns));

  const itemOverflows = layout.items.some(
    (it) => it.column + (it.column_span ?? 1) > cappedMax,
  );
  const columnsExceed = requestedColumns > cappedMax;
  const conflicts = hasCellConflicts(layout.items);

  let wrapReason: WrapReason = 'none';
  if (columnsExceed) wrapReason = 'exceeded_max_columns';
  else if (itemOverflows) wrapReason = 'item_overflows_max_columns';
  else if (conflicts) wrapReason = 'cell_conflict';

  const needsReflow = wrapReason !== 'none';

  if (!needsReflow) {
    return {
      layout: {
        ...layout,
        // Clamp columns field even when structure is already valid.
        columns: Math.min(requestedColumns, cappedMax),
      },
      requestedColumns,
      maxColumns: cappedMax,
      finalColumns: Math.min(requestedColumns, cappedMax),
      wrapped: false,
      wrapReason: 'none',
      diagnostics,
    };
  }

  diagnostics.push(
    `Reflow: requested ${requestedColumns} columns with ${n} objects; max allowed ${cappedMax} (${wrapReason}).`,
  );

  const ordered = sortReadingOrder(layout.items);
  const finalColumns = cappedMax;
  const nextItems: GridLayoutItemSpec[] = [];
  let row = 0;
  let col = 0;

  for (const item of ordered) {
    const requestedSpan = item.column_span ?? 1;
    const wasFullWidth =
      requestedSpan >= requestedColumns ||
      (requestedSpan > 1 && item.column === 0 && requestedSpan === requestedColumns);

    let span = Math.min(requestedSpan, finalColumns);
    if (wasFullWidth) {
      span = finalColumns;
    }

    // If span doesn't fit on current row, wrap.
    if (col + span > finalColumns) {
      row += 1;
      col = 0;
    }

    // Full-width items start on their own row when mid-row.
    if (span === finalColumns && col !== 0) {
      row += 1;
      col = 0;
    }

    nextItems.push({
      ref: item.ref,
      row,
      column: col,
      column_span: span === 1 ? undefined : span,
    });

    col += span;
    if (col >= finalColumns) {
      row += 1;
      col = 0;
    }
  }

  return {
    layout: {
      ...layout,
      columns: finalColumns,
      items: nextItems,
    },
    requestedColumns,
    maxColumns: cappedMax,
    finalColumns,
    wrapped: true,
    wrapReason,
    diagnostics,
  };
}

/**
 * Normalize a requested layout against object-count column limits.
 * Always returns finalColumns <= maxColumnsForObjectCount(N).
 */
export function normalizeGridLayout(layout: GridLayoutSpec): ReflowResult {
  const maxColumns = maxColumnsForObjectCount(layout.items.length);
  return reflowGridToMaxColumns(layout, maxColumns);
}

/**
 * If measured grid width exceeds usable viewport width, reduce columns and reflow.
 * Does not shrink individual unreadable elements — only column count.
 */
export function reduceColumnsForWidth(input: {
  layout: GridLayoutSpec;
  measuredWidth: number;
  usableWorldWidth: number;
  maxColumns: number;
}): ReflowResult {
  const diagnostics: string[] = [];
  let layout = input.layout;
  let columns = layout.columns;
  let wrapped = false;
  let wrapReason: WrapReason = 'none';
  const maxColumns = input.maxColumns;

  // Allow grids modestly wider than viewport; only reflow when clearly excessive.
  const limit = Math.max(input.usableWorldWidth * 1.15, 480);
  if (!(columns > 1 && input.measuredWidth > limit)) {
    return {
      layout,
      requestedColumns: input.layout.columns,
      maxColumns,
      finalColumns: layout.columns,
      wrapped: false,
      wrapReason: 'none',
      diagnostics,
    };
  }

  const target = Math.max(1, columns - 1);
  if (target >= columns) {
    return {
      layout,
      requestedColumns: input.layout.columns,
      maxColumns,
      finalColumns: layout.columns,
      wrapped: false,
      wrapReason: 'none',
      diagnostics,
    };
  }

  diagnostics.push(
    `Width ${input.measuredWidth.toFixed(0)} exceeds usable ${limit.toFixed(0)}; reducing columns ${columns} → ${target}.`,
  );
  const reflowed = reflowGridToMaxColumns({ ...layout, columns }, target);
  layout = reflowed.layout;
  wrapped = true;
  wrapReason = 'physical_width';
  diagnostics.push(...reflowed.diagnostics);

  return {
    layout,
    requestedColumns: input.layout.columns,
    maxColumns,
    finalColumns: layout.columns,
    wrapped,
    wrapReason,
    diagnostics,
  };
}
