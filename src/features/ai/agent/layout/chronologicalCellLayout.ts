/**
 * Chronological multi-object cell layout.
 *
 * Agent-generated content is packed by user layout settings (direction +
 * independent row/column limits). Default settings preserve a single
 * unlimited vertical column. horizontal_pair sizing remains for multi-member
 * cells (associations). No semantic relationship optimisation beyond layout_cell.
 */

import type {
  CanvasOperation,
  ChronologicalGridLayoutSpec,
  LayoutRole,
} from '../operations';
import type { GridLayoutConfig } from './gridConfig';
import {
  getOutputLayoutConfig,
  LESSON_OUTPUT_LAYOUT,
  type OutputLayoutConfig,
} from './outputLayoutConfig';
import {
  getUserLayoutSettings,
  type UserLayoutSettings,
} from './userLayoutSettings';
import { calculateFlowChronologicalGrid } from './calculateFlowChronologicalGrid';
import { isGridCreatableOp } from './measure';
import type {
  ChronologicalCellDebug,
  GridLayoutResult,
  MeasuredLayoutItem,
} from './types';

export type { ChronologicalCellDebug };

/** @deprecated Use OutputLayoutConfig.maxObjectsPerCell — lesson default. */
export const MAX_OBJECTS_PER_CELL = LESSON_OUTPUT_LAYOUT.maxObjectsPerCell;

export type CellMember = {
  ref: string;
  /** Index among creation ops (0-based). */
  creationIndex: number;
  columnSpanHint: number;
  layoutRole?: LayoutRole;
  kind?: MeasuredLayoutItem['kind'];
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
  maxObjectsPerCell: number;
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
  layout_role?: LayoutRole;
};

function creatableOps(operations: readonly CanvasOperation[]): CreatableWithLayout[] {
  // Creates with explicit relative/absolute placement resolve at create time
  // (e.g. content-first :::json add_text). Keep them out of the chronological grid.
  return operations.filter((op) => {
    if (!isGridCreatableOp(op)) return false;
    if (
      op.placement.mode === 'relative_to_element' ||
      op.placement.mode === 'absolute'
    ) {
      return false;
    }
    return true;
  }) as CreatableWithLayout[];
}

/**
 * Group consecutive creation ops into cells.
 * Non-contiguous layout_cell reuse throws ChronologicalCellLayoutError.
 * Groups larger than maxObjectsPerCell are auto-split in order.
 */
export function groupCreationOpsIntoCells(
  operations: readonly CanvasOperation[],
  maxObjectsPerCell: number = LESSON_OUTPUT_LAYOUT.maxObjectsPerCell,
): GroupCellsResult {
  const creates = creatableOps(operations);
  const diagnostics: string[] = [];
  const objectOrder: string[] = [];
  const splits: CellSplitInfo[] = [];
  const maxPer = Math.max(1, maxObjectsPerCell);

  if (creates.length === 0) {
    return {
      cells: [],
      objectOrder: [],
      objectCount: 0,
      diagnostics,
      splits,
      chronologicalOrderingValid: true,
      maxObjectsPerCell: maxPer,
    };
  }

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
      ...(op.layout_role ? { layoutRole: op.layout_role } : {}),
    };

    if (!explicitCell) {
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

  const cells: LayoutCell[] = [];
  for (const run of runs) {
    if (run.members.length <= maxPer) {
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
    for (let offset = 0; offset < run.members.length; offset += maxPer) {
      const slice = run.members.slice(offset, offset + maxPer);
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
      `Auto-split layout_cell "${run.originalCellId}" (${run.members.length} objects) into ${partCellIds.length} cells of sizes [${partSizes.join(', ')}] (max ${maxPer}).`,
    );
  }

  diagnostics.push(
    `Chronological cells: ${cells.length} cell(s) from ${objectOrder.length} object(s) (max ${maxPer}/cell).`,
  );

  return {
    cells,
    objectOrder,
    objectCount: objectOrder.length,
    diagnostics,
    splits,
    chronologicalOrderingValid: true,
    maxObjectsPerCell: maxPer,
  };
}

export type ChronologicalGridCalcResult = {
  grid: GridLayoutResult;
  cellDebug: ChronologicalCellDebug;
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
 * Measure cell contents and produce per-object PlacedLayoutItems.
 * Packing is driven by user layout settings (direction + independent limits).
 */
export function calculateChronologicalCellGrid(input: {
  layout: ChronologicalGridLayoutSpec;
  operations: readonly CanvasOperation[];
  measured: MeasuredLayoutItem[];
  objectCount?: number;
  config?: GridLayoutConfig;
  outputConfig?: OutputLayoutConfig;
  userLayoutSettings?: UserLayoutSettings;
}): ChronologicalGridCalcResult {
  const outputConfig = input.outputConfig ?? getOutputLayoutConfig('lesson');
  const settings = input.userLayoutSettings ?? getUserLayoutSettings();
  const grouped = groupCreationOpsIntoCells(
    input.operations,
    outputConfig.maxObjectsPerCell,
  );
  try {
    return calculateFlowChronologicalGrid({
      grouped,
      measured: input.measured,
      config: input.config,
      outputConfig,
      userLayoutSettings: settings,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'FlowChronologicalLayoutError') {
      throw new ChronologicalCellLayoutError(err.message);
    }
    throw err;
  }
}

