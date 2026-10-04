/**
 * HandwritingRegionDetector — geometric grouping of pen strokes into lines → regions.
 *
 * World coordinates only. No OCR, semantics, embeddings, or LLM calls.
 *
 * Pipeline:
 *   DrawingElement strokes → stroke AABBs → scale estimate
 *   → Stage A: strokes → HandwritingLine[]
 *   → Stage B: lines → HandwritingRegion[]
 */

import type { CanvasElement, DrawingElement } from '../../types/canvas';
import { boundsFromPoints } from '../../utils/coordinates';
import {
  DEFAULT_HANDWRITING_REGION_CONFIG,
  mergeHandwritingConfig,
  type HandwritingRegionDetectionConfig,
  type HandwritingRegionConfigPatch,
} from './handwritingConfig';
import { expandRect, type WorldRect } from './geometry';
import type {
  ClassifiedStroke,
  HandwritingDetectionResult,
  HandwritingLine,
  HandwritingRegion,
  HandwritingScaleStats,
  StrokeBounds,
  StrokeRole,
} from './handwritingTypes';

// ─── Union-Find ─────────────────────────────────────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array.from({ length: n }, () => 0);
  }

  find(i: number): number {
    let p = this.parent[i]!;
    if (p !== i) {
      p = this.find(p);
      this.parent[i] = p;
    }
    return p;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra]! < this.rank[rb]!) this.parent[ra] = rb;
    else if (this.rank[ra]! > this.rank[rb]!) this.parent[rb] = ra;
    else {
      this.parent[rb] = ra;
      this.rank[ra]! += 1;
    }
  }
}

// ─── Geometry helpers ───────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function horizontalGap(a: StrokeBounds | WorldRect, b: StrokeBounds | WorldRect): number {
  const aMin = 'minX' in a ? a.minX : a.x;
  const aMax = 'maxX' in a ? a.maxX : a.x + a.width;
  const bMin = 'minX' in b ? b.minX : b.x;
  const bMax = 'maxX' in b ? b.maxX : b.x + b.width;
  if (aMax < bMin) return bMin - aMax;
  if (bMax < aMin) return aMin - bMax;
  return 0;
}

function verticalOverlapAmount(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): number {
  const top = Math.max(aMin, bMin);
  const bottom = Math.min(aMax, bMax);
  return Math.max(0, bottom - top);
}

function rectFromMinMax(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): WorldRect {
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 0),
    height: Math.max(maxY - minY, 0),
  };
}

function unionBounds(rects: readonly WorldRect[]): WorldRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return rectFromMinMax(minX, minY, maxX, maxY);
}

function horizontalOverlapRatio(a: WorldRect, b: WorldRect): number {
  const overlap = verticalOverlapAmount(a.x, a.x + a.width, b.x, b.x + b.width);
  // reuse helper for 1D intervals — named vertical but axis-agnostic
  const narrower = Math.min(a.width, b.width);
  if (narrower <= 0) return overlap > 0 ? 1 : 0;
  return overlap / narrower;
}

function verticalGapBetweenLines(upper: WorldRect, lower: WorldRect): number {
  // Assume upper is above lower; if overlapping/interleaved return 0 or negative clamped.
  const gap = lower.y - (upper.y + upper.height);
  return gap;
}

// ─── Stroke extraction ──────────────────────────────────────────────────────

/**
 * Derive world-coordinate AABB from a DrawingElement's path points.
 * Each DrawingElement is one continuous pen stroke in the current architecture.
 */
export function strokeBoundsFromDrawing(
  el: DrawingElement,
  minExpand = DEFAULT_HANDWRITING_REGION_CONFIG.minStrokeBoundExpand,
): StrokeBounds {
  const absolute: number[] = [];
  let pathLength = 0;
  for (let i = 0; i < el.points.length; i += 2) {
    const wx = el.x + el.points[i]!;
    const wy = el.y + el.points[i + 1]!;
    absolute.push(wx, wy);
    if (i >= 2) {
      const px = el.x + el.points[i - 2]!;
      const py = el.y + el.points[i - 1]!;
      pathLength += Math.hypot(wx - px, wy - py);
    }
  }

  const raw = boundsFromPoints(absolute);
  // Expand thin strokes so zero-height dashes / zero-width stems still compare.
  const expand = Math.max(minExpand, el.strokeWidth * 0.5);
  const minX = raw.minX - expand;
  const minY = raw.minY - expand;
  const maxX = raw.maxX + expand;
  const maxY = raw.maxY + expand;
  const width = Math.max(maxX - minX, expand * 2);
  const height = Math.max(maxY - minY, expand * 2);

  return {
    strokeId: el.id,
    elementId: el.id,
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    rawMinX: raw.minX,
    rawMinY: raw.minY,
    rawMaxX: raw.maxX,
    rawMaxY: raw.maxY,
    strokeWidth: el.strokeWidth,
    pathLength,
  };
}

export function extractDrawingStrokes(
  elements: readonly CanvasElement[],
  minExpand?: number,
): StrokeBounds[] {
  const out: StrokeBounds[] = [];
  for (const el of elements) {
    if (el.type !== 'drawing') continue;
    if (el.points.length < 4) continue;
    out.push(strokeBoundsFromDrawing(el, minExpand));
  }
  return out;
}

/** Fingerprint of drawing content for invalidation (geometry + ids). */
export function handwritingContentKey(elements: readonly CanvasElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    if (el.type !== 'drawing') continue;
    parts.push(
      `${el.id}:${el.x.toFixed(2)},${el.y.toFixed(2)},${el.width.toFixed(2)},${el.height.toFixed(2)},${el.points.length},${el.updatedAt}`,
    );
  }
  return parts.join('|');
}

// ─── Scale estimation ───────────────────────────────────────────────────────

export function estimateHandwritingScale(
  strokes: readonly StrokeBounds[],
  config: HandwritingRegionDetectionConfig,
): HandwritingScaleStats {
  if (strokes.length === 0) {
    return {
      typicalStrokeHeight: 16,
      typicalStrokeWidth: 12,
      medianLineHeight: 16,
      strokeCountUsedForScale: 0,
      totalStrokeCount: 0,
    };
  }

  // First-pass median to identify outliers.
  const allHeights = strokes.map((s) => s.height).filter((h) => h > 0);
  const roughMedian = median(allHeights) || 16;
  const maxAllowed = roughMedian * config.scaleExcludeSizeMultiple;

  const filtered = strokes.filter((s) => {
    const longest = Math.max(s.width, s.height);
    return longest <= maxAllowed && s.height > 0;
  });

  const heights = (filtered.length > 0 ? filtered : strokes).map((s) => s.height);
  const widths = (filtered.length > 0 ? filtered : strokes).map((s) => s.width);

  // Trim extremes with percentile-ish approach: drop top/bottom 10% when enough samples.
  const trimmedHeights = trimExtremes(heights, 0.1);
  const trimmedWidths = trimExtremes(widths, 0.1);

  const typicalStrokeHeight = Math.max(median(trimmedHeights) || roughMedian, 4);
  const typicalStrokeWidth = Math.max(median(trimmedWidths) || typicalStrokeHeight * 0.75, 2);

  return {
    typicalStrokeHeight,
    typicalStrokeWidth,
    medianLineHeight: typicalStrokeHeight, // refined after lines
    strokeCountUsedForScale: filtered.length,
    totalStrokeCount: strokes.length,
  };
}

function trimExtremes(values: number[], trimFraction: number): number[] {
  if (values.length < 5) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * trimFraction);
  return sorted.slice(drop, sorted.length - drop || undefined);
}

// ─── Stroke classification ──────────────────────────────────────────────────

export function classifyStroke(
  stroke: StrokeBounds,
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): StrokeRole {
  const th = Math.max(typicalHeight, 1);
  const longest = Math.max(stroke.width, stroke.height);
  const shortest = Math.min(stroke.width, stroke.height);
  const aspect = shortest > 0 ? longest / shortest : longest / th;

  if (
    aspect >= config.elongatedAspectRatio &&
    longest >= config.elongatedSizeMultiple * th
  ) {
    return 'elongated';
  }

  if (
    stroke.height <= config.smallMarkThreshold * th &&
    stroke.width <= config.smallMarkThreshold * th * 2
  ) {
    return 'small_mark';
  }

  // Very short path / tiny bbox relative to scale.
  if (longest < config.smallMarkThreshold * th) {
    return 'small_mark';
  }

  return 'normal';
}

// ─── Stage A: strokes → lines ───────────────────────────────────────────────

function strokesVerticallyCompatible(
  a: StrokeBounds,
  b: StrokeBounds,
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): boolean {
  const tol = config.lineVerticalTolerance * typicalHeight;
  if (Math.abs(a.centerY - b.centerY) <= tol) return true;
  const overlap = verticalOverlapAmount(a.minY, a.maxY, b.minY, b.maxY);
  const minH = Math.min(a.height, b.height);
  if (minH > 0 && overlap / minH >= 0.35) return true;
  return false;
}

function strokesHorizontallyCompatible(
  a: StrokeBounds,
  b: StrokeBounds,
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): boolean {
  return horizontalGap(a, b) <= config.maxHorizontalGapForLine * typicalHeight;
}

function strokesSameLineCompatible(
  a: ClassifiedStroke,
  b: ClassifiedStroke,
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): boolean {
  // Elongated strokes never bridge two normals into one line.
  if (a.role === 'elongated' || b.role === 'elongated') return false;
  if (a.role === 'small_mark' || b.role === 'small_mark') return false;
  return (
    strokesVerticallyCompatible(a, b, typicalHeight, config) &&
    strokesHorizontallyCompatible(a, b, typicalHeight, config)
  );
}

function nearestLineIndex(
  stroke: StrokeBounds,
  lines: HandwritingLine[],
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const dy = Math.abs(stroke.centerY - line.centerY);
    const gapX = horizontalGap(stroke, line.bounds);
    // Prefer vertical proximity; allow modest horizontal reach for dots.
    if (dy > config.lineVerticalTolerance * typicalHeight * 1.5) continue;
    if (gapX > config.maxHorizontalGapForLine * typicalHeight * 1.5) continue;
    const score = dy + gapX * 0.25;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function buildLineFromStrokes(
  id: string,
  memberStrokes: ClassifiedStroke[],
  config: HandwritingRegionDetectionConfig,
  typicalHeight: number,
): HandwritingLine {
  const sorted = [...memberStrokes].sort(
    (a, b) => a.centerX - b.centerX || a.strokeId.localeCompare(b.strokeId),
  );
  const raw = unionBounds(
    memberStrokes.map((s) =>
      rectFromMinMax(s.rawMinX, s.rawMinY, s.rawMaxX, s.rawMaxY),
    ),
  );
  const pad = config.linePadding * typicalHeight;
  const bounds = expandRect(raw, pad);
  return {
    id,
    strokeIds: memberStrokes.map((s) => s.strokeId),
    strokeIdsLeftToRight: sorted.map((s) => s.strokeId),
    bounds,
    rawBounds: raw,
    centerY: raw.y + raw.height / 2,
    height: raw.height,
    minX: raw.x,
    maxX: raw.x + raw.width,
    centerX: raw.x + raw.width / 2,
  };
}

export function groupStrokesIntoLines(
  classified: readonly ClassifiedStroke[],
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): HandwritingLine[] {
  const normals = classified.filter((s) => s.role === 'normal');
  const smallMarks = classified.filter((s) => s.role === 'small_mark');
  const elongated = classified.filter((s) => s.role === 'elongated');

  const uf = new UnionFind(normals.length);
  for (let i = 0; i < normals.length; i++) {
    for (let j = i + 1; j < normals.length; j++) {
      if (
        strokesSameLineCompatible(normals[i]!, normals[j]!, typicalHeight, config)
      ) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map<number, ClassifiedStroke[]>();
  for (let i = 0; i < normals.length; i++) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(normals[i]!);
    groups.set(root, list);
  }

  let lines = Array.from(groups.values()).map((members, idx) =>
    buildLineFromStrokes(`L${idx + 1}`, members, config, typicalHeight),
  );

  // Sort lines top-to-bottom then left-to-right for stable IDs.
  lines.sort(
    (a, b) => a.rawBounds.y - b.rawBounds.y || a.rawBounds.x - b.rawBounds.x,
  );
  lines = lines.map((line, idx) => ({ ...line, id: `L${idx + 1}` }));

  // Attach small marks to nearest compatible line.
  const lineStrokeMap = new Map<string, ClassifiedStroke[]>();
  for (const line of lines) {
    const members = classified.filter((s) => line.strokeIds.includes(s.strokeId));
    lineStrokeMap.set(line.id, members);
  }

  for (const mark of smallMarks) {
    const idx = nearestLineIndex(mark, lines, typicalHeight, config);
    if (idx >= 0) {
      const line = lines[idx]!;
      const members = [...(lineStrokeMap.get(line.id) ?? []), mark];
      lineStrokeMap.set(line.id, members);
      lines[idx] = buildLineFromStrokes(line.id, members, config, typicalHeight);
    } else {
      // Orphan tiny mark → its own line (will usually merge into a region or stay tiny).
      const orphan = buildLineFromStrokes(
        `L${lines.length + 1}`,
        [mark],
        config,
        typicalHeight,
      );
      lines.push(orphan);
      lineStrokeMap.set(orphan.id, [mark]);
    }
  }

  // Elongated strokes: attach to nearest single line if close; else singleton line.
  // Never union two existing lines through an elongated stroke.
  for (const stroke of elongated) {
    const idx = nearestLineIndex(stroke, lines, typicalHeight, config);
    if (idx >= 0) {
      const line = lines[idx]!;
      const members = [...(lineStrokeMap.get(line.id) ?? []), stroke];
      lineStrokeMap.set(line.id, members);
      lines[idx] = buildLineFromStrokes(line.id, members, config, typicalHeight);
    } else {
      const solo = buildLineFromStrokes(
        `L${lines.length + 1}`,
        [stroke],
        config,
        typicalHeight,
      );
      lines.push(solo);
      lineStrokeMap.set(solo.id, [stroke]);
    }
  }

  // Re-number stably after attachments.
  lines.sort(
    (a, b) => a.rawBounds.y - b.rawBounds.y || a.rawBounds.x - b.rawBounds.x,
  );
  return lines.map((line, idx) => ({ ...line, id: `L${idx + 1}` }));
}

// ─── Stage B: lines → regions ───────────────────────────────────────────────

function linesHorizontallyCompatible(
  a: HandwritingLine,
  b: HandwritingLine,
  medianLineHeight: number,
  config: HandwritingRegionDetectionConfig,
): boolean {
  const overlap = horizontalOverlapRatio(a.rawBounds, b.rawBounds);
  if (overlap >= config.minHorizontalOverlapRatio) return true;

  const leftDelta = Math.abs(a.minX - b.minX);
  if (leftDelta <= config.alignmentTolerance * medianLineHeight) {
    // Aligned columns — still require some horizontal proximity (not distant twins).
    const gap = horizontalGap(a.rawBounds, b.rawBounds);
    if (gap <= medianLineHeight * 2) return true;
  }

  // One line mostly under the other (centers within horizontal extent).
  const aCx = a.centerX;
  const bCx = b.centerX;
  const underA = aCx >= b.minX - medianLineHeight && aCx <= b.maxX + medianLineHeight;
  const underB = bCx >= a.minX - medianLineHeight && bCx <= a.maxX + medianLineHeight;
  if ((underA || underB) && overlap > 0) return true;

  return false;
}

function linesSameRegionCompatible(
  a: HandwritingLine,
  b: HandwritingLine,
  medianLineHeight: number,
  config: HandwritingRegionDetectionConfig,
): boolean {
  // Side-by-side safety: no horizontal overlap and large center distance → separate.
  const overlap = horizontalOverlapRatio(a.rawBounds, b.rawBounds);
  const gapX = horizontalGap(a.rawBounds, b.rawBounds);
  if (overlap < 0.05 && gapX > medianLineHeight * 1.5) {
    return false;
  }

  // Order by Y.
  const upper = a.rawBounds.y <= b.rawBounds.y ? a : b;
  const lower = a.rawBounds.y <= b.rawBounds.y ? b : a;
  let vGap = verticalGapBetweenLines(upper.rawBounds, lower.rawBounds);
  if (vGap < 0) vGap = 0; // overlapping / nested vertically

  if (vGap > config.maxVerticalGapForRegion * medianLineHeight) {
    return false;
  }

  return linesHorizontallyCompatible(a, b, medianLineHeight, config);
}

function buildRegionFromLines(
  id: string,
  memberLines: HandwritingLine[],
  config: HandwritingRegionDetectionConfig,
  typicalHeight: number,
): HandwritingRegion {
  const sorted = [...memberLines].sort(
    (a, b) => a.rawBounds.y - b.rawBounds.y || a.rawBounds.x - b.rawBounds.x,
  );
  const raw = unionBounds(sorted.map((l) => l.rawBounds));
  const pad = config.regionPadding * typicalHeight;
  const bounds = expandRect(raw, pad);
  const strokeIds = sorted.flatMap((l) => l.strokeIds);
  return {
    id,
    strokeIds,
    lineIds: sorted.map((l) => l.id),
    bounds,
    rawBounds: raw,
    center: { x: raw.x + raw.width / 2, y: raw.y + raw.height / 2 },
    width: raw.width,
    height: raw.height,
    lineCount: sorted.length,
    strokeCount: strokeIds.length,
  };
}

export function groupLinesIntoRegions(
  lines: readonly HandwritingLine[],
  medianLineHeight: number,
  typicalHeight: number,
  config: HandwritingRegionDetectionConfig,
): HandwritingRegion[] {
  if (lines.length === 0) return [];

  const uf = new UnionFind(lines.length);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      if (
        linesSameRegionCompatible(
          lines[i]!,
          lines[j]!,
          medianLineHeight,
          config,
        )
      ) {
        uf.union(i, j);
      }
    }
  }

  const groups = new Map<number, HandwritingLine[]>();
  for (let i = 0; i < lines.length; i++) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(lines[i]!);
    groups.set(root, list);
  }

  const regions = Array.from(groups.values()).map((members, idx) =>
    buildRegionFromLines(`R${idx + 1}`, members, config, typicalHeight),
  );

  regions.sort(
    (a, b) => a.rawBounds.y - b.rawBounds.y || a.rawBounds.x - b.rawBounds.x,
  );
  return regions.map((r, idx) => ({ ...r, id: `R${idx + 1}` }));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function detectHandwritingRegions(
  elements: readonly CanvasElement[],
  configPatch?: HandwritingRegionConfigPatch | null,
): HandwritingDetectionResult {
  const config = mergeHandwritingConfig(configPatch);
  const contentKey = handwritingContentKey(elements);
  const rawStrokes = extractDrawingStrokes(elements, config.minStrokeBoundExpand);
  const scale = estimateHandwritingScale(rawStrokes, config);
  const typicalHeight = scale.typicalStrokeHeight;

  const classified: ClassifiedStroke[] = rawStrokes.map((s) => ({
    ...s,
    role: classifyStroke(s, typicalHeight, config),
  }));

  const lines = groupStrokesIntoLines(classified, typicalHeight, config);
  const medianLineHeight =
    lines.length > 0
      ? Math.max(median(lines.map((l) => l.height).filter((h) => h > 0)) || typicalHeight, 4)
      : typicalHeight;

  const regions = groupLinesIntoRegions(
    lines,
    medianLineHeight,
    typicalHeight,
    config,
  );

  return {
    strokes: classified,
    lines,
    regions,
    scale: {
      ...scale,
      medianLineHeight,
    },
    config,
    contentKey,
  };
}

/** Convenience: empty result for UI defaults. */
export function emptyHandwritingDetection(
  configPatch?: HandwritingRegionConfigPatch | null,
): HandwritingDetectionResult {
  const config = mergeHandwritingConfig(configPatch);
  return {
    strokes: [],
    lines: [],
    regions: [],
    scale: {
      typicalStrokeHeight: 16,
      typicalStrokeWidth: 12,
      medianLineHeight: 16,
      strokeCountUsedForScale: 0,
      totalStrokeCount: 0,
    },
    config,
    contentKey: '',
  };
}
