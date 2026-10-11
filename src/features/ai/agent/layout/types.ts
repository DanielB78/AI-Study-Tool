/**
 * Grid layout runtime types for multi-element AI creation.
 * Schema types live in operations.ts.
 */

import type { Rect } from '../../canvas/placement';

export type {
  GridLayoutItemSpec,
  GridLayoutSpec,
} from '../operations';

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
  columns: number;
  rows: number;
  wrapped: boolean;
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
};
