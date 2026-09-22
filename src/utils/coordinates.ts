import type { Camera, CanvasElement } from '../types/canvas';
import { MAX_ZOOM, MIN_ZOOM } from '../types/canvas';

export interface Point {
  x: number;
  y: number;
}

/** Convert a screen-space point (relative to stage) into world coordinates. */
export function screenToWorld(screen: Point, camera: Camera): Point {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom,
  };
}

/** Convert a world-space point into screen coordinates. */
export function worldToScreen(world: Point, camera: Camera): Point {
  return {
    x: world.x * camera.zoom + camera.x,
    y: world.y * camera.zoom + camera.y,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Zoom around a screen-space pointer so the world point under the cursor stays fixed.
 */
export function zoomAtPoint(
  camera: Camera,
  screenPoint: Point,
  nextZoom: number,
): Camera {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(screenPoint, camera);
  return {
    zoom,
    x: screenPoint.x - world.x * zoom,
    y: screenPoint.y - world.y * zoom,
  };
}

export function getElementBounds(el: CanvasElement): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function normalizeRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function boundsFromPoints(points: number[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i]!;
    const py = points[i + 1]!;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Rebase absolute stroke points so they are relative to a new origin. */
export function rebasePoints(
  absolutePoints: number[],
  originX: number,
  originY: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < absolutePoints.length; i += 2) {
    out.push(absolutePoints[i]! - originX, absolutePoints[i + 1]! - originY);
  }
  return out;
}
