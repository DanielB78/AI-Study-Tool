import type { Rect } from '../../canvas/placement';

/** Expand a rectangle by a uniform margin on all sides. */
export function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  };
}

/** Translate a rectangle by a world offset. */
export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height,
  };
}

/** Axis-aligned intersection with optional mutual margin expansion. */
export function intersectsWithMargin(a: Rect, b: Rect, margin = 0): boolean {
  const aa = margin > 0 ? expandRect(a, margin) : a;
  const bb = margin > 0 ? expandRect(b, margin) : b;
  return (
    aa.x < bb.x + bb.width &&
    aa.x + aa.width > bb.x &&
    aa.y < bb.y + bb.height &&
    aa.y + aa.height > bb.y
  );
}

export function anyPairCollides(rects: readonly Rect[], margin = 0): boolean {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (intersectsWithMargin(rects[i]!, rects[j]!, margin)) return true;
    }
  }
  return false;
}

export function collidesAny(
  candidate: Rect,
  obstacles: readonly Rect[],
  margin = 0,
): boolean {
  return obstacles.some((o) => intersectsWithMargin(candidate, o, margin));
}

/** Union bounds of rectangles (empty → zero rect). */
export function unionBounds(rects: readonly Rect[]): Rect {
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
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
