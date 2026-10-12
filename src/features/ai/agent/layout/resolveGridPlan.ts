/**
 * Orchestrate measure → reflow → grid layout → canvas placement → final validation.
 */

import type { Camera, CanvasElement, StyleDefaults } from '../../../../types/canvas';
import type { NoteStructure } from '../../../structures/types';
import type { AnyLayoutSpec, CanvasOperation, GridLayoutSpec } from '../operations';
import { isRelationshipGridLayout } from '../operations';
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
import { optimiseRelationshipGrid } from './relationshipOptimiser';
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
};

export type ResolveGridPlanResult = {
  grid: GridLayoutResult;
  placement: CanvasPlacementResult;
  debug: LayoutDebugInfo;
  /** Effective layout after reflow (may differ from LLM request). */
  effectiveLayout: GridLayoutSpec;
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

export function resolveGridPlan(input: ResolveGridPlanInput): ResolveGridPlanResult {
  const diagnostics: string[] = [];
  let relationshipDebug: LayoutDebugInfo['relationshipOptimiser'];

  // Relationship-grid → explicit grid via semantic optimiser.
  let workingLayout: GridLayoutSpec;
  if (isRelationshipGridLayout(input.layout)) {
    const optimised = optimiseRelationshipGrid(input.layout);
    diagnostics.push(...optimised.diagnostics);
    workingLayout = optimised.grid;
    relationshipDebug = {
      initialCost: optimised.initialCost,
      finalCost: optimised.finalCost,
      semanticCostInitial: optimised.semanticCostInitial,
      semanticCostFinal: optimised.semanticCostFinal,
      orderingCostInitial: optimised.orderingCostInitial,
      orderingCostFinal: optimised.orderingCostFinal,
      compactnessCostInitial: optimised.compactnessCostInitial,
      compactnessCostFinal: optimised.compactnessCostFinal,
      iterations: optimised.iterations,
      acceptedMoves: optimised.acceptedMoves,
      edges: optimised.undirectedEdges,
      sections: optimised.sectionOrder,
      itemMeta: input.layout.items.map((it) => ({
        ref: it.ref,
        section: it.section,
        preferredOrder: it.preferred_order ?? 0,
        requires: [...(it.requires ?? [])],
        relations: [...(it.relations ?? [])],
      })),
    };
  } else {
    workingLayout = input.layout;
  }

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

  const obstacles = collectCanvasObstacles(input.elements, {
    includeHandwriting: input.includeHandwriting,
    margin: GRID_LAYOUT_CONFIG.collisionMargin,
  });

  const placement = placeGridOnCanvas({
    grid,
    placement: layout.placement,
    camera: input.camera,
    elements: input.elements,
    obstacles,
    viewport,
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

  const finalRows = countRows(layout);
  const debug: LayoutDebugInfo = {
    objectCount,
    maxColumns,
    requestedColumns,
    requestedRows,
    columns: layout.columns,
    rows: finalRows,
    wrapped,
    wrapReason,
    widthWrapped,
    columnWidths: grid.columnWidths,
    rowHeights: grid.rowHeights,
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
    localBounds: grid.bounds,
    preferredOrigin: placement.preferredOrigin,
    finalOrigin: placement.origin,
    candidatesTested: placement.candidatesTested,
    collidedAtPreferred: placement.collidedAtPreferred,
    collisionFree: true,
    obstacleCount: obstacles.length,
    diagnostics,
    ...(relationshipDebug ? { relationshipOptimiser: relationshipDebug } : {}),
  };

  return { grid, placement, debug, effectiveLayout: layout, byRef };
}

/** Preview-only resolve for debug UI. */
export function previewGridPlan(input: ResolveGridPlanInput): LayoutDebugInfo {
  try {
    return resolveGridPlan(input).debug;
  } catch (err) {
    const n = input.layout.items.length;
    const requestedColumns = isRelationshipGridLayout(input.layout)
      ? (input.layout.columns ?? maxColumnsForObjectCount(n))
      : input.layout.columns;
    return {
      objectCount: n,
      maxColumns: maxColumnsForObjectCount(n),
      requestedColumns,
      requestedRows: isRelationshipGridLayout(input.layout) ? 0 : countRows(input.layout),
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
