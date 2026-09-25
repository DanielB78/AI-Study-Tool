/**
 * World-space axis-aligned bounding-box geometry for spatial RAG.
 * Distance is independent of canvas zoom (world units only).
 */

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shortest Euclidean distance between two AABBs.
 *
 * - Overlap or edge/corner touch → 0
 * - Separated → √(dx² + dy²) where dx/dy are gap sizes on each axis (0 if projecting)
 */
export function boundingBoxDistance(a: WorldRect, b: WorldRect): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;

  const dx = Math.max(0, b.x - ax2, a.x - bx2);
  const dy = Math.max(0, b.y - ay2, a.y - by2);

  if (dx === 0 && dy === 0) {
    return 0;
  }
  return Math.hypot(dx, dy);
}

/** Expand an AABB outward by `padding` world units on every side. */
export function expandRect(rect: WorldRect, padding: number): WorldRect {
  const p = Math.max(0, padding);
  return {
    x: rect.x - p,
    y: rect.y - p,
    width: rect.width + 2 * p,
    height: rect.height + 2 * p,
  };
}

export function rectCenter(rect: WorldRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}
