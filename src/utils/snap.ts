import type { CanvasElement } from '../types/canvas';

const THRESHOLD = 6;

export interface SnapGuide {
  orientation: 'h' | 'v';
  position: number;
}

export function snapPosition(
  moving: { x: number; y: number; width: number; height: number },
  others: CanvasElement[],
  threshold = THRESHOLD,
): { x: number; y: number; guides: SnapGuide[] } {
  let x = moving.x;
  let y = moving.y;
  const guides: SnapGuide[] = [];

  const movingEdges = {
    left: moving.x,
    right: moving.x + moving.width,
    cx: moving.x + moving.width / 2,
    top: moving.y,
    bottom: moving.y + moving.height,
    cy: moving.y + moving.height / 2,
  };

  let bestDx = threshold + 1;
  let bestDy = threshold + 1;
  let snapX: number | null = null;
  let snapY: number | null = null;
  let guideV: number | null = null;
  let guideH: number | null = null;

  for (const other of others) {
    const edges = {
      left: other.x,
      right: other.x + other.width,
      cx: other.x + other.width / 2,
      top: other.y,
      bottom: other.y + other.height,
      cy: other.y + other.height / 2,
    };

    const xPairs: [number, number, number][] = [
      [movingEdges.left, edges.left, edges.left],
      [movingEdges.left, edges.right, edges.right],
      [movingEdges.right, edges.left, edges.left - moving.width],
      [movingEdges.right, edges.right, edges.right - moving.width],
      [movingEdges.cx, edges.cx, edges.cx - moving.width / 2],
    ];
    for (const [a, b, nextX] of xPairs) {
      const d = Math.abs(a - b);
      if (d < bestDx) {
        bestDx = d;
        snapX = nextX;
        guideV = b;
      }
    }

    const yPairs: [number, number, number][] = [
      [movingEdges.top, edges.top, edges.top],
      [movingEdges.top, edges.bottom, edges.bottom],
      [movingEdges.bottom, edges.top, edges.top - moving.height],
      [movingEdges.bottom, edges.bottom, edges.bottom - moving.height],
      [movingEdges.cy, edges.cy, edges.cy - moving.height / 2],
    ];
    for (const [a, b, nextY] of yPairs) {
      const d = Math.abs(a - b);
      if (d < bestDy) {
        bestDy = d;
        snapY = nextY;
        guideH = b;
      }
    }
  }

  if (snapX !== null && bestDx <= threshold) {
    x = snapX;
    if (guideV !== null) guides.push({ orientation: 'v', position: guideV });
  }
  if (snapY !== null && bestDy <= threshold) {
    y = snapY;
    if (guideH !== null) guides.push({ orientation: 'h', position: guideH });
  }

  return { x, y, guides };
}
