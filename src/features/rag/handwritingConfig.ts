/**
 * Tunable handwriting-region detection parameters.
 * Prefer multipliers of typical handwriting height over absolute world units.
 */

export interface HandwritingRegionDetectionConfig {
  /** |centerY_a − centerY_b| ≤ this × typicalHeight → same-line vertical candidate. */
  lineVerticalTolerance: number;
  /** Max horizontal gap (× typicalHeight) between strokes on the same line. */
  maxHorizontalGapForLine: number;
  /** Max vertical gap between line bounds (× medianLineHeight) for same region. */
  maxVerticalGapForRegion: number;
  /** Min horizontal overlap ratio of the narrower line for region merge. */
  minHorizontalOverlapRatio: number;
  /** |leftEdge_a − leftEdge_b| ≤ this × medianLineHeight → alignment boost. */
  alignmentTolerance: number;
  /**
   * Marks smaller than this × typicalHeight (on both axes, or by height alone)
   * are treated as dots/punctuation and attached to the nearest line.
   */
  smallMarkThreshold: number;
  /** Padding around region rawBounds as a multiple of typicalHeight. */
  regionPadding: number;
  /** Padding around line rawBounds for debug display (× typicalHeight). */
  linePadding: number;
  /**
   * Strokes with aspect ratio ≥ this AND longest side ≥ elongatedSizeMultiple
   * × typicalHeight are treated as elongated (arrows / long lines) and must not
   * bridge otherwise separate groups.
   */
  elongatedAspectRatio: number;
  /** See elongatedAspectRatio. */
  elongatedSizeMultiple: number;
  /**
   * Strokes larger than this × typicalHeight (longest side) are excluded from
   * scale estimation so huge sketches do not inflate thresholds.
   */
  scaleExcludeSizeMultiple: number;
  /** Minimum expansion applied to near-zero stroke AABB sides (world units). */
  minStrokeBoundExpand: number;
}

export const DEFAULT_HANDWRITING_REGION_CONFIG: HandwritingRegionDetectionConfig =
  {
    lineVerticalTolerance: 0.65,
    maxHorizontalGapForLine: 2.5,
    maxVerticalGapForRegion: 1.5,
    minHorizontalOverlapRatio: 0.15,
    alignmentTolerance: 1.2,
    smallMarkThreshold: 0.35,
    regionPadding: 0.35,
    linePadding: 0.15,
    elongatedAspectRatio: 6,
    elongatedSizeMultiple: 5,
    scaleExcludeSizeMultiple: 8,
    minStrokeBoundExpand: 1,
  };

export type HandwritingRegionConfigPatch =
  Partial<HandwritingRegionDetectionConfig>;

export function mergeHandwritingConfig(
  patch?: HandwritingRegionConfigPatch | null,
): HandwritingRegionDetectionConfig {
  return { ...DEFAULT_HANDWRITING_REGION_CONFIG, ...(patch ?? {}) };
}
