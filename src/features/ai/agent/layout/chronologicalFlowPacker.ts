/**
 * Flow packer for user-configurable chronological layout.
 *
 * Downwards: fill columns top→bottom; wrap to a new column on height limit;
 * wrap the column-group below on width limit.
 *
 * Sideways: fill rows left→right; wrap to a new row on width limit;
 * wrap the row-group right on height limit.
 *
 * A secondary limit never creates primary-axis wrapping by itself
 * (e.g. downwards + only maxRowWidth → still one unlimited column).
 */

import type { UserLayoutSettings } from './userLayoutSettings';

export type FlowCellSize = {
  id: string;
  width: number;
  height: number;
};

export type FlowPackedCell = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Group index (0-based) for multi-group wraps. */
  groupIndex: number;
  /** Column index within the group (down) or across groups (debug). */
  column: number;
  /** Row index within the group (sideways) or across groups (debug). */
  row: number;
};

export type FlowPackGaps = {
  columnGap: number;
  rowGap: number;
  outerPadding: number;
};

export type FlowPackResult = {
  cells: FlowPackedCell[];
  bounds: { width: number; height: number };
  columnWidths: number[];
  rowHeights: number[];
  wrapped: boolean;
  wrapReason: string;
  diagnostics: string[];
  groupCount: number;
};

type ColumnState = {
  items: FlowCellSize[];
  width: number;
  height: number;
};

type RowState = {
  items: FlowCellSize[];
  width: number;
  height: number;
};

function packDown(
  cells: readonly FlowCellSize[],
  settings: UserLayoutSettings,
  gaps: FlowPackGaps,
): FlowPackResult {
  const diagnostics: string[] = [];
  const maxH = settings.maxColumnHeight;
  const maxW = settings.maxRowWidth;
  const { columnGap, rowGap, outerPadding } = gaps;

  type Group = { columns: ColumnState[] };
  const groups: Group[] = [];
  let group: Group = { columns: [] };
  let current: ColumnState = { items: [], width: 0, height: 0 };
  let wrapped = false;
  let wrapReason = 'none';

  const finalizeColumn = () => {
    if (current.items.length === 0) return;
    group.columns.push(current);
    current = { items: [], width: 0, height: 0 };
  };

  const groupWidth = (g: Group, includeCurrent: boolean): number => {
    const cols = includeCurrent && current.items.length > 0
      ? [...g.columns, current]
      : g.columns;
    if (cols.length === 0) return 0;
    return (
      cols.reduce((s, c) => s + c.width, 0) +
      columnGap * Math.max(0, cols.length - 1)
    );
  };

  const startNewGroup = () => {
    finalizeColumn();
    if (group.columns.length > 0) {
      groups.push(group);
      group = { columns: [] };
      wrapped = true;
      wrapReason = 'group_wrap_width';
      diagnostics.push('Downwards: started a new column group below (max row width).');
    }
  };

  for (const cell of cells) {
    if (current.items.length === 0) {
      current.items.push(cell);
      current.width = cell.width;
      current.height = cell.height;
      continue;
    }

    const nextHeight = current.height + rowGap + cell.height;
    const fitsHeight = maxH == null || nextHeight <= maxH;

    if (fitsHeight) {
      current.items.push(cell);
      current.width = Math.max(current.width, cell.width);
      current.height = nextHeight;
      continue;
    }

    // Height budget exceeded → new column (primary wrap).
    wrapped = true;
    if (wrapReason === 'none') wrapReason = 'column_height';
    diagnostics.push(
      `Downwards: column height limit ${maxH} reached — new column for "${cell.id}".`,
    );

    // Would the new column exceed the group width limit?
    const widthAfterFinalize = groupWidth(group, true);
    const nextGroupWidth = widthAfterFinalize + columnGap + cell.width;
    if (maxW != null && group.columns.length + 1 >= 1 && nextGroupWidth > maxW) {
      // Only wrap group when we already have at least one finished column
      // (or the current column) that would make adding another exceed maxW.
      if (group.columns.length > 0 || current.items.length > 0) {
        startNewGroup();
      }
    } else {
      finalizeColumn();
    }

    current.items.push(cell);
    current.width = cell.width;
    current.height = cell.height;
  }

  finalizeColumn();
  if (group.columns.length > 0) groups.push(group);

  return materializeDown(groups, gaps, wrapped, wrapReason, diagnostics);
}

function materializeDown(
  groups: Array<{ columns: ColumnState[] }>,
  gaps: FlowPackGaps,
  wrapped: boolean,
  wrapReason: string,
  diagnostics: string[],
): FlowPackResult {
  const { columnGap, rowGap, outerPadding } = gaps;
  const packed: FlowPackedCell[] = [];
  const allColWidths: number[] = [];
  const allRowHeights: number[] = [];

  let cursorY = outerPadding;
  let maxX = outerPadding;
  let globalCol = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    let cursorX = outerPadding;
    let groupHeight = 0;

    for (let ci = 0; ci < g.columns.length; ci++) {
      const col = g.columns[ci]!;
      allColWidths[globalCol] = col.width;
      let y = cursorY;
      let localRow = 0;
      for (let i = 0; i < col.items.length; i++) {
        const item = col.items[i]!;
        packed.push({
          id: item.id,
          x: cursorX,
          y,
          // Stretch to column width so stacked cells share one content column.
          width: col.width,
          height: item.height,
          groupIndex: gi,
          column: globalCol,
          row: localRow,
        });
        // Track per-row height loosely for debug (max across overlapping rows).
        while (allRowHeights.length <= localRow) allRowHeights.push(0);
        allRowHeights[localRow] = Math.max(allRowHeights[localRow]!, item.height);
        y += item.height + (i < col.items.length - 1 ? rowGap : 0);
        localRow += 1;
      }
      groupHeight = Math.max(groupHeight, col.height);
      cursorX += col.width + (ci < g.columns.length - 1 ? columnGap : 0);
      globalCol += 1;
    }

    maxX = Math.max(maxX, cursorX);
    cursorY += groupHeight + (gi < groups.length - 1 ? rowGap : 0);
  }

  return {
    cells: packed,
    bounds: {
      width: maxX + outerPadding,
      height: cursorY + outerPadding,
    },
    columnWidths: allColWidths,
    rowHeights: allRowHeights,
    wrapped,
    wrapReason,
    diagnostics,
    groupCount: groups.length,
  };
}

function packSideways(
  cells: readonly FlowCellSize[],
  settings: UserLayoutSettings,
  gaps: FlowPackGaps,
): FlowPackResult {
  const diagnostics: string[] = [];
  const maxW = settings.maxRowWidth;
  const maxH = settings.maxColumnHeight;
  const { columnGap, rowGap, outerPadding } = gaps;

  type Group = { rows: RowState[] };
  const groups: Group[] = [];
  let group: Group = { rows: [] };
  let current: RowState = { items: [], width: 0, height: 0 };
  let wrapped = false;
  let wrapReason = 'none';

  const finalizeRow = () => {
    if (current.items.length === 0) return;
    group.rows.push(current);
    current = { items: [], width: 0, height: 0 };
  };

  const groupHeight = (g: Group, includeCurrent: boolean): number => {
    const rows =
      includeCurrent && current.items.length > 0
        ? [...g.rows, current]
        : g.rows;
    if (rows.length === 0) return 0;
    return (
      rows.reduce((s, r) => s + r.height, 0) +
      rowGap * Math.max(0, rows.length - 1)
    );
  };

  const startNewGroup = () => {
    finalizeRow();
    if (group.rows.length > 0) {
      groups.push(group);
      group = { rows: [] };
      wrapped = true;
      wrapReason = 'group_wrap_height';
      diagnostics.push('Sideways: started a new row group to the right (max column height).');
    }
  };

  for (const cell of cells) {
    if (current.items.length === 0) {
      current.items.push(cell);
      current.width = cell.width;
      current.height = cell.height;
      continue;
    }

    const nextWidth = current.width + columnGap + cell.width;
    const fitsWidth = maxW == null || nextWidth <= maxW;

    if (fitsWidth) {
      current.items.push(cell);
      current.width = nextWidth;
      current.height = Math.max(current.height, cell.height);
      continue;
    }

    // Width budget exceeded → new row (primary wrap).
    wrapped = true;
    if (wrapReason === 'none') wrapReason = 'row_width';
    diagnostics.push(
      `Sideways: row width limit ${maxW} reached — new row for "${cell.id}".`,
    );

    const heightAfterFinalize = groupHeight(group, true);
    const nextGroupHeight = heightAfterFinalize + rowGap + cell.height;
    if (maxH != null && nextGroupHeight > maxH && (group.rows.length > 0 || current.items.length > 0)) {
      startNewGroup();
    } else {
      finalizeRow();
    }

    current.items.push(cell);
    current.width = cell.width;
    current.height = cell.height;
  }

  finalizeRow();
  if (group.rows.length > 0) groups.push(group);

  return materializeSideways(groups, gaps, wrapped, wrapReason, diagnostics);
}

function materializeSideways(
  groups: Array<{ rows: RowState[] }>,
  gaps: FlowPackGaps,
  wrapped: boolean,
  wrapReason: string,
  diagnostics: string[],
): FlowPackResult {
  const { columnGap, rowGap, outerPadding } = gaps;
  const packed: FlowPackedCell[] = [];
  const allColWidths: number[] = [];
  const allRowHeights: number[] = [];

  let cursorX = outerPadding;
  let maxY = outerPadding;
  let globalRow = 0;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]!;
    let cursorY = outerPadding;
    let groupWidth = 0;

    for (let ri = 0; ri < g.rows.length; ri++) {
      const row = g.rows[ri]!;
      while (allRowHeights.length <= globalRow) allRowHeights.push(0);
      allRowHeights[globalRow] = Math.max(allRowHeights[globalRow]!, row.height);

      let x = cursorX;
      let localCol = 0;
      for (let i = 0; i < row.items.length; i++) {
        const item = row.items[i]!;
        // Top-align within the row.
        packed.push({
          id: item.id,
          x,
          y: cursorY,
          width: item.width,
          height: item.height,
          groupIndex: gi,
          column: localCol,
          row: globalRow,
        });
        while (allColWidths.length <= localCol) allColWidths.push(0);
        allColWidths[localCol] = Math.max(allColWidths[localCol]!, item.width);
        x += item.width + (i < row.items.length - 1 ? columnGap : 0);
        localCol += 1;
      }
      groupWidth = Math.max(groupWidth, row.width);
      cursorY += row.height + (ri < g.rows.length - 1 ? rowGap : 0);
      globalRow += 1;
    }

    maxY = Math.max(maxY, cursorY);
    cursorX += groupWidth + (gi < groups.length - 1 ? columnGap : 0);
  }

  return {
    cells: packed,
    bounds: {
      width: cursorX + outerPadding,
      height: maxY + outerPadding,
    },
    columnWidths: allColWidths,
    rowHeights: allRowHeights,
    wrapped,
    wrapReason,
    diagnostics,
    groupCount: groups.length,
  };
}

/**
 * Pack measured cells according to user layout settings.
 * Oversized single cells are placed intact (never clipped / split).
 */
export function packCellsChronologically(
  cells: readonly FlowCellSize[],
  settings: UserLayoutSettings,
  gaps: FlowPackGaps,
): FlowPackResult {
  if (cells.length === 0) {
    return {
      cells: [],
      bounds: { width: gaps.outerPadding * 2, height: gaps.outerPadding * 2 },
      columnWidths: [],
      rowHeights: [],
      wrapped: false,
      wrapReason: 'none',
      diagnostics: [],
      groupCount: 0,
    };
  }

  if (settings.chronologicalDirection === 'sideways') {
    return packSideways(cells, settings, gaps);
  }
  return packDown(cells, settings, gaps);
}
