/**
 * Derived handwriting geometry models.
 * Raw DrawingElement strokes remain canonical — these are recomputable metadata.
 */

import type { WorldRect } from './geometry';

/** Axis-aligned bounds of a single pen stroke in world coordinates. */
export interface StrokeBounds {
  strokeId: string;
  /** Owning DrawingElement id (same as strokeId in current architecture). */
  elementId: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  /** Unexpanded bounds from path points. */
  rawMinX: number;
  rawMinY: number;
  rawMaxX: number;
  rawMaxY: number;
  strokeWidth: number;
  /** Approximate path length in world units (for elongation heuristics). */
  pathLength: number;
}

export type StrokeRole = 'normal' | 'small_mark' | 'elongated';

export interface ClassifiedStroke extends StrokeBounds {
  role: StrokeRole;
}

/**
 * Approximate horizontal line of handwriting (stage A output).
 * IDs are deterministic for a detection pass (not permanently stable across edits).
 */
export interface HandwritingLine {
  id: string;
  strokeIds: string[];
  /** Left-to-right geometric order for debug (does not mutate stroke history). */
  strokeIdsLeftToRight: string[];
  bounds: WorldRect;
  rawBounds: WorldRect;
  centerY: number;
  height: number;
  minX: number;
  maxX: number;
  centerX: number;
}

/**
 * Spatial block of nearby handwriting lines (stage B output).
 * Extensible later for recognizedText / embedding / renderedCrop.
 */
export interface HandwritingRegion {
  id: string;
  strokeIds: string[];
  lineIds: string[];
  bounds: WorldRect;
  rawBounds: WorldRect;
  center: { x: number; y: number };
  width: number;
  height: number;
  lineCount: number;
  strokeCount: number;
}

export interface HandwritingScaleStats {
  typicalStrokeHeight: number;
  typicalStrokeWidth: number;
  medianLineHeight: number;
  strokeCountUsedForScale: number;
  totalStrokeCount: number;
}

export interface HandwritingDetectionResult {
  strokes: ClassifiedStroke[];
  lines: HandwritingLine[];
  regions: HandwritingRegion[];
  scale: HandwritingScaleStats;
  config: import('./handwritingConfig').HandwritingRegionDetectionConfig;
  /** Content fingerprint used for invalidation (drawing ids + geometry hash). */
  contentKey: string;
}
