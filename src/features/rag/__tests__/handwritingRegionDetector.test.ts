import { describe, expect, it } from 'vitest';
import type { DrawingElement, TextElement } from '../../../types/canvas';
import {
  detectHandwritingRegions,
  extractDrawingStrokes,
  handwritingContentKey,
  strokeBoundsFromDrawing,
} from '../handwritingRegionDetector';
import { DEFAULT_HANDWRITING_REGION_CONFIG } from '../handwritingConfig';

function drawing(
  id: string,
  absPoints: number[],
  opts?: { strokeWidth?: number },
): DrawingElement {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < absPoints.length; i += 2) {
    minX = Math.min(minX, absPoints[i]!);
    minY = Math.min(minY, absPoints[i + 1]!);
    maxX = Math.max(maxX, absPoints[i]!);
    maxY = Math.max(maxY, absPoints[i + 1]!);
  }
  const pad = opts?.strokeWidth ?? 2;
  const x = minX - pad;
  const y = minY - pad;
  const points: number[] = [];
  for (let i = 0; i < absPoints.length; i += 2) {
    points.push(absPoints[i]! - x, absPoints[i + 1]! - y);
  }
  return {
    id,
    type: 'drawing',
    x,
    y,
    width: Math.max(maxX - minX + pad * 2, 1),
    height: Math.max(maxY - minY + pad * 2, 1),
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    points,
    color: '#111',
    strokeWidth: opts?.strokeWidth ?? 2,
    strokeStyle: 'solid',
  };
}

/** Horizontal stroke approximating a glyph segment at (x,y) with size ~h. */
function glyphStroke(
  id: string,
  x: number,
  y: number,
  w = 14,
  h = 18,
): DrawingElement {
  return drawing(id, [x, y + h, x + w * 0.3, y, x + w * 0.7, y + h * 0.4, x + w, y + h]);
}

function horizontalDash(id: string, x: number, y: number, w = 16): DrawingElement {
  return drawing(id, [x, y, x + w, y]);
}

function textEl(id: string): TextElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    text: 'ignore me',
    fontSize: 16,
    fontFamily: 'sans',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left',
    lineHeight: 1.3,
    backgroundColor: null,
    padding: 8,
    cornerRadius: 0,
  };
}

describe('stroke bounds from DrawingElement path', () => {
  it('uses path points in world coordinates, not only container padding', () => {
    const el = drawing('s1', [100, 200, 140, 200, 140, 230]);
    const b = strokeBoundsFromDrawing(el, 1);
    expect(b.strokeId).toBe('s1');
    expect(b.rawMinX).toBeCloseTo(100, 0);
    expect(b.rawMinY).toBeCloseTo(200, 0);
    expect(b.rawMaxX).toBeCloseTo(140, 0);
    expect(b.rawMaxY).toBeCloseTo(230, 0);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
  });

  it('expands near-zero height dashes so overlap math works', () => {
    const dash = horizontalDash('eq1', 50, 100, 20);
    const b = strokeBoundsFromDrawing(dash, 1);
    expect(b.height).toBeGreaterThan(0);
    expect(b.width).toBeGreaterThan(0);
  });

  it('ignores non-drawing elements', () => {
    const strokes = extractDrawingStrokes([
      textEl('t1'),
      glyphStroke('d1', 0, 0),
    ]);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]?.strokeId).toBe('d1');
  });
});

describe('handwritingContentKey', () => {
  it('changes when drawings change but ignores textboxes', () => {
    const d1 = glyphStroke('d1', 0, 0);
    const a = handwritingContentKey([d1, textEl('t1')]);
    const b = handwritingContentKey([d1, textEl('t2')]);
    expect(a).toBe(b);
    const d2 = glyphStroke('d1', 10, 0);
    const c = handwritingContentKey([d2, textEl('t1')]);
    expect(c).not.toBe(a);
  });
});

describe('detectHandwritingRegions', () => {
  it('TEST 43 — single line → 1 line, 1 region', () => {
    // Several nearby glyph strokes on one baseline.
    const strokes = [
      glyphStroke('a', 0, 0),
      glyphStroke('b', 20, 1),
      glyphStroke('c', 40, 0),
      glyphStroke('d', 60, 2),
      glyphStroke('e', 80, 0),
    ];
    const result = detectHandwritingRegions(strokes);
    expect(result.lines.length).toBe(1);
    expect(result.regions.length).toBe(1);
    expect(result.regions[0]?.strokeCount).toBe(5);
    expect(result.regions[0]?.lineCount).toBe(1);
  });

  it('TEST 44 — two-line paragraph → 2 lines, 1 region', () => {
    const line1 = [
      glyphStroke('a1', 0, 0),
      glyphStroke('a2', 22, 1),
      glyphStroke('a3', 44, 0),
    ];
    // Next line ~1.1× typical height below (typical ~18).
    const line2 = [
      glyphStroke('b1', 0, 28),
      glyphStroke('b2', 22, 29),
      glyphStroke('b3', 44, 28),
    ];
    const result = detectHandwritingRegions([...line1, ...line2]);
    expect(result.lines.length).toBe(2);
    expect(result.regions.length).toBe(1);
    expect(result.regions[0]?.lineCount).toBe(2);
  });

  it('TEST 45 — two separate notes with large vertical gap → 2 regions', () => {
    const note1 = [
      glyphStroke('a1', 0, 0),
      glyphStroke('a2', 20, 0),
    ];
    const note2 = [
      glyphStroke('b1', 0, 120),
      glyphStroke('b2', 20, 120),
    ];
    const result = detectHandwritingRegions([...note1, ...note2]);
    expect(result.regions.length).toBe(2);
  });

  it('TEST 46 — three groups (paragraph / equation / paragraph)', () => {
    const p1 = [
      glyphStroke('p1a', 0, 0),
      glyphStroke('p1b', 20, 0),
      glyphStroke('p1c', 0, 26),
      glyphStroke('p1d', 20, 26),
    ];
    const eq = [
      glyphStroke('e1', 10, 90, 12, 16),
      horizontalDash('eq', 28, 98, 14),
      glyphStroke('e2', 48, 90, 12, 16),
    ];
    const p2 = [
      glyphStroke('p2a', 0, 160),
      glyphStroke('p2b', 20, 160),
      glyphStroke('p2c', 0, 186),
      glyphStroke('p2d', 20, 186),
    ];
    const result = detectHandwritingRegions([...p1, ...eq, ...p2]);
    expect(result.regions.length).toBe(3);
    const counts = result.regions.map((r) => r.lineCount).sort((a, b) => a - b);
    // Expect roughly 2, 1, 2 line counts (order may vary by geometry sort).
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(2);
    expect(counts[2]).toBe(2);
  });

  it('TEST 47 — side-by-side notes stay separate regions', () => {
    const left = [
      glyphStroke('l1', 0, 0),
      glyphStroke('l2', 18, 0),
      glyphStroke('l3', 0, 26),
      glyphStroke('l4', 18, 26),
    ];
    const right = [
      glyphStroke('r1', 200, 0),
      glyphStroke('r2', 218, 0),
      glyphStroke('r3', 200, 26),
      glyphStroke('r4', 218, 26),
    ];
    const result = detectHandwritingRegions([...left, ...right]);
    expect(result.regions.length).toBe(2);
  });

  it('TEST 48 — dot on i does not become its own region', () => {
    const stem = glyphStroke('i_stem', 0, 4, 6, 16);
    const dot = drawing('i_dot', [4, 0, 5, 0, 5, 1, 4, 1]);
    const neighbors = [
      glyphStroke('a', 20, 0),
      glyphStroke('b', 40, 0),
    ];
    const result = detectHandwritingRegions([stem, dot, ...neighbors]);
    expect(result.regions.length).toBe(1);
    expect(result.regions[0]?.strokeIds).toContain('i_dot');
  });

  it('TEST 49 — equals sign strokes stay on the same line', () => {
    const left = glyphStroke('E', 0, 0, 14, 18);
    const eqTop = horizontalDash('eq_top', 22, 6, 16);
    const eqBot = horizontalDash('eq_bot', 22, 12, 16);
    const right = glyphStroke('F', 46, 0, 14, 18);
    const result = detectHandwritingRegions([left, eqTop, eqBot, right]);
    expect(result.lines.length).toBe(1);
    expect(result.regions.length).toBe(1);
    expect(result.lines[0]?.strokeIds).toEqual(
      expect.arrayContaining(['E', 'eq_top', 'eq_bot', 'F']),
    );
  });

  it('TEST 50 — fraction-like stacked strokes stay one local region', () => {
    const num = glyphStroke('num', 10, 0, 20, 14);
    const bar = horizontalDash('bar', 8, 18, 28);
    const den = glyphStroke('den', 12, 24, 18, 14);
    const result = detectHandwritingRegions([num, bar, den]);
    expect(result.regions.length).toBe(1);
  });

  it('TEST 51/52 — world coordinates: zoom/pan are irrelevant (pure geometry)', () => {
    const strokes = [
      glyphStroke('a', 100, 200),
      glyphStroke('b', 120, 200),
    ];
    const r1 = detectHandwritingRegions(strokes);
    // Same world strokes → same bounds regardless of any camera (detector never sees camera).
    const r2 = detectHandwritingRegions(strokes);
    expect(r1.regions[0]?.rawBounds).toEqual(r2.regions[0]?.rawBounds);
    expect(r1.contentKey).toBe(r2.contentKey);
  });

  it('TEST 53 — long arrow between notes does not collapse regions', () => {
    const left = [
      glyphStroke('l1', 0, 40),
      glyphStroke('l2', 18, 40),
    ];
    const right = [
      glyphStroke('r1', 220, 40),
      glyphStroke('r2', 238, 40),
    ];
    // Very elongated horizontal arrow spanning the gap.
    const arrow = drawing('arrow', [40, 48, 200, 48]);
    const result = detectHandwritingRegions([...left, ...right, arrow]);
    expect(result.regions.length).toBeGreaterThanOrEqual(2);
    // The two notes should not share a single region solely via the arrow.
    const noteRegions = result.regions.filter((r) =>
      r.strokeIds.some((id) => id.startsWith('l') || id.startsWith('r')),
    );
    const hasLeft = noteRegions.some((r) => r.strokeIds.some((id) => id.startsWith('l')));
    const hasRight = noteRegions.some((r) => r.strokeIds.some((id) => id.startsWith('r')));
    expect(hasLeft && hasRight).toBe(true);
    const merged = result.regions.find(
      (r) =>
        r.strokeIds.some((id) => id.startsWith('l')) &&
        r.strokeIds.some((id) => id.startsWith('r')),
    );
    expect(merged).toBeUndefined();
  });

  it('TEST 54 — large sketch does not destroy typical handwriting scale', () => {
    const note = [
      glyphStroke('n1', 0, 0),
      glyphStroke('n2', 18, 0),
      glyphStroke('n3', 36, 0),
    ];
    // Huge circle-like sketch nearby.
    const sketch = drawing('sketch', [
      80, 0, 200, 0, 200, 120, 80, 120, 80, 0,
    ]);
    const result = detectHandwritingRegions([...note, sketch]);
    expect(result.scale.typicalStrokeHeight).toBeLessThan(40);
    expect(result.scale.typicalStrokeHeight).toBeGreaterThan(5);
  });

  it('TEST 55 — adding a nearby third line expands the region', () => {
    const two = [
      glyphStroke('a1', 0, 0),
      glyphStroke('a2', 20, 0),
      glyphStroke('b1', 0, 26),
      glyphStroke('b2', 20, 26),
    ];
    const before = detectHandwritingRegions(two);
    expect(before.regions).toHaveLength(1);
    expect(before.regions[0]?.lineCount).toBe(2);

    const three = [
      ...two,
      glyphStroke('c1', 0, 52),
      glyphStroke('c2', 20, 52),
    ];
    const after = detectHandwritingRegions(three);
    expect(after.regions).toHaveLength(1);
    expect(after.regions[0]?.lineCount).toBe(3);
  });

  it('TEST 56 — deleting strokes removes stale geometry', () => {
    const all = [
      glyphStroke('a1', 0, 0),
      glyphStroke('a2', 20, 0),
      glyphStroke('b1', 0, 100),
      glyphStroke('b2', 20, 100),
    ];
    const before = detectHandwritingRegions(all);
    expect(before.regions.length).toBe(2);

    const after = detectHandwritingRegions([all[0]!, all[1]!]);
    expect(after.regions.length).toBe(1);
    expect(after.strokes.map((s) => s.strokeId).sort()).toEqual(['a1', 'a2']);
  });

  it('does not mutate DrawingElements / create CanvasDocument rects', () => {
    const el = glyphStroke('x', 0, 0);
    const pointsBefore = [...el.points];
    detectHandwritingRegions([el]);
    expect(el.points).toEqual(pointsBefore);
    expect(el.type).toBe('drawing');
  });

  it('exposes padded bounds separately from rawBounds', () => {
    const result = detectHandwritingRegions([
      glyphStroke('a', 0, 0),
      glyphStroke('b', 20, 0),
    ]);
    const region = result.regions[0]!;
    expect(region.bounds.width).toBeGreaterThanOrEqual(region.rawBounds.width);
    expect(region.bounds.height).toBeGreaterThanOrEqual(region.rawBounds.height);
  });

  it('uses configurable thresholds from defaults', () => {
    expect(DEFAULT_HANDWRITING_REGION_CONFIG.maxVerticalGapForRegion).toBe(1.5);
    expect(DEFAULT_HANDWRITING_REGION_CONFIG.lineVerticalTolerance).toBe(0.65);
  });
});
