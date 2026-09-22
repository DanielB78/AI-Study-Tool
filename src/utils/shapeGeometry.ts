import type { ShapeType } from '../types/canvas';

/** Regular polygon points centered in a width×height box (local coords). */
export function regularPolygonPoints(
  sides: number,
  width: number,
  height: number,
): number[] {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const pts: number[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const a = start + (i * 2 * Math.PI) / sides;
    pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return pts;
}

export function diamondPoints(width: number, height: number): number[] {
  return [width / 2, 0, width, height / 2, width / 2, height, 0, height / 2];
}

export function trianglePoints(width: number, height: number): number[] {
  return [width / 2, 0, width, height, 0, height];
}

export function parallelogramPoints(width: number, height: number): number[] {
  const skew = width * 0.22;
  return [skew, 0, width, 0, width - skew, height, 0, height];
}

export function starPointsLocal(
  width: number,
  height: number,
  points = 5,
  innerRatio = 0.45,
): number[] {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const pts: number[] = [];
  const start = -Math.PI / 2;
  for (let i = 0; i < points * 2; i++) {
    const a = start + (i * Math.PI) / points;
    const r = i % 2 === 0 ? 1 : innerRatio;
    pts.push(cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a));
  }
  return pts;
}

/** Speech-bubble-like callout: rounded body + triangular tail. */
export function calloutPoints(width: number, height: number): number[] {
  const bodyH = height * 0.72;
  const r = Math.min(width, bodyH) * 0.12;
  const tailX = width * 0.28;
  const tailW = width * 0.16;
  // Approximate with polygon (body rectangle + tail)
  return [
    r,
    0,
    width - r,
    0,
    width,
    r,
    width,
    bodyH - r,
    width - r,
    bodyH,
    tailX + tailW,
    bodyH,
    tailX + tailW * 0.35,
    height,
    tailX,
    bodyH,
    r,
    bodyH,
    0,
    bodyH - r,
    0,
    r,
  ];
}

export function shapePointsFor(
  shapeType: ShapeType,
  width: number,
  height: number,
  opts?: { starPoints?: number; starInnerRatio?: number },
): number[] | null {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  switch (shapeType) {
    case 'triangle':
      return trianglePoints(w, h);
    case 'diamond':
      return diamondPoints(w, h);
    case 'pentagon':
      return regularPolygonPoints(5, w, h);
    case 'hexagon':
      return regularPolygonPoints(6, w, h);
    case 'star':
      return starPointsLocal(w, h, opts?.starPoints ?? 5, opts?.starInnerRatio ?? 0.45);
    case 'parallelogram':
      return parallelogramPoints(w, h);
    case 'callout':
      return calloutPoints(w, h);
    default:
      return null;
  }
}
