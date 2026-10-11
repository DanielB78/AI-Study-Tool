/**
 * Orchestrate measure → reflow → grid layout → canvas placement → final validation.
 */

import type { Camera, CanvasElement, StyleDefaults } from '../../../../types/canvas';
import type { NoteStructure } from '../../../structures/types';
import type { CanvasOperation } from '../operations';
import type { GridLayoutSpec } from './types';
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
  reduceColumnsForWidth,
  reflowGridToMaxColumns,
} from './gridReflow';
import type { CanvasPlacementResult, GridLayoutResult, LayoutDebugInfo } from './types';

export type ResolveGridPlanInput = {
  layout: GridLayoutSpec;
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

export function resolveGridPlan(input: ResolveGridPlanInput): ResolveGridPlanResult {
  const objectCount = input.layout.items.length;
  const maxColumns = maxColumnsForObjectCount(objectCount);
  const requestedColumns = input.layout.columns;
  const diagnostics: string[] = [];

  let reflow = reflowGridToMaxColumns(input.layout, maxColumns);
  diagnostics.push(...reflow.diagnostics);
  let layout = reflow.layout;
  let wrapped = reflow.wrapped;

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

  // Physical width pass — may reduce columns once and remeasure.
  if (grid.bounds.width > Math.max(usableWidth * 1.15, 480) && layout.columns > 1) {
    const widthReflow = reduceColumnsForWidth({
      layout,
      measuredWidth: grid.bounds.width,
      usableWorldWidth: usableWidth,
      maxColumns,
    });
    if (widthReflow.wrapped && widthReflow.finalColumns < layout.columns) {
      diagnostics.push(...widthReflow.diagnostics);
      layout = widthReflow.layout;
      wrapped = true;
      grid = calculateGridLayout({ layout, items: measured });
      diagnostics.push(...grid.diagnostics);
    }
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

  const maxRow = Math.max(0, ...layout.items.map((i) => i.row));
  const debug: LayoutDebugInfo = {
    objectCount,
    maxColumns,
    requestedColumns,
    columns: layout.columns,
    rows: maxRow + 1,
    wrapped,
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
  };

  return { grid, placement, debug, effectiveLayout: layout, byRef };
}

/** Preview-only resolve for debug UI. */
export function previewGridPlan(input: ResolveGridPlanInput): LayoutDebugInfo {
  try {
    return resolveGridPlan(input).debug;
  } catch (err) {
    const n = input.layout.items.length;
    return {
      objectCount: n,
      maxColumns: maxColumnsForObjectCount(n),
      requestedColumns: input.layout.columns,
      columns: input.layout.columns,
      rows: 0,
      wrapped: false,
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
