/**
 * Chronological multi-object cell layout.
 * Agent-generated content uses a single vertical column (vertical_sequence +
 * vertical_stack). horizontal_pair / multi-column paths remain for non-agent
 * callers and tests. No semantic relationship optimisation.
 */

import type { Rect } from '../../canvas/placement';
import type {
  CanvasOperation,
  ChronologicalGridLayoutSpec,
  LayoutRole,
} from '../operations';
import { expandRect } from './collision';
import { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
import {
  getOutputLayoutConfig,
  LESSON_OUTPUT_LAYOUT,
  type OutputLayoutConfig,
} from './outputLayoutConfig';
import { maxColumnsForObjectCount } from './gridReflow';
import { isGridCreatableOp } from './measure';
import type {
  ChronologicalCellDebug,
  GridLayoutResult,
  MeasuredLayoutItem,
  PlacedLayoutItem,
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
  return operations.filter(isGridCreatableOp) as CreatableWithLayout[];
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

type SizedMember = {
  ref: string;
  width: number;
  height: number;
  measureWidth: number;
  initialHeight: number;
  kind: MeasuredLayoutItem['kind'];
  layoutRole?: LayoutRole;
  textAutoSize?: MeasuredLayoutItem['textAutoSize'];
};

type CellInnerArrangement = 'vertical_stack' | 'horizontal_pair' | 'single' | 'vertical_fallback';

/** Width fraction for left/right in a horizontal pair. */
function pairWidthFractions(
  left: MeasuredLayoutItem,
  right: MeasuredLayoutItem,
  leftRole?: LayoutRole,
  rightRole?: LayoutRole,
): { left: number; right: number } {
  const rightIsGraph =
    right.kind === 'graph' || rightRole === 'visualisation';
  const leftIsGraph = left.kind === 'graph' || leftRole === 'visualisation';
  if (rightIsGraph && !leftIsGraph) return { left: 0.38, right: 0.62 };
  if (leftIsGraph && !rightIsGraph) return { left: 0.62, right: 0.38 };
  const rightIsMath =
    right.kind === 'equation' || rightRole === 'mathematical_step' || rightRole === 'final_result';
  const leftIsMath =
    left.kind === 'equation' || leftRole === 'mathematical_step' || leftRole === 'final_result';
  if (rightIsMath && !leftIsMath) return { left: 0.45, right: 0.55 };
  if (leftIsMath && !rightIsMath) return { left: 0.55, right: 0.45 };
  return { left: 0.5, right: 0.5 };
}

function sizeVerticalStack(
  members: CellMember[],
  measuredByRef: Map<string, MeasuredLayoutItem>,
  innerW: number,
): { sized: SizedMember[]; contentHeight: number } {
  const sized: SizedMember[] = [];
  let sumH = 0;
  for (let i = 0; i < members.length; i++) {
    const ref = members[i]!.ref;
    const m = measuredByRef.get(ref)!;
    const width = Math.min(Math.max(m.preferredWidth, m.minWidth), innerW);
    const measureWidth = m.kind === 'text' ? innerW : width;
    const height = Math.max(m.measureHeightAtWidth(measureWidth), m.minHeight);
    const finalWidth = m.kind === 'text' ? innerW : width;
    sized.push({
      ref,
      width: finalWidth,
      height,
      measureWidth,
      initialHeight: m.preferredHeight,
      kind: m.kind,
      layoutRole: members[i]!.layoutRole,
      textAutoSize: m.textAutoSize,
    });
    sumH += height;
    if (i > 0) sumH += GRID_LAYOUT_CONFIG.cellStackGap;
  }
  return {
    sized,
    contentHeight: sumH + GRID_LAYOUT_CONFIG.cellPadding * 2,
  };
}

function sizeHorizontalPair(
  members: CellMember[],
  measuredByRef: Map<string, MeasuredLayoutItem>,
  innerW: number,
  outputConfig: OutputLayoutConfig,
  diagnostics: string[],
  cellId: string,
): { sized: SizedMember[]; contentHeight: number; arrangement: CellInnerArrangement } {
  if (members.length === 1) {
    const stack = sizeVerticalStack(members, measuredByRef, innerW);
    return { ...stack, arrangement: 'single' };
  }

  const leftMem = members[0]!;
  const rightMem = members[1]!;
  const leftM = measuredByRef.get(leftMem.ref)!;
  const rightM = measuredByRef.get(rightMem.ref)!;
  const gap = outputConfig.pairGap;
  const usable = Math.max(80, Math.min(innerW, outputConfig.maxPairWidth));

  // Textbook rule: EquationElements never sit beside their explanatory text.
  // Keep horizontal pairing for text ↔ graph (and other non-equation pairs).
  if (leftM.kind === 'equation' || rightM.kind === 'equation') {
    diagnostics.push(
      `Cell "${cellId}": equation-associated content uses vertical textbook stack.`,
    );
    const stack = sizeVerticalStack(members, measuredByRef, usable);
    return { ...stack, arrangement: 'vertical_stack' };
  }

  const minLeft = leftM.minWidth;
  const minRight = rightM.minWidth;
  if (minLeft + gap + minRight > usable + 0.5) {
    diagnostics.push(
      `Cell "${cellId}": horizontal pair exceeds max width — vertical fallback.`,
    );
    const stack = sizeVerticalStack(members, measuredByRef, usable);
    return { ...stack, arrangement: 'vertical_fallback' };
  }

  const fr = pairWidthFractions(
    leftM,
    rightM,
    leftMem.layoutRole,
    rightMem.layoutRole,
  );
  let leftW = Math.max(minLeft, usable * fr.left - gap / 2);
  let rightW = Math.max(minRight, usable * fr.right - gap / 2);
  // Fit into usable
  const total = leftW + gap + rightW;
  if (total > usable) {
    const scale = (usable - gap) / (leftW + rightW);
    leftW = Math.max(minLeft, leftW * scale);
    rightW = Math.max(minRight, usable - gap - leftW);
  }
  // Prefer not shrinking below preferred when space allows
  leftW = Math.min(
    Math.max(leftW, Math.min(leftM.preferredWidth, usable - gap - minRight)),
    usable - gap - minRight,
  );
  rightW = usable - gap - leftW;

  const leftMeasure = leftM.kind === 'text' ? leftW : Math.min(leftM.preferredWidth, leftW);
  const rightMeasure =
    rightM.kind === 'text' ? rightW : Math.min(rightM.preferredWidth, rightW);
  const leftH = Math.max(leftM.measureHeightAtWidth(leftMeasure), leftM.minHeight);
  const rightH = Math.max(rightM.measureHeightAtWidth(rightMeasure), rightM.minHeight);
  const leftFinalW = leftM.kind === 'text' ? leftW : Math.min(Math.max(leftM.preferredWidth, leftM.minWidth), leftW);
  const rightFinalW =
    rightM.kind === 'text'
      ? rightW
      : Math.min(Math.max(rightM.preferredWidth, rightM.minWidth), rightW);

  const sized: SizedMember[] = [
    {
      ref: leftMem.ref,
      width: leftFinalW,
      height: leftH,
      measureWidth: leftMeasure,
      initialHeight: leftM.preferredHeight,
      kind: leftM.kind,
      layoutRole: leftMem.layoutRole,
      textAutoSize: leftM.textAutoSize,
    },
    {
      ref: rightMem.ref,
      width: rightFinalW,
      height: rightH,
      measureWidth: rightMeasure,
      initialHeight: rightM.preferredHeight,
      kind: rightM.kind,
      layoutRole: rightMem.layoutRole,
      textAutoSize: rightM.textAutoSize,
    },
  ];

  return {
    sized,
    contentHeight: Math.max(leftH, rightH) + GRID_LAYOUT_CONFIG.cellPadding * 2,
    arrangement: 'horizontal_pair',
  };
}

function preferredCellWidth(
  cell: LayoutCell,
  measuredByRef: Map<string, MeasuredLayoutItem>,
  outputConfig: OutputLayoutConfig,
  config: GridLayoutConfig,
): number {
  if (
    outputConfig.cellArrangement === 'horizontal_pair' &&
    cell.members.length >= 2
  ) {
    const left = measuredByRef.get(cell.members[0]!.ref)!;
    const right = measuredByRef.get(cell.members[1]!.ref)!;
    // Equations always stack vertically — use column width, not pair sum.
    if (left.kind === 'equation' || right.kind === 'equation') {
      let maxW = 0;
      for (const mem of cell.members) {
        const m = measuredByRef.get(mem.ref)!;
        maxW = Math.max(maxW, Math.max(m.preferredWidth, m.minWidth));
      }
      maxW = Math.min(Math.max(maxW, config.defaultTextWidth), outputConfig.maxPairWidth);
      return maxW + config.cellPadding * 2;
    }
    const fr = pairWidthFractions(
      left,
      right,
      cell.members[0]!.layoutRole,
      cell.members[1]!.layoutRole,
    );
    const ideal =
      Math.max(left.preferredWidth, left.minWidth) / fr.left +
      outputConfig.pairGap +
      Math.max(right.preferredWidth, right.minWidth) / fr.right;
    // Simpler: sum of preferred + gap, capped
    const sum =
      Math.max(left.preferredWidth, left.minWidth) +
      outputConfig.pairGap +
      Math.max(right.preferredWidth, right.minWidth);
    return (
      Math.min(Math.max(sum, ideal * 0.5), outputConfig.maxPairWidth) +
      config.cellPadding * 2
    );
  }
  let maxW = 0;
  for (const mem of cell.members) {
    const m = measuredByRef.get(mem.ref)!;
    maxW = Math.max(maxW, Math.max(m.preferredWidth, m.minWidth));
  }
  if (outputConfig.gridArrangement === 'vertical_sequence') {
    maxW = Math.min(Math.max(maxW, config.defaultTextWidth), outputConfig.maxPairWidth);
  }
  return maxW + config.cellPadding * 2;
}

/**
 * Measure cell contents and produce per-object PlacedLayoutItems.
 */
export function calculateChronologicalCellGrid(input: {
  layout: ChronologicalGridLayoutSpec;
  operations: readonly CanvasOperation[];
  measured: MeasuredLayoutItem[];
  objectCount?: number;
  config?: GridLayoutConfig;
  outputConfig?: OutputLayoutConfig;
}): ChronologicalGridCalcResult {
  const config = input.config ?? GRID_LAYOUT_CONFIG;
  const outputConfig = input.outputConfig ?? getOutputLayoutConfig('lesson');
  const diagnostics: string[] = [];
  const grouped = groupCreationOpsIntoCells(
    input.operations,
    outputConfig.maxObjectsPerCell,
  );
  diagnostics.push(...grouped.diagnostics);
  diagnostics.push(
    `Output preset: ${outputConfig.labels.outputType} — ${outputConfig.labels.layout}, ${outputConfig.labels.cellArrangement}, max ${outputConfig.maxObjectsPerCell}/cell.`,
  );

  const objectCount = input.objectCount ?? grouped.objectCount;
  const measuredByRef = new Map(input.measured.map((m) => [m.ref, m]));
  for (const ref of grouped.objectOrder) {
    if (!measuredByRef.has(ref)) {
      throw new ChronologicalCellLayoutError(
        `Missing measurement for layout ref "${ref}".`,
      );
    }
  }

  // Column count: vertical_sequence always 1; lesson uses dynamic max.
  let columns: number;
  let requested: number;
  let maxColumns: number;
  if (outputConfig.gridArrangement === 'vertical_sequence') {
    columns = 1;
    requested = 1;
    maxColumns = 1;
    // Ignore column_span for step-by-step — each cell is a full-width step.
    for (const cell of grouped.cells) {
      cell.columnSpan = 1;
    }
  } else {
    maxColumns = maxColumnsForObjectCount(objectCount);
    requested = input.layout.columns ?? maxColumns;
    columns = Math.min(Math.max(1, requested), maxColumns);
    if (requested > maxColumns) {
      diagnostics.push(
        `Clamped chronological columns ${requested} → ${columns} (max_columns(${objectCount})=${maxColumns}).`,
      );
    }
  }

  const { placed: cellPlacements, wrapped, wrapReason } = assignCellsToGrid(
    grouped.cells,
    columns,
  );
  if (wrapped && outputConfig.gridArrangement !== 'vertical_sequence') {
    diagnostics.push(
      `Chronological row wrap: ${grouped.cells.length} cells into ${columns} column(s).`,
    );
  }

  const columnWidths = Array.from({ length: columns }, () => 0);

  for (const p of cellPlacements) {
    if (p.columnSpan !== 1) continue;
    const pref = preferredCellWidth(p.cell, measuredByRef, outputConfig, config);
    columnWidths[p.column] = Math.max(
      columnWidths[p.column]!,
      Math.max(pref, config.minTextWidth),
    );
  }
  for (let c = 0; c < columns; c++) {
    if (columnWidths[c]! < config.minTextWidth) {
      columnWidths[c] = config.minTextWidth;
    }
  }

  for (const p of cellPlacements) {
    if (p.columnSpan <= 1) continue;
    const needed = preferredCellWidth(p.cell, measuredByRef, outputConfig, config);
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

  // Cap step-by-step column width
  if (outputConfig.gridArrangement === 'vertical_sequence') {
    columnWidths[0] = Math.min(
      Math.max(columnWidths[0]!, config.minTextWidth),
      outputConfig.maxPairWidth,
    );
  }

  type SizedCell = {
    placement: PlacedCell;
    contentWidth: number;
    contentHeight: number;
    members: SizedMember[];
    arrangement: CellInnerArrangement;
    stepIndex: number | null;
  };

  const sizedCells: SizedCell[] = [];
  const maxRow = Math.max(0, ...cellPlacements.map((p) => p.row));
  const rowHeights = Array.from({ length: maxRow + 1 }, () => 0);

  let stepCounter = 0;
  for (const p of cellPlacements) {
    const cellW = cellContentWidth(
      p.column,
      p.columnSpan,
      columnWidths,
      config.columnGap,
    );
    const innerW = Math.max(40, cellW - config.cellPadding * 2);

    let sized: SizedMember[];
    let contentHeight: number;
    let arrangement: CellInnerArrangement;

    if (
      outputConfig.cellArrangement === 'horizontal_pair' &&
      p.cell.members.length >= 1
    ) {
      const result = sizeHorizontalPair(
        p.cell.members,
        measuredByRef,
        innerW,
        outputConfig,
        diagnostics,
        p.cell.cellId,
      );
      sized = result.sized;
      contentHeight = result.contentHeight;
      arrangement = result.arrangement;
    } else {
      const result = sizeVerticalStack(p.cell.members, measuredByRef, innerW);
      sized = result.sized;
      contentHeight = result.contentHeight;
      arrangement =
        p.cell.members.length === 1 ? 'single' : 'vertical_stack';
    }

    // Step numbers: skip introduction / final_result / verification solos
    const roles = p.cell.members.map((m) => m.layoutRole);
    const skipNumber =
      roles.every(
        (r) =>
          r === 'introduction' ||
          r === 'final_result' ||
          r === 'verification' ||
          r === undefined,
      ) &&
      (roles.includes('introduction') ||
        roles.includes('final_result') ||
        roles.includes('verification'));
    let stepIndex: number | null = null;
    if (
      outputConfig.outputType === 'step_by_step' &&
      !skipNumber &&
      (roles.includes('mathematical_step') ||
        roles.includes('explanation') ||
        roles.includes('given_information') ||
        roles.includes('visualisation') ||
        roles.every((r) => r === undefined))
    ) {
      // Number cells that look like working steps
      const looksLikeStep =
        roles.includes('mathematical_step') ||
        roles.includes('explanation') ||
        roles.includes('given_information') ||
        roles.includes('visualisation') ||
        (roles.every((r) => r === undefined) && p.cell.members.length >= 1);
      if (looksLikeStep && !roles.includes('introduction') && !roles.includes('final_result')) {
        stepCounter += 1;
        stepIndex = stepCounter;
      }
    }

    sizedCells.push({
      placement: p,
      contentWidth: cellW,
      contentHeight,
      members: sized,
      arrangement,
      stepIndex,
    });
    rowHeights[p.row] = Math.max(rowHeights[p.row]!, contentHeight);
  }

  for (let r = 0; r < rowHeights.length; r++) {
    if (rowHeights[r]! <= 0) rowHeights[r] = config.minEquationHeight;
  }

  const pad = config.outerPadding;
  const colStarts: number[] = [];
  let x = pad;
  for (let c = 0; c < columns; c++) {
    colStarts[c] = x;
    x += columnWidths[c]! + (c < columns - 1 ? config.columnGap : 0);
  }
  const rowStarts: number[] = [];
  let y = pad;
  const rowGap =
    outputConfig.gridArrangement === 'vertical_sequence'
      ? Math.max(config.rowGap, 36)
      : config.rowGap;
  for (let r = 0; r < rowHeights.length; r++) {
    rowStarts[r] = y;
    y += rowHeights[r]! + (r < rowHeights.length - 1 ? rowGap : 0);
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
      objectTypes: sc.members.map((m) => m.kind),
      layoutRoles: sc.members.map((m) => m.layoutRole ?? null),
      arrangement: sc.arrangement,
      stepIndex: sc.stepIndex,
      row: p.row,
      column: p.column,
      columnSpan: p.columnSpan,
      width: cellW,
      height: cellH,
      autoSplit: p.cell.autoSplit,
    });

    const useHorizontal =
      sc.arrangement === 'horizontal_pair' && sc.members.length === 2;

    if (useHorizontal) {
      const gap = outputConfig.pairGap;
      let cursorX = cellX + config.cellPadding;
      for (const mem of sc.members) {
        const localX = cursorX;
        // Top-align within cell (taller sibling defines cell height)
        const localY = cellY + config.cellPadding;
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
          textAutoSize = {
            ...textAutoSize,
            contentWidth: Math.max(mem.measureWidth - tpad * 2, 40),
            contentHeight: Math.max(0, mem.height - tpad * 2),
            finalWidth: mem.width,
            finalHeight: mem.height,
            rowExpanded: cellH > sc.contentHeight - 0.5,
            reflowChanged:
              Math.abs(mem.height - mem.initialHeight) > 0.5 ||
              Math.abs(
                mem.width - (measuredByRef.get(mem.ref)?.preferredWidth ?? mem.width),
              ) > 0.5,
          };
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
        cursorX += mem.width + gap;
      }
    } else {
      const innerContentW = Math.max(40, cellW - config.cellPadding * 2);
      let cursorY = cellY + config.cellPadding;
      for (const mem of sc.members) {
        // Text left-aligned; equations centred in the content column.
        const localX =
          mem.kind === 'equation'
            ? cellX +
              config.cellPadding +
              Math.max(0, (innerContentW - mem.width) / 2)
            : cellX + config.cellPadding;
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
          textAutoSize = {
            ...textAutoSize,
            contentWidth: Math.max(mem.measureWidth - tpad * 2, 40),
            contentHeight: Math.max(0, mem.height - tpad * 2),
            finalWidth: mem.width,
            finalHeight: mem.height,
            rowExpanded: cellH > sc.contentHeight - 0.5,
            reflowChanged:
              Math.abs(mem.height - mem.initialHeight) > 0.5 ||
              Math.abs(
                mem.width - (measuredByRef.get(mem.ref)?.preferredWidth ?? mem.width),
              ) > 0.5,
          };
          if (textAutoSize.reflowChanged) {
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
  }

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
    rowGap * Math.max(0, rowHeights.length - 1);

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
      maxObjectsPerCell: outputConfig.maxObjectsPerCell,
      chronologicalOrderingValid: grouped.chronologicalOrderingValid,
      cells: cellDebugEntries,
      objectOrder: grouped.objectOrder,
      splits: grouped.splits,
      wrapped:
        outputConfig.gridArrangement === 'vertical_sequence' ? false : wrapped,
      wrapReason:
        outputConfig.gridArrangement === 'vertical_sequence' ? 'none' : wrapReason,
      outputType: outputConfig.outputType,
      cellArrangement: outputConfig.cellArrangement,
      gridArrangement: outputConfig.gridArrangement,
      labels: outputConfig.labels,
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
