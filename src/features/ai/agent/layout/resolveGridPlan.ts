/**
 * Orchestrate measure → reflow → grid layout → canvas placement → final validation.
 */

import type { Camera, CanvasElement, StyleDefaults } from '../../../../types/canvas';
import type { NoteStructure } from '../../../structures/types';
import type {
  AgentOutputType,
  AnyLayoutSpec,
  CanvasOperation,
  ChronologicalGridLayoutSpec,
  GridLayoutSpec,
} from '../operations';
import { isChronologicalGridLayout } from '../operations';
import { getOutputLayoutConfig } from './outputLayoutConfig';
import {
  getDefaultViewportSize,
  getVisibleWorldBounds,
  type ViewportSize,
} from '../../canvas/placement';
import { calculateGridLayout } from './gridLayoutEngine';
import { placeGridOnCanvas } from './canvasPlacementEngine';
import { collectCanvasObstacles } from './obstacles';
import { measureLayoutItems } from './measure';
import { collidesAny } from './collision';
import { GRID_LAYOUT_CONFIG } from './gridConfig';
import {
  maxColumnsForObjectCount,
  normalizeGridLayout,
  reduceColumnsForWidth,
} from './gridReflow';
import {
  calculateChronologicalCellGrid,
  ChronologicalCellLayoutError,
  groupCreationOpsIntoCells,
} from './chronologicalCellLayout';
import type { CanvasPlacementResult, GridLayoutResult, LayoutDebugInfo } from './types';

export type ResolveGridPlanInput = {
  layout: AnyLayoutSpec;
  operations: readonly CanvasOperation[];
  camera: Camera;
  elements: CanvasElement[];
  style: StyleDefaults;
  viewport?: ViewportSize;
  getStructureById?: (id: string) => NoteStructure | null;
  includeHandwriting?: boolean;
  /** LLM-selected output preset; defaults to lesson. */
  outputType?: AgentOutputType;
};

export type ResolveGridPlanResult = {
  grid: GridLayoutResult;
  placement: CanvasPlacementResult;
  debug: LayoutDebugInfo;
  /** Effective layout after reflow (may differ from LLM request). */
  effectiveLayout: GridLayoutSpec | ChronologicalGridLayoutSpec;
  /** ref → world position + size for element creation */
  byRef: Map<
    string,
    { x: number; y: number; width: number; height: number }
  >;
};

function countRows(layout: GridLayoutSpec): number {
  if (layout.items.length === 0) return 0;
  return Math.max(0, ...layout.items.map((i) => i.row)) + 1;
}

function finalizePlacement(input: {
  grid: GridLayoutResult;
  placementSpec: GridLayoutSpec['placement'];
  camera: Camera;
  elements: CanvasElement[];
  viewport: ViewportSize;
  includeHandwriting?: boolean;
  diagnostics: string[];
  objectCount: number;
  maxColumns: number;
  requestedColumns: number;
  requestedRows: number;
  columns: number;
  rows: number;
  wrapped: boolean;
  wrapReason: string;
  widthWrapped: boolean;
  chronologicalCells?: LayoutDebugInfo['chronologicalCells'];
  effectiveLayout: GridLayoutSpec | ChronologicalGridLayoutSpec;
  outputType?: AgentOutputType;
}): ResolveGridPlanResult {
  const obstacles = collectCanvasObstacles(input.elements, {
    includeHandwriting: input.includeHandwriting,
    margin: GRID_LAYOUT_CONFIG.collisionMargin,
  });

  const placement = placeGridOnCanvas({
    grid: input.grid,
    placement: input.placementSpec,
    camera: input.camera,
    elements: input.elements,
    obstacles,
    viewport: input.viewport,
  });

  const worldRects = placement.worldItems.map((i) => i.worldCollision);
  for (let i = 0; i < worldRects.length; i++) {
    for (let j = i + 1; j < worldRects.length; j++) {
      if (collidesAny(worldRects[i]!, [worldRects[j]!], 0)) {
        throw new Error(
          `Final validation failed: generated items "${placement.worldItems[i]!.ref}" and "${placement.worldItems[j]!.ref}" overlap.`,
        );
      }
    }
    if (collidesAny(worldRects[i]!, obstacles, 0)) {
      throw new Error(
        `Final validation failed: "${placement.worldItems[i]!.ref}" overlaps existing canvas content.`,
      );
    }
  }

  const byRef = new Map(
    placement.worldItems.map((i) => [
      i.ref,
      { x: i.worldX, y: i.worldY, width: i.width, height: i.height },
    ]),
  );

  const debug: LayoutDebugInfo = {
    objectCount: input.objectCount,
    maxColumns: input.maxColumns,
    requestedColumns: input.requestedColumns,
    requestedRows: input.requestedRows,
    columns: input.columns,
    rows: input.rows,
    wrapped: input.wrapped,
    wrapReason: input.wrapReason,
    widthWrapped: input.widthWrapped,
    columnWidths: input.grid.columnWidths,
    rowHeights: input.grid.rowHeights,
    items: placement.worldItems.map((i) => ({
      ref: i.ref,
      row: i.row,
      column: i.column,
      columnSpan: i.columnSpan,
      width: i.width,
      height: i.height,
      localX: i.localX,
      localY: i.localY,
      textAutoSize: i.textAutoSize,
    })),
    localBounds: input.grid.bounds,
    preferredOrigin: placement.preferredOrigin,
    finalOrigin: placement.origin,
    candidatesTested: placement.candidatesTested,
    collidedAtPreferred: placement.collidedAtPreferred,
    collisionFree: true,
    obstacleCount: obstacles.length,
    diagnostics: input.diagnostics,
    ...(input.chronologicalCells
      ? { chronologicalCells: input.chronologicalCells }
      : {}),
    ...(input.outputType ? { outputType: input.outputType } : {}),
  };

  return {
    grid: input.grid,
    placement,
    debug,
    effectiveLayout: input.effectiveLayout,
    byRef,
  };
}

function resolveChronologicalGrid(
  input: ResolveGridPlanInput,
  layout: ChronologicalGridLayoutSpec,
): ResolveGridPlanResult {
  const diagnostics: string[] = [];
  const outputConfig = getOutputLayoutConfig(input.outputType);
  let grouped;
  try {
    grouped = groupCreationOpsIntoCells(
      input.operations,
      outputConfig.maxObjectsPerCell,
    );
  } catch (err) {
    if (err instanceof ChronologicalCellLayoutError) {
      throw new Error(err.message);
    }
    throw err;
  }
  diagnostics.push(...grouped.diagnostics);

  const objectCount = grouped.objectCount;
  const isVerticalSequence = outputConfig.gridArrangement === 'vertical_sequence';
  const maxColumns = isVerticalSequence ? 1 : maxColumnsForObjectCount(objectCount);
  const requestedColumns = isVerticalSequence ? 1 : (layout.columns ?? maxColumns);
  const refs = new Set(grouped.objectOrder);

  const measured = measureLayoutItems(input.operations, refs, {
    style: input.style,
    getStructureById: input.getStructureById,
  });

  if (measured.length !== objectCount) {
    const have = new Set(measured.map((m) => m.ref));
    const missing = grouped.objectOrder.filter((r) => !have.has(r));
    throw new Error(
      `Could not measure layout items: missing refs ${missing.join(', ')}.`,
    );
  }

  let calc = calculateChronologicalCellGrid({
    layout,
    operations: input.operations,
    measured,
    objectCount,
    outputConfig,
  });
  diagnostics.push(...calc.grid.diagnostics);

  const viewport = input.viewport ?? getDefaultViewportSize();
  const visible = getVisibleWorldBounds(input.camera, viewport);
  const usableWidth = visible.width * 0.92;

  let columns = calc.effectiveCellLayout.columns;
  let wrapped = calc.cellDebug.wrapped || (!isVerticalSequence && columns < requestedColumns);
  let wrapReason = calc.cellDebug.wrapReason;
  let widthWrapped = false;
  let guard = 0;

  // Lesson only: reduce columns when physically too wide.
  while (
    !isVerticalSequence &&
    calc.grid.bounds.width > Math.max(usableWidth * 1.15, 480) &&
    columns > 1 &&
    guard < 4
  ) {
    guard += 1;
    const nextColumns = columns - 1;
    calc = calculateChronologicalCellGrid({
      layout: { ...layout, columns: nextColumns },
      operations: input.operations,
      measured,
      objectCount,
      outputConfig,
    });
    diagnostics.push(
      `Physical width wrap: reduced chronological columns ${columns} → ${nextColumns}.`,
    );
    diagnostics.push(...calc.grid.diagnostics);
    columns = nextColumns;
    wrapped = true;
    widthWrapped = true;
    wrapReason = 'physical_width';
  }

  if (!isVerticalSequence && columns > maxColumns) {
    calc = calculateChronologicalCellGrid({
      layout: { ...layout, columns: maxColumns },
      operations: input.operations,
      measured,
      objectCount,
      outputConfig,
    });
    diagnostics.push(...calc.grid.diagnostics);
    columns = maxColumns;
    wrapped = true;
    wrapReason = 'exceeded_max_columns';
  }

  const rows =
    calc.cellDebug.cells.length === 0
      ? 0
      : Math.max(...calc.cellDebug.cells.map((c) => c.row)) + 1;

  return finalizePlacement({
    grid: calc.grid,
    placementSpec: layout.placement,
    camera: input.camera,
    elements: input.elements,
    viewport,
    includeHandwriting: input.includeHandwriting,
    diagnostics,
    objectCount,
    maxColumns,
    requestedColumns,
    requestedRows: 0,
    columns,
    rows,
    wrapped,
    wrapReason,
    widthWrapped,
    chronologicalCells: calc.cellDebug,
    effectiveLayout: { type: 'chronological_grid', placement: layout.placement, columns },
    outputType: outputConfig.outputType,
  });
}

/**
 * Agent-generated multi-element layouts always use a single vertical column
 * in operation order. Explicit multi-column `grid` specs from the LLM are
 * accepted for backward compatibility but do not control geometry.
 */
export function resolveGridPlan(input: ResolveGridPlanInput): ResolveGridPlanResult {
  const chronoLayout: ChronologicalGridLayoutSpec = isChronologicalGridLayout(
    input.layout,
  )
    ? { ...input.layout, columns: 1 }
    : {
        type: 'chronological_grid',
        placement:
          'placement' in input.layout && input.layout.placement
            ? input.layout.placement
            : { mode: 'viewport_default' },
        columns: 1,
      };
  // Explicit multi-column grids from the LLM are ignored for geometry;
  // resolveExplicitGridPlan remains available for non-agent callers/tests.
  return resolveChronologicalGrid(
    { ...input, layout: chronoLayout },
    chronoLayout,
  );
}

/** Explicit multi-column grid resolver — retained for tests / non-agent use. */
export function resolveExplicitGridPlan(
  input: ResolveGridPlanInput & { layout: GridLayoutSpec },
): ResolveGridPlanResult {
  const diagnostics: string[] = [];
  const workingLayout: GridLayoutSpec = input.layout;

  const objectCount = workingLayout.items.length;
  const maxColumns = maxColumnsForObjectCount(objectCount);
  const requestedColumns = workingLayout.columns;
  const requestedRows = countRows(workingLayout);

  // Object-count normalisation — always enforce finalColumns <= max_columns(N).
  let reflow = normalizeGridLayout(workingLayout);
  diagnostics.push(...reflow.diagnostics);
  let layout = reflow.layout;
  let wrapped = reflow.wrapped;
  let wrapReason = reflow.wrapReason;
  let widthWrapped = false;

  const refs = new Set(layout.items.map((i) => i.ref));
  const measured = measureLayoutItems(input.operations, refs, {
    style: input.style,
    getStructureById: input.getStructureById,
  });

  if (measured.length !== layout.items.length) {
    const have = new Set(measured.map((m) => m.ref));
    const missing = layout.items.filter((i) => !have.has(i.ref)).map((i) => i.ref);
    throw new Error(
      `Could not measure layout items: missing refs ${missing.join(', ')}.`,
    );
  }

  let grid = calculateGridLayout({ layout, items: measured });
  diagnostics.push(...grid.diagnostics);

  const viewport = input.viewport ?? getDefaultViewportSize();
  const visible = getVisibleWorldBounds(input.camera, viewport);
  const usableWidth = visible.width * 0.92;

  // Physical width pass — may reduce columns and remasure (bounded).
  let guard = 0;
  while (
    grid.bounds.width > Math.max(usableWidth * 1.15, 480) &&
    layout.columns > 1 &&
    guard < 4
  ) {
    guard += 1;
    const widthReflow = reduceColumnsForWidth({
      layout,
      measuredWidth: grid.bounds.width,
      usableWorldWidth: usableWidth,
      maxColumns,
    });
    if (!widthReflow.wrapped || widthReflow.finalColumns >= layout.columns) {
      break;
    }
    diagnostics.push(...widthReflow.diagnostics);
    layout = widthReflow.layout;
    wrapped = true;
    widthWrapped = true;
    wrapReason = 'physical_width';
    grid = calculateGridLayout({ layout, items: measured });
    diagnostics.push(...grid.diagnostics);
  }

  // Final invariant — never exceed dynamic max columns.
  if (layout.columns > maxColumns) {
    const force = normalizeGridLayout({ ...layout, columns: layout.columns });
    layout = force.layout;
    wrapped = true;
    wrapReason = force.wrapReason === 'none' ? 'exceeded_max_columns' : force.wrapReason;
    diagnostics.push(...force.diagnostics);
    grid = calculateGridLayout({ layout, items: measured });
    diagnostics.push(...grid.diagnostics);
  }

  const finalRows = countRows(layout);
  return finalizePlacement({
    grid,
    placementSpec: layout.placement,
    camera: input.camera,
    elements: input.elements,
    viewport,
    includeHandwriting: input.includeHandwriting,
    diagnostics,
    objectCount,
    maxColumns,
    requestedColumns,
    requestedRows,
    columns: layout.columns,
    rows: finalRows,
    wrapped,
    wrapReason,
    widthWrapped,
    effectiveLayout: layout,
  });
}

/** Preview-only resolve for debug UI. */
export function previewGridPlan(input: ResolveGridPlanInput): LayoutDebugInfo {
  try {
    return resolveGridPlan(input).debug;
  } catch (err) {
    const n = isChronologicalGridLayout(input.layout)
      ? input.operations.filter((op) =>
          ['create_text', 'create_equation', 'create_graph', 'create_structured_note'].includes(
            op.type,
          ),
        ).length
      : input.layout.items.length;
    const requestedColumns = isChronologicalGridLayout(input.layout)
      ? (input.layout.columns ?? maxColumnsForObjectCount(n))
      : input.layout.columns;
    return {
      objectCount: n,
      maxColumns: maxColumnsForObjectCount(n),
      requestedColumns,
      requestedRows: isChronologicalGridLayout(input.layout) ? 0 : countRows(input.layout),
      columns: requestedColumns,
      rows: 0,
      wrapped: false,
      wrapReason: 'none',
      widthWrapped: false,
      columnWidths: [],
      rowHeights: [],
      items: [],
      localBounds: { x: 0, y: 0, width: 0, height: 0 },
      preferredOrigin: { x: 0, y: 0 },
      finalOrigin: null,
      candidatesTested: 0,
      collidedAtPreferred: false,
      collisionFree: false,
      obstacleCount: 0,
      diagnostics: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
