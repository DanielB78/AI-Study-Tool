/**
 * Chronological multi-object cell layout.
 * LLM order + optional layout_cell → vertical stacks → row-major grid.
 * No semantic relationship optimisation.
 */

import type { Rect } from '../../canvas/placement';
import type { CanvasOperation, ChronologicalGridLayoutSpec } from '../operations';
import { expandRect } from './collision';
import { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
import { maxColumnsForObjectCount } from './gridReflow';
import { isGridCreatableOp } from './measure';
import type {
  ChronologicalCellDebug,
  GridLayoutResult,
  MeasuredLayoutItem,
  PlacedLayoutItem,
} from './types';

export type { ChronologicalCellDebug };

export const MAX_OBJECTS_PER_CELL = 4;

export type CellMember = {
  ref: string;
  /** Index among creation ops (0-based). */
  creationIndex: number;
  columnSpanHint: number;
};

export type LayoutCell = {
  /** Effective cell id after any auto-split suffix. */
  cellId: string;
  /** Original layout_cell from the LLM (or synthetic solo id). */
  originalCellId: string;
  members: CellMember[];
  columnSpan: number;
  autoSplit: boolean;
};

export type CellSplitInfo = {
  originalCellId: string;
  memberRefs: string[];
  partCellIds: string[];
  partSizes: number[];
};

export type GroupCellsResult = {
  cells: LayoutCell[];
  objectOrder: string[];
  objectCount: number;
  diagnostics: string[];
  splits: CellSplitInfo[];
  chronologicalOrderingValid: boolean;
};

export class ChronologicalCellLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChronologicalCellLayoutError';
  }
}

type CreatableWithLayout = CanvasOperation & {
  type: string;
  ref?: string;
  layout_cell?: string;
  column_span?: number;
};

function creatableOps(operations: readonly CanvasOperation[]): CreatableWithLayout[] {
  return operations.filter(isGridCreatableOp) as CreatableWithLayout[];
}

/**
 * Group consecutive creation ops into cells (1–4 objects each).
 * Non-contiguous layout_cell reuse throws ChronologicalCellLayoutError.
 * Groups larger than MAX_OBJECTS_PER_CELL are auto-split in order.
 */
export function groupCreationOpsIntoCells(
  operations: readonly CanvasOperation[],
): GroupCellsResult {
  const creates = creatableOps(operations);
  const diagnostics: string[] = [];
  const objectOrder: string[] = [];
  const splits: CellSplitInfo[] = [];

  if (creates.length === 0) {
    return {
      cells: [],
      objectOrder: [],
      objectCount: 0,
      diagnostics,
      splits,
      chronologicalOrderingValid: true,
    };
  }

  // Contiguous runs of the same layout_cell (or solo synthetic cells).
  type Run = {
    originalCellId: string;
    explicit: boolean;
    members: CellMember[];
  };
  const runs: Run[] = [];
  const closedExplicit = new Set<string>();
  let open: Run | null = null;

  for (let i = 0; i < creates.length; i++) {
    const op = creates[i]!;
    if (!op.ref?.trim()) {
      throw new ChronologicalCellLayoutError(
        `Create operation at index ${i} (${op.type}) is missing "ref" required for chronological layout.`,
      );
    }
    const ref = op.ref.trim();
    if (objectOrder.includes(ref)) {
      throw new ChronologicalCellLayoutError(`Duplicate creation ref "${ref}".`);
    }
    objectOrder.push(ref);

    const explicitCell =
      typeof op.layout_cell === 'string' && op.layout_cell.trim()
        ? op.layout_cell.trim()
        : null;
    const columnSpanHint = Math.max(1, op.column_span ?? 1);
    const member: CellMember = {
      ref,
      creationIndex: i,
      columnSpanHint,
    };

    if (!explicitCell) {
      // Close any open explicit run; solo objects never share a cell.
      if (open) {
        runs.push(open);
        if (open.explicit) closedExplicit.add(open.originalCellId);
        open = null;
      }
      runs.push({
        originalCellId: `__solo_${ref}`,
        explicit: false,
        members: [member],
      });
      continue;
    }

    if (closedExplicit.has(explicitCell)) {
      throw new ChronologicalCellLayoutError(
        `Non-contiguous layout_cell "${explicitCell}": members must form one contiguous block of creation operations (ref "${ref}" reopens a closed cell).`,
      );
    }

    if (open && open.explicit && open.originalCellId === explicitCell) {
      open.members.push(member);
      continue;
    }

    if (open) {
      runs.push(open);
      if (open.explicit) closedExplicit.add(open.originalCellId);
    }
    open = {
      originalCellId: explicitCell,
      explicit: true,
      members: [member],
    };
  }
  if (open) {
    runs.push(open);
  }

  // Split oversized runs into consecutive cells of at most MAX_OBJECTS_PER_CELL.
  const cells: LayoutCell[] = [];
  for (const run of runs) {
    if (run.members.length <= MAX_OBJECTS_PER_CELL) {
      const span = Math.max(...run.members.map((m) => m.columnSpanHint), 1);
      cells.push({
        cellId: run.originalCellId,
        originalCellId: run.originalCellId,
        members: run.members,
        columnSpan: span,
        autoSplit: false,
      });
      continue;
    }

    const partCellIds: string[] = [];
    const partSizes: number[] = [];
    let part = 0;
    for (let offset = 0; offset < run.members.length; offset += MAX_OBJECTS_PER_CELL) {
      const slice = run.members.slice(offset, offset + MAX_OBJECTS_PER_CELL);
      const cellId =
        part === 0 ? run.originalCellId : `${run.originalCellId}__split_${part}`;
      const span = Math.max(...slice.map((m) => m.columnSpanHint), 1);
      cells.push({
        cellId,
        originalCellId: run.originalCellId,
        members: slice,
        columnSpan: span,
        autoSplit: true,
      });
      partCellIds.push(cellId);
      partSizes.push(slice.length);
      part += 1;
    }
    splits.push({
      originalCellId: run.originalCellId,
      memberRefs: run.members.map((m) => m.ref),
      partCellIds,
      partSizes,
    });
    diagnostics.push(
      `Auto-split layout_cell "${run.originalCellId}" (${run.members.length} objects) into ${partCellIds.length} cells of sizes [${partSizes.join(', ')}] (max ${MAX_OBJECTS_PER_CELL}).`,
    );
  }

  diagnostics.push(
    `Chronological cells: ${cells.length} cell(s) from ${objectOrder.length} object(s).`,
  );

  return {
    cells,
    objectOrder,
    objectCount: objectOrder.length,
    diagnostics,
    splits,
    chronologicalOrderingValid: true,
  };
}

function cellContentWidth(
  column: number,
  columnSpan: number,
  columnWidths: number[],
  gap: number,
): number {
  let w = 0;
  for (let c = column; c < column + columnSpan; c++) {
    w += columnWidths[c] ?? 0;
  }
  w += gap * Math.max(0, columnSpan - 1);
  return w;
}

export type ChronologicalGridCalcResult = {
  grid: GridLayoutResult;
  cellDebug: ChronologicalCellDebug;
  /** Synthetic explicit grid (one proxy item per cell) for reflow compatibility. */
  effectiveCellLayout: {
    columns: number;
    items: Array<{ ref: string; row: number; column: number; column_span?: number }>;
  };
};

type PlacedCell = {
  cell: LayoutCell;
  row: number;
  column: number;
  columnSpan: number;
};

/**
 * Assign cells to grid positions in chronological order (first-member order).
 * Row-major; wrap when span does not fit remaining columns.
 */
export function assignCellsToGrid(
  cells: readonly LayoutCell[],
  columns: number,
): { placed: PlacedCell[]; wrapped: boolean; wrapReason: string } {
  const cols = Math.max(1, columns);
  const placed: PlacedCell[] = [];
  let row = 0;
  let col = 0;
  let wrapped = false;
  let wrapReason = 'none';

  for (const cell of cells) {
    const span = Math.min(Math.max(1, cell.columnSpan), cols);
    if (col > 0 && col + span > cols) {
      row += 1;
      col = 0;
      wrapped = true;
      wrapReason = 'row_wrap';
    }
    if (span === cols && col !== 0) {
      row += 1;
      col = 0;
      wrapped = true;
      wrapReason = 'row_wrap';
    }
    placed.push({ cell, row, column: col, columnSpan: span });
    col += span;
    if (col >= cols) {
      row += 1;
      col = 0;
      if (cells.indexOf(cell) < cells.length - 1) {
        wrapped = true;
        if (wrapReason === 'none') wrapReason = 'row_wrap';
      }
    }
  }

  return { placed, wrapped, wrapReason };
}

/**
 * Measure stacked cell contents and produce per-object PlacedLayoutItems.
 */
export function calculateChronologicalCellGrid(input: {
  layout: ChronologicalGridLayoutSpec;
  operations: readonly CanvasOperation[];
  measured: MeasuredLayoutItem[];
  /** Object count N for max_columns(N); defaults to measured.length. */
  objectCount?: number;
  config?: GridLayoutConfig;
}): ChronologicalGridCalcResult {
  const config = input.config ?? GRID_LAYOUT_CONFIG;
  const diagnostics: string[] = [];
  const grouped = groupCreationOpsIntoCells(input.operations);
  diagnostics.push(...grouped.diagnostics);

  const objectCount = input.objectCount ?? grouped.objectCount;
  const maxColumns = maxColumnsForObjectCount(objectCount);
  const requested = input.layout.columns ?? maxColumns;
  const columns = Math.min(Math.max(1, requested), maxColumns);
  if (requested > maxColumns) {
    diagnostics.push(
      `Clamped chronological columns ${requested} → ${columns} (max_columns(${objectCount})=${maxColumns}).`,
    );
  }

  const measuredByRef = new Map(input.measured.map((m) => [m.ref, m]));
  for (const ref of grouped.objectOrder) {
    if (!measuredByRef.has(ref)) {
      throw new ChronologicalCellLayoutError(
        `Missing measurement for layout ref "${ref}".`,
      );
    }
  }

  const { placed: cellPlacements, wrapped, wrapReason } = assignCellsToGrid(
    grouped.cells,
    columns,
  );
  if (wrapped) {
    diagnostics.push(
      `Chronological row wrap: ${grouped.cells.length} cells into ${columns} column(s).`,
    );
  }

  // Preferred cell content sizes (before column allocation).
  const preferredCellSize = (cell: LayoutCell) => {
    let maxW = 0;
    let sumH = 0;
    for (let i = 0; i < cell.members.length; i++) {
      const m = measuredByRef.get(cell.members[i]!.ref)!;
      maxW = Math.max(maxW, Math.max(m.preferredWidth, m.minWidth));
      sumH += Math.max(m.preferredHeight, m.minHeight);
      if (i > 0) sumH += config.cellStackGap;
    }
    return {
      width: maxW + config.cellPadding * 2,
      height: sumH + config.cellPadding * 2,
    };
  };

  const columnWidths = Array.from({ length: columns }, () => 0);

  // Seed single-span preferred widths from cells.
  for (const p of cellPlacements) {
    if (p.columnSpan !== 1) continue;
    const pref = preferredCellSize(p.cell);
    columnWidths[p.column] = Math.max(
      columnWidths[p.column]!,
      Math.max(pref.width, config.minTextWidth),
    );
  }
  for (let c = 0; c < columns; c++) {
    if (columnWidths[c]! < config.minTextWidth) {
      columnWidths[c] = config.minTextWidth;
    }
  }

  // Expand for spanning cells.
  for (const p of cellPlacements) {
    if (p.columnSpan <= 1) continue;
    const needed = preferredCellSize(p.cell).width;
    const current = cellContentWidth(
      p.column,
      p.columnSpan,
      columnWidths,
      config.columnGap,
    );
    if (needed <= current) continue;
    const deficit = needed - current;
    const share = deficit / p.columnSpan;
    for (let c = p.column; c < p.column + p.columnSpan; c++) {
      columnWidths[c] = (columnWidths[c] ?? 0) + share;
    }
    diagnostics.push(
      `Expanded columns ${p.column}–${p.column + p.columnSpan - 1} by ${deficit.toFixed(1)} for cell "${p.cell.cellId}"`,
    );
  }

  // Remeasure children at allocated cell widths; compute final cell heights.
  type SizedMember = {
    ref: string;
    width: number;
    height: number;
    measureWidth: number;
    initialHeight: number;
    kind: MeasuredLayoutItem['kind'];
    textAutoSize?: MeasuredLayoutItem['textAutoSize'];
  };
  type SizedCell = {
    placement: PlacedCell;
    contentWidth: number;
    contentHeight: number;
    members: SizedMember[];
  };

  const sizedCells: SizedCell[] = [];
  const maxRow = Math.max(0, ...cellPlacements.map((p) => p.row));
  const rowHeights = Array.from({ length: maxRow + 1 }, () => 0);

  for (const p of cellPlacements) {
    const cellW = cellContentWidth(
      p.column,
      p.columnSpan,
      columnWidths,
      config.columnGap,
    );
    const innerW = Math.max(40, cellW - config.cellPadding * 2);
    const members: SizedMember[] = [];
    let sumH = 0;
    for (let i = 0; i < p.cell.members.length; i++) {
      const ref = p.cell.members[i]!.ref;
      const m = measuredByRef.get(ref)!;
      const width = Math.min(Math.max(m.preferredWidth, m.minWidth), innerW);
      const measureWidth = m.kind === 'text' ? innerW : width;
      const height = Math.max(m.measureHeightAtWidth(measureWidth), m.minHeight);
      const finalWidth = m.kind === 'text' ? innerW : width;
      members.push({
        ref,
        width: finalWidth,
        height,
        measureWidth,
        initialHeight: m.preferredHeight,
        kind: m.kind,
        textAutoSize: m.textAutoSize,
      });
      sumH += height;
      if (i > 0) sumH += config.cellStackGap;
    }
    const contentHeight = sumH + config.cellPadding * 2;
    sizedCells.push({
      placement: p,
      contentWidth: cellW,
      contentHeight,
      members,
    });
    rowHeights[p.row] = Math.max(rowHeights[p.row]!, contentHeight);
  }

  for (let r = 0; r < rowHeights.length; r++) {
    if (rowHeights[r]! <= 0) rowHeights[r] = config.minEquationHeight;
  }

  // Positions
  const pad = config.outerPadding;
  const colStarts: number[] = [];
  let x = pad;
  for (let c = 0; c < columns; c++) {
    colStarts[c] = x;
    x += columnWidths[c]! + (c < columns - 1 ? config.columnGap : 0);
  }
  const rowStarts: number[] = [];
  let y = pad;
  for (let r = 0; r < rowHeights.length; r++) {
    rowStarts[r] = y;
    y += rowHeights[r]! + (r < rowHeights.length - 1 ? config.rowGap : 0);
  }

  const placedItems: PlacedLayoutItem[] = [];
  const cellDebugEntries: ChronologicalCellDebug['cells'] = [];

  for (const sc of sizedCells) {
    const p = sc.placement;
    const cellX = colStarts[p.column]!;
    const cellY = rowStarts[p.row]!;
    const cellW = sc.contentWidth;
    const cellH = rowHeights[p.row]!;
    const cellRect: Rect = { x: cellX, y: cellY, width: cellW, height: cellH };

    cellDebugEntries.push({
      cellId: p.cell.cellId,
      originalCellId: p.cell.originalCellId,
      refs: p.cell.members.map((m) => m.ref),
      row: p.row,
      column: p.column,
      columnSpan: p.columnSpan,
      width: cellW,
      height: cellH,
      autoSplit: p.cell.autoSplit,
    });

    let cursorY = cellY + config.cellPadding;
    for (const mem of sc.members) {
      const localX = cellX + config.cellPadding;
      const localY = cursorY;
      const content: Rect = {
        x: localX,
        y: localY,
        width: mem.width,
        height: mem.height,
      };
      const collision = expandRect(content, config.collisionMargin);

      let textAutoSize = mem.textAutoSize;
      if (mem.kind === 'text' && textAutoSize) {
        const tpad = textAutoSize.padding;
        const rowExpanded = cellH > sc.contentHeight - 0.5;
        const reflowChanged =
          Math.abs(mem.height - mem.initialHeight) > 0.5 ||
          Math.abs(mem.width - (measuredByRef.get(mem.ref)?.preferredWidth ?? mem.width)) >
            0.5;
        textAutoSize = {
          ...textAutoSize,
          contentWidth: Math.max(mem.measureWidth - tpad * 2, 40),
          contentHeight: Math.max(0, mem.height - tpad * 2),
          finalWidth: mem.width,
          finalHeight: mem.height,
          rowExpanded,
          reflowChanged,
        };
        if (reflowChanged) {
          diagnostics.push(
            `Text "${mem.ref}" reflow in cell "${p.cell.cellId}": → ${mem.width.toFixed(0)}×${mem.height.toFixed(0)}`,
          );
        }
      }

      placedItems.push({
        ref: mem.ref,
        row: p.row,
        column: p.column,
        columnSpan: p.columnSpan,
        localX,
        localY,
        width: mem.width,
        height: mem.height,
        cell: cellRect,
        content,
        collision,
        textAutoSize,
      });

      cursorY += mem.height + config.cellStackGap;
    }
  }

  // Intra-grid collision (objects must not overlap).
  for (let i = 0; i < placedItems.length; i++) {
    for (let j = i + 1; j < placedItems.length; j++) {
      const a = placedItems[i]!;
      const b = placedItems[j]!;
      const overlap =
        a.collision.x < b.collision.x + b.collision.width &&
        a.collision.x + a.collision.width > b.collision.x &&
        a.collision.y < b.collision.y + b.collision.height &&
        a.collision.y + a.collision.height > b.collision.y;
      if (overlap) {
        throw new ChronologicalCellLayoutError(
          `Chronological cell layout collision between "${a.ref}" and "${b.ref}".`,
        );
      }
    }
  }

  const totalWidth =
    pad * 2 +
    columnWidths.reduce((s, w) => s + w, 0) +
    config.columnGap * Math.max(0, columns - 1);
  const totalHeight =
    pad * 2 +
    rowHeights.reduce((s, h) => s + h, 0) +
    config.rowGap * Math.max(0, rowHeights.length - 1);

  const grid: GridLayoutResult = {
    items: placedItems,
    columnWidths,
    rowHeights,
    bounds: { x: 0, y: 0, width: totalWidth, height: totalHeight },
    diagnostics,
  };

  return {
    grid,
    cellDebug: {
      cellCount: grouped.cells.length,
      objectCount: grouped.objectCount,
      maxObjectsPerCell: MAX_OBJECTS_PER_CELL,
      chronologicalOrderingValid: grouped.chronologicalOrderingValid,
      cells: cellDebugEntries,
      objectOrder: grouped.objectOrder,
      splits: grouped.splits,
      wrapped,
      wrapReason,
    },
    effectiveCellLayout: {
      columns,
      items: cellPlacements.map((p) => ({
        ref: p.cell.cellId,
        row: p.row,
        column: p.column,
        column_span: p.columnSpan === 1 ? undefined : p.columnSpan,
      })),
    },
  };
}
