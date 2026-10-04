import { describe, expect, it } from 'vitest';
import {
  normalizeExpressionSource,
  parseGraphExpression,
  validateGraphExpression,
} from '../expressionService';
import {
  fitViewportToSamples,
  sampleAllExpressions,
  sampleExpression,
} from '../sampling';
import {
  createEmptyGraphExpression,
  createGraphElement,
  createGraphPoint,
} from '../createGraphElement';
import {
  DEFAULT_GRAPH_VIEWPORT,
  isValidViewport,
} from '../types';
import { migrateDocument, migrateElement } from '../../../persistence/migrate';
import { DOCUMENT_VERSION } from '../../../types/canvas';

describe('GraphExpressionService', () => {
  it('parses parabola x^2', () => {
    const result = parseGraphExpression('x^2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluate(2)).toBeCloseTo(4);
    expect(result.evaluate(-3)).toBeCloseTo(9);
  });

  it('accepts y = prefix and implicit multiplication', () => {
    expect(normalizeExpressionSource('y = 2x + 1')).toBe('2*x + 1');
    expect(normalizeExpressionSource('3sin(x)')).toBe('3*sin(x)');
    const result = parseGraphExpression('y = 2x + 1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluate(4)).toBeCloseTo(9);
  });

  it('supports sin/cos/sqrt/log/pi/e', () => {
    const sin = parseGraphExpression('sin(x)');
    expect(sin.ok).toBe(true);
    if (sin.ok) expect(sin.evaluate(0)).toBeCloseTo(0);

    const pi = parseGraphExpression('2*pi*x');
    expect(pi.ok).toBe(true);
    if (pi.ok) expect(pi.evaluate(1)).toBeCloseTo(2 * Math.PI);

    const ln = parseGraphExpression('ln(x)');
    expect(ln.ok).toBe(true);
    if (ln.ok) expect(ln.evaluate(Math.E)).toBeCloseTo(1);
  });

  it('rejects unknown variables but keeps source for invalid input', () => {
    const bad = validateGraphExpression('sin(');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();

    const unknown = validateGraphExpression('y + z');
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/unknown variable/i);
  });

  it('does not throw on domain errors during evaluation', () => {
    const sqrt = parseGraphExpression('sqrt(x)');
    expect(sqrt.ok).toBe(true);
    if (!sqrt.ok) return;
    expect(Number.isNaN(sqrt.evaluate(-1))).toBe(true);
    expect(sqrt.evaluate(4)).toBeCloseTo(2);

    const inv = parseGraphExpression('1/x');
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(Number.isFinite(inv.evaluate(0))).toBe(false);
  });
});

describe('function sampling', () => {
  const viewport = { ...DEFAULT_GRAPH_VIEWPORT };

  it('samples x^2 into finite points', () => {
    const expr = createEmptyGraphExpression(0, 'x^2');
    const sampled = sampleExpression(expr, viewport, { pixelWidth: 400 });
    expect(sampled.parseError).toBeNull();
    expect(sampled.segments.length).toBeGreaterThan(0);
    const pts = sampled.segments.flat();
    expect(pts.length).toBeGreaterThan(50);
    expect(pts.every((p) => p.y == null || Number.isFinite(p.y))).toBe(true);
  });

  it('breaks 1/x across the discontinuity at 0', () => {
    const expr = createEmptyGraphExpression(0, '1/x');
    const sampled = sampleExpression(expr, viewport, { pixelWidth: 500 });
    expect(sampled.segments.length).toBeGreaterThanOrEqual(2);
    // No segment should span across both sides with a connecting line through 0.
    for (const seg of sampled.segments) {
      const xs = seg.map((p) => p.x);
      const hasNeg = xs.some((x) => x < 0);
      const hasPos = xs.some((x) => x > 0);
      expect(hasNeg && hasPos).toBe(false);
    }
  });

  it('only samples sqrt(x) for non-negative x', () => {
    const expr = createEmptyGraphExpression(0, 'sqrt(x)');
    const sampled = sampleExpression(expr, viewport, { pixelWidth: 400 });
    const xs = sampled.segments.flat().map((p) => p.x);
    expect(xs.every((x) => x >= -1e-9)).toBe(true);
  });

  it('respects per-expression domain limits', () => {
    const expr = {
      ...createEmptyGraphExpression(0, 'x'),
      domainMin: 0,
      domainMax: 5,
    };
    const sampled = sampleExpression(expr, viewport, { pixelWidth: 300 });
    const xs = sampled.segments.flat().map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(5 + 1e-9);
  });

  it('skips invisible expressions and continues plotting others', () => {
    const a = createEmptyGraphExpression(0, 'x^2');
    const b = { ...createEmptyGraphExpression(1, 'sin(x)'), visible: false };
    const c = createEmptyGraphExpression(2, 'sin('); // invalid
    const all = sampleAllExpressions([a, b, c], viewport, { pixelWidth: 200 });
    expect(all[0]!.segments.length).toBeGreaterThan(0);
    expect(all[1]!.segments).toEqual([]);
    expect(all[2]!.parseError).toBeTruthy();
    expect(all[2]!.segments).toEqual([]);
  });

  it('fitViewportToSamples expands around finite values', () => {
    const expr = createEmptyGraphExpression(0, 'x');
    const samples = sampleAllExpressions([expr], { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, {
      pixelWidth: 100,
    });
    const fitted = fitViewportToSamples(samples);
    expect(fitted).not.toBeNull();
    expect(fitted!.xMin).toBeLessThan(fitted!.xMax);
    expect(fitted!.yMin).toBeLessThan(fitted!.yMax);
  });
});

describe('GraphElement model + migration', () => {
  it('creates a graph with default viewport and empty expressions', () => {
    const g = createGraphElement({ x: 10, y: 20, zIndex: 1 });
    expect(g.type).toBe('graph');
    expect(g.width).toBe(600);
    expect(g.height).toBe(400);
    expect(g.viewport).toEqual(DEFAULT_GRAPH_VIEWPORT);
    expect(g.expressions).toEqual([]);
    expect(g.settings.showGrid).toBe(true);
  });

  it('validates viewport ranges', () => {
    expect(isValidViewport({ xMin: -1, xMax: 1, yMin: -1, yMax: 1 })).toBe(true);
    expect(isValidViewport({ xMin: 1, xMax: 1, yMin: -1, yMax: 1 })).toBe(false);
  });

  it('migrates graph elements through save/load (test 77)', () => {
    const point = createGraphPoint(2, 4, 'A');
    const expr = createEmptyGraphExpression(0, 'x^2');
    const raw = {
      version: DOCUMENT_VERSION,
      id: 'board-graph',
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [
        {
          id: 'graph_1',
          type: 'graph',
          x: 100,
          y: 80,
          width: 600,
          height: 400,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
          expressions: [{ ...expr, visible: true }],
          points: [point],
          viewport: { xMin: 0, xMax: 100, yMin: -5, yMax: 5 },
          settings: {
            showGrid: false,
            showXAxis: true,
            showYAxis: true,
            xAxisLabel: 'Time (s)',
            yAxisLabel: 'Displacement (m)',
            title: 'Simple Harmonic Motion',
          },
        },
      ],
    };

    const doc = migrateDocument(raw);
    expect(doc).not.toBeNull();
    const g = doc!.elements[0];
    expect(g?.type).toBe('graph');
    if (g?.type !== 'graph') return;
    expect(g.viewport).toEqual({ xMin: 0, xMax: 100, yMin: -5, yMax: 5 });
    expect(g.settings.showGrid).toBe(false);
    expect(g.settings.title).toBe('Simple Harmonic Motion');
    expect(g.expressions[0]?.sourceText).toBe('x^2');
    expect(g.points[0]?.label).toBe('A');
  });

  it('migrateElement drops unknown types but keeps graph', () => {
    expect(migrateElement({ type: 'nope' }, 0)).toBeNull();
    const g = migrateElement(
      {
        type: 'graph',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        expressions: [],
        points: [],
        viewport: {},
        settings: {},
      },
      0,
    );
    expect(g?.type).toBe('graph');
  });
});

describe('canvas geometry vs viewport independence', () => {
  it('moving/resizing geometry fields does not require viewport change', () => {
    const g = createGraphElement({ x: 0, y: 0, zIndex: 1 });
    const moved = { ...g, x: 250, y: 120, width: 900, height: 600 };
    expect(moved.viewport).toEqual(g.viewport);
    expect(moved.expressions).toEqual(g.expressions);
  });
});
