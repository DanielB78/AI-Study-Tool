/**
 * Centralized world-unit configuration for AI grid placement.
 * Values are independent of camera zoom.
 */

export const GRID_LAYOUT_CONFIG = {
  /** Horizontal gap between columns (world units). */
  columnGap: 32,
  /** Vertical gap between rows (world units). */
  rowGap: 28,
  /** Outer padding around the whole grid. */
  outerPadding: 16,
  /** Extra margin around content for collision tests. */
  collisionMargin: 12,
  /** Cell inset so content is not flush against cell edges. */
  cellPadding: 0,
  /**
   * Vertical gap between stacked objects inside a multi-object cell.
   * Must exceed 2×collisionMargin so expanded collision rects do not overlap.
   */
  cellStackGap: 28,

  minTextWidth: 200,
  maxTextWidth: 520,
  defaultTextWidth: 360,

  minEquationWidth: 120,
  minEquationHeight: 48,
  maxEquationWidth: 720,

  minGraphWidth: 360,
  minGraphHeight: 240,
  defaultGraphWidth: 600,
  defaultGraphHeight: 400,

  minStructuredWidth: 280,
  minStructuredHeight: 160,

  /** Spiral search step in world units. */
  searchStep: 80,
  /** Maximum candidate origins to try. */
  maxPlacementCandidates: 120,
  /** Max spiral ring index (candidates ≈ ring*8). */
  maxSearchRings: 24,

  maxColumns: 4,
  minColumns: 1,
  maxRows: 32,
  maxItems: 48,
} as const;

export type GridLayoutConfig = typeof GRID_LAYOUT_CONFIG;
