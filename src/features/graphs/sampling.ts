/**
 * Sample y=f(x) across a viewport into Chart.js-friendly segments.
 * Breaks on NaN/Infinity and extreme jumps (discontinuities).
 */

import type { GraphExpression, GraphViewport } from './types';
import { parseGraphExpression } from './expressionService';

export interface SamplePoint {
  x: number;
  y: number | null;
}

/** One contiguous polyline (null y breaks Chart.js spanGaps:false). */
export type SampleSegment = SamplePoint[];

export interface SampledExpression {
  expressionId: string;
  color: string;
  strokeWidth: number;
  /** Multiple segments for discontinuities. */
  segments: SampleSegment[];
  parseError: string | null;
}

export interface SampleOptions {
  /** Plot pixel width (screen or CSS pixels). */
  pixelWidth: number;
  /** Soft upper bound on samples per expression. */
  maxSamples?: number;
  /** Jump threshold as fraction of viewport y-range. */
  jumpFraction?: number;
}

const DEFAULT_MAX_SAMPLES = 800;
const MIN_SAMPLES = 64;

function clampSamples(pixelWidth: number, maxSamples: number): number {
  const based = Math.ceil(Math.max(pixelWidth, 1) * 1.5);
  return Math.max(MIN_SAMPLES, Math.min(maxSamples, based));
}

function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Sample a single expression over the viewport (respecting optional domain).
 */
export function sampleExpression(
  expression: GraphExpression,
  viewport: GraphViewport,
  options: SampleOptions,
): SampledExpression {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES;
  const jumpFraction = options.jumpFraction ?? 0.45;
  const yRange = Math.max(viewport.yMax - viewport.yMin, 1e-9);
  const jumpThreshold = yRange * jumpFraction;

  if (!expression.visible) {
    return {
      expressionId: expression.id,
      color: expression.style.color,
      strokeWidth: expression.style.strokeWidth,
      segments: [],
      parseError: null,
    };
  }

  const parsed = parseGraphExpression(expression.sourceText);
  if (!parsed.ok) {
    return {
      expressionId: expression.id,
      color: expression.style.color,
      strokeWidth: expression.style.strokeWidth,
      segments: [],
      parseError: parsed.error,
    };
  }

  let xStart = viewport.xMin;
  let xEnd = viewport.xMax;
  if (expression.domainMin != null && Number.isFinite(expression.domainMin)) {
    xStart = Math.max(xStart, expression.domainMin);
  }
  if (expression.domainMax != null && Number.isFinite(expression.domainMax)) {
    xEnd = Math.min(xEnd, expression.domainMax);
  }
  if (!(xStart < xEnd)) {
    return {
      expressionId: expression.id,
      color: expression.style.color,
      strokeWidth: expression.style.strokeWidth,
      segments: [],
      parseError: null,
    };
  }

  const n = clampSamples(options.pixelWidth * ((xEnd - xStart) / (viewport.xMax - viewport.xMin || 1)), maxSamples);
  const dx = (xEnd - xStart) / Math.max(n - 1, 1);

  const segments: SampleSegment[] = [];
  let current: SampleSegment = [];
  let prevY: number | null = null;

  const flush = () => {
    if (current.length >= 2) segments.push(current);
    else if (current.length === 1) {
      // Single valid point — keep as a degenerate marker (Chart.js will show a point).
      segments.push(current);
    }
    current = [];
    prevY = null;
  };

  for (let i = 0; i < n; i += 1) {
    const x = xStart + dx * i;
    const y = parsed.evaluate(x);

    if (!isFiniteNumber(y)) {
      flush();
      continue;
    }

    // Extreme jump → discontinuity (e.g. 1/x near 0).
    if (prevY !== null && Math.abs(y - prevY) > jumpThreshold) {
      flush();
    }

    current.push({ x, y });
    prevY = y;
  }
  flush();

  return {
    expressionId: expression.id,
    color: expression.style.color,
    strokeWidth: expression.style.strokeWidth,
    segments,
    parseError: null,
  };
}

export function sampleAllExpressions(
  expressions: readonly GraphExpression[],
  viewport: GraphViewport,
  options: SampleOptions,
): SampledExpression[] {
  return expressions.map((expr) => sampleExpression(expr, viewport, options));
}

/** Fit viewport to finite sampled values (optional helper). */
export function fitViewportToSamples(
  samples: readonly SampledExpression[],
  paddingFraction = 0.08,
): GraphViewport | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of samples) {
    for (const seg of s.segments) {
      for (const p of seg) {
        if (p.y == null || !Number.isFinite(p.y)) continue;
        if (!Number.isFinite(p.x)) continue;
        xMin = Math.min(xMin, p.x);
        xMax = Math.max(xMax, p.x);
        yMin = Math.min(yMin, p.y);
        yMax = Math.max(yMax, p.y);
      }
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
    return null;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return null;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const xPad = (xMax - xMin) * paddingFraction;
  const yPad = (yMax - yMin) * paddingFraction;
  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
  };
}
