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

export type ReflowResult = {
  layout: GridLayoutSpec;
  requestedColumns: number;
  maxColumns: number;
  finalColumns: number;
  wrapped: boolean;
  diagnostics: string[];
};

function sortReadingOrder(items: readonly GridLayoutItemSpec[]): GridLayoutItemSpec[] {
  return [...items].sort((a, b) => a.row - b.row || a.column - b.column);
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

  let needsReflow =
    requestedColumns > cappedMax ||
    layout.items.some(
      (it) => it.column + (it.column_span ?? 1) > cappedMax,
    );

  if (!needsReflow) {
    return {
      layout,
      requestedColumns,
      maxColumns: cappedMax,
      finalColumns: requestedColumns,
      wrapped: false,
      diagnostics,
    };
  }

  diagnostics.push(
    `Reflow: requested ${requestedColumns} columns with ${n} objects; max allowed ${cappedMax}.`,
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
    diagnostics,
  };
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
  const maxColumns = input.maxColumns;

  // Allow grids modestly wider than viewport; only reflow when clearly excessive.
  const limit = Math.max(input.usableWorldWidth * 1.15, 480);
  let guard = 0;
  while (columns > 1 && input.measuredWidth > limit && guard < 4) {
    guard += 1;
    const nextMax = columns - 1;
    if (nextMax < 1 || nextMax > maxColumns && columns <= maxColumns) {
      // still try reducing below requested if physically too wide
    }
    const target = Math.min(nextMax, maxColumns);
    if (target >= columns) break;
    diagnostics.push(
      `Width ${input.measuredWidth.toFixed(0)} exceeds usable ${limit.toFixed(0)}; reducing columns ${columns} → ${target}.`,
    );
    const reflowed = reflowGridToMaxColumns({ ...layout, columns }, target);
    layout = reflowed.layout;
    columns = reflowed.finalColumns;
    wrapped = true;
    diagnostics.push(...reflowed.diagnostics);
    // Caller must remeasure; we only adjust structure once per step.
    break;
  }

  return {
    layout,
    requestedColumns: input.layout.columns,
    maxColumns,
    finalColumns: layout.columns,
    wrapped,
    diagnostics,
  };
}
