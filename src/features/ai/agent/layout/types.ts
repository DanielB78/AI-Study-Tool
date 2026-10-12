/**
 * Grid layout runtime types for multi-element AI creation.
 * Schema types live in operations.ts.
 */

import type { Rect } from '../../canvas/placement';

export type {
  GridLayoutItemSpec,
  GridLayoutSpec,
  AnyLayoutSpec,
  ChronologicalGridLayoutSpec,
} from '../operations';

/** Debug snapshot for chronological multi-object cell layout. */
export type ChronologicalCellDebug = {
  cellCount: number;
  objectCount: number;
  maxObjectsPerCell: number;
  chronologicalOrderingValid: boolean;
  cells: Array<{
    cellId: string;
    originalCellId: string;
    refs: string[];
    row: number;
    column: number;
    columnSpan: number;
    width: number;
    height: number;
    autoSplit: boolean;
  }>;
  objectOrder: string[];
  splits: Array<{
    originalCellId: string;
    memberRefs: string[];
    partCellIds: string[];
    partSizes: number[];
  }>;
  wrapped: boolean;
  wrapReason: string;
};

/** Per-textbox auto-size diagnostics for layout debug. */
export type TextAutoSizeDebug = {
  preferredWidth: number;
  contentWidth: number;
  contentHeight: number;
  finalWidth: number;
  finalHeight: number;
  wrappedLines: number | null;
  padding: number;
  autoSized: boolean;
  measuredWithDom: boolean;
  /** True when this textbox raised its grid row above its initial preferred height. */
  rowExpanded: boolean;
  /** True when final size differs from the initial preferred-width measure. */
  reflowChanged: boolean;
};

export type MeasuredLayoutItem = {
  ref: string;
  /** Creation op type for measurement diagnostics. */
  kind: 'text' | 'equation' | 'graph' | 'structured_note';
  /** Preferred content width before column allocation. */
  preferredWidth: number;
  /** Preferred content height at preferredWidth. */
  preferredHeight: number;
  /** Minimum width/height floors. */
  minWidth: number;
  minHeight: number;
  /**
   * Remeasure height given an allocated content width (text wrapping).
   * Defaults to preferredHeight when size is independent of width.
   */
  measureHeightAtWidth: (contentWidth: number) => number;
  /** Optional text auto-size snapshot (create_text only). */
  textAutoSize?: TextAutoSizeDebug;
};

export type PlacedLayoutItem = {
  ref: string;
  row: number;
  column: number;
  columnSpan: number;
  /** Local top-left within the grid (origin 0,0). */
  localX: number;
  localY: number;
  /** Actual element content size. */
  width: number;
  height: number;
  /** Cell rectangle in local coordinates (may be larger than content). */
  cell: Rect;
  /** Content rectangle in local coordinates. */
  content: Rect;
  /** Collision rectangle (content + margin) in local coordinates. */
  collision: Rect;
  textAutoSize?: TextAutoSizeDebug;
};

export type GridLayoutResult = {
  items: PlacedLayoutItem[];
  columnWidths: number[];
  rowHeights: number[];
  /** Total grid bounds in local coordinates (including outer padding). */
  bounds: Rect;
  diagnostics: string[];
};

export type ObstacleRect = Rect & {
  id: string;
  source: 'element' | 'handwriting' | 'generated';
  elementType?: string;
};

export type CanvasPlacementResult = {
  origin: { x: number; y: number };
  preferredOrigin: { x: number; y: number };
  candidatesTested: number;
  collidedAtPreferred: boolean;
  /** World-space items after translating local layout by origin. */
  worldItems: Array<PlacedLayoutItem & { worldX: number; worldY: number; worldCollision: Rect }>;
  worldBounds: Rect;
};

/** Debug snapshot for RAG / plan preview. */
export type LayoutDebugInfo = {
  objectCount: number;
  maxColumns: number;
  requestedColumns: number;
  requestedRows: number;
  columns: number;
  rows: number;
  wrapped: boolean;
  /** Why automatic wrapping ran (if it did). */
  wrapReason: string;
  /** True when physical viewport width forced fewer columns. */
  widthWrapped: boolean;
  columnWidths: number[];
  rowHeights: number[];
  items: Array<{
    ref: string;
    row: number;
    column: number;
    columnSpan: number;
    width: number;
    height: number;
    localX: number;
    localY: number;
    textAutoSize?: TextAutoSizeDebug;
  }>;
  localBounds: Rect;
  preferredOrigin: { x: number; y: number };
  finalOrigin: { x: number; y: number } | null;
  candidatesTested: number;
  collidedAtPreferred: boolean;
  collisionFree: boolean;
  obstacleCount: number;
  diagnostics: string[];
  error?: string;
  /** Present when the plan used chronological_grid. */
  chronologicalCells?: ChronologicalCellDebug;
};
