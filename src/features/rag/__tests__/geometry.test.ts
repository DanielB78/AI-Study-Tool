import { describe, expect, it } from 'vitest';
import { boundingBoxDistance, expandRect } from '../geometry';

describe('boundingBoxDistance', () => {
  it('returns 0 when boxes overlap', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 40, y: 10, width: 100, height: 50 };
    expect(boundingBoxDistance(a, b)).toBe(0);
  });

  it('returns 0 when boxes touch on an edge', () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 100, y: 0, width: 40, height: 50 };
    expect(boundingBoxDistance(a, b)).toBe(0);
  });

  it('returns 0 when boxes touch at a corner', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 10, y: 10, width: 5, height: 5 };
    expect(boundingBoxDistance(a, b)).toBe(0);
  });

  it('returns horizontal gap for box directly to the right', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 25, y: 2, width: 10, height: 6 };
    expect(boundingBoxDistance(a, b)).toBe(15);
  });

  it('returns vertical gap for box directly above', () => {
    const a = { x: 0, y: 20, width: 10, height: 10 };
    const b = { x: 1, y: 0, width: 8, height: 5 };
    // a.y=20, b bottom=5 → gap 15
    expect(boundingBoxDistance(a, b)).toBe(15);
  });

  it('returns Euclidean distance for diagonal separation', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: 30, width: 5, height: 5 };
    // dx=10, dy=20
    expect(boundingBoxDistance(a, b)).toBeCloseTo(Math.hypot(10, 20));
  });

  it('handles different widths/heights', () => {
    const a = { x: 0, y: 0, width: 200, height: 20 };
    const b = { x: 50, y: 100, width: 10, height: 10 };
    // horizontal overlap in x projection; dy = 100-20 = 80
    expect(boundingBoxDistance(a, b)).toBe(80);
  });
});

describe('expandRect', () => {
  it('expands equally on all sides', () => {
    expect(expandRect({ x: 10, y: 20, width: 30, height: 40 }, 5)).toEqual({
      x: 5,
      y: 15,
      width: 40,
      height: 50,
    });
  });
});
