import { describe, expect, it } from 'vitest';
import {
  encodeGraphExpression,
  toParserSyntax,
  migrateToCanonicalSource,
  isStrictCanonical,
  validateAiGraphExpressions,
  GraphExpressionCodec,
} from '../expressionCodec';
import {
  normalizeExpressionSource,
  parseGraphExpression,
  validateGraphExpression,
  validateStrictGraphExpression,
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
import { GRAPH_MATH_SYNTAX_SUMMARY } from '../mathSyntax';

describe('GraphExpressionCodec — basic canonical expressions', () => {
  const basics = [
    'x**2',
    '2*x + 1',
    'sin(x)',
    'cos(x)',
    'sqrt(x)',
    '1/x',
    'exp(-x**2)',
    '(x + 1)*(x - 1)',
  ];

  for (const expr of basics) {
    it(`accepts strict canonical: ${expr}`, () => {
      const result = encodeGraphExpression(expr, 'strict');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.canonical).toBe(expr);
      expect(result.parserSyntax.includes('**')).toBe(false);
    });
  }
});

describe('GraphExpressionCodec — power translation', () => {
  it('translates ** → ^ for the parser while persisting **', () => {
    const result = encodeGraphExpression('x**2 + 1', 'strict');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonical).toBe('x**2 + 1');
    expect(result.parserSyntax).toBe('x^2+1');
    expect(toParserSyntax('x**2')).toBe('x^2');
  });

  it('does not rewrite function names when translating powers', () => {
    // Ensure token-aware translation never touches identifiers.
    expect(toParserSyntax('exp(-x**2)')).toBe('exp(-x^2)');
    expect(toParserSyntax('sin(2*x)')).toBe('sin(2*x)');
  });

  it('evaluates translated powers correctly', () => {
    const parsed = parseGraphExpression('x**2', 'strict');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.normalizedSource).toBe('x**2');
    expect(parsed.parserSyntax).toBe('x^2');
    expect(parsed.evaluate(3)).toBeCloseTo(9);
  });
});

describe('GraphExpressionCodec — precedence', () => {
  it('2*x**2 multiplies after power', () => {
    const p = parseGraphExpression('2*x**2', 'strict');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evaluate(3)).toBeCloseTo(18);
  });

  it('(x + 1)**2 expands correctly', () => {
    const p = parseGraphExpression('(x + 1)**2', 'strict');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evaluate(3)).toBeCloseTo(16);
  });

  it('-x**2 ≡ -(x**2) (Python-like)', () => {
    const p = parseGraphExpression('-x**2', 'strict');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evaluate(3)).toBeCloseTo(-9);
  });

  it('(-x)**2 squares the negation', () => {
    const p = parseGraphExpression('(-x)**2', 'strict');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evaluate(3)).toBeCloseTo(9);
  });

  it('2**3**2 is right-associative → 512', () => {
    // Documented: ** is right-associative (Python / mathjs).
    const p = parseGraphExpression('2**3**2', 'strict');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.evaluate(0)).toBeCloseTo(512);
  });
});

describe('GraphExpressionCodec — invalid input', () => {
  it('rejects incomplete exponent', () => {
    const r = encodeGraphExpression('2**', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/incomplete exponent/i);
  });

  it('rejects missing closing parenthesis', () => {
    const r = encodeGraphExpression('sin(', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/parenthesis|end of expression/i);
  });

  it('rejects unsupported function', () => {
    const r = encodeGraphExpression('foo(x)', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unsupported function:\s*foo/i);
  });

  it('rejects unsupported variable', () => {
    const r = encodeGraphExpression('x + y', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/unsupported variable:\s*y/i);
  });

  it('rejects invalid *** operator sequence', () => {
    const r = encodeGraphExpression('x***2', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/invalid operator/i);
  });

  it('rejects caret in strict mode', () => {
    const r = encodeGraphExpression('x^2', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('caret_rejected');
  });

  it('rejects implicit multiplication in strict mode', () => {
    const r = encodeGraphExpression('2x', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('implicit_multiplication');
  });

  it('rejects y = in strict mode', () => {
    const r = encodeGraphExpression('y = x**2', 'strict');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('y_equals_rejected');
  });

  it('rejects LaTeX', () => {
    expect(encodeGraphExpression('\\frac{x^2}{2}', 'strict').ok).toBe(false);
    expect(encodeGraphExpression('\\sqrt{x}', 'strict').ok).toBe(false);
    expect(encodeGraphExpression('$x^2$', 'strict').ok).toBe(false);
  });

  it('rejects code-like identifiers without executing them', () => {
    expect(encodeGraphExpression('__import__("os")', 'strict').ok).toBe(false);
    expect(encodeGraphExpression('system("cmd")', 'strict').ok).toBe(false);
    expect(encodeGraphExpression('eval(x)', 'strict').ok).toBe(false);
  });
});

describe('GraphExpressionCodec — human compatibility + migration', () => {
  it('human mode normalizes ^ and implicit * to canonical', () => {
    const r = encodeGraphExpression('x^2', 'human');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.canonical).toBe('x**2');

    const r2 = encodeGraphExpression('2x + 1', 'human');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.canonical).toBe('2*x + 1');

    const r3 = encodeGraphExpression('y = 3sin(x)', 'human');
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.canonical).toBe('3*sin(x)');
  });

  it('migrateToCanonicalSource converts legacy parser-native forms', () => {
    const m = migrateToCanonicalSource('x^2');
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.canonical).toBe('x**2');
  });

  it('isStrictCanonical distinguishes contracts', () => {
    expect(isStrictCanonical('x**2')).toBe(true);
    expect(isStrictCanonical('x^2')).toBe(false);
    expect(isStrictCanonical('2x')).toBe(false);
  });

  it('validateAiGraphExpressions rejects the whole batch on any failure', () => {
    const ok = validateAiGraphExpressions(['x**2', 'sin(x)']);
    expect(ok.ok).toBe(true);

    const bad = validateAiGraphExpressions(['x**2', 'x^2']);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.index).toBe(1);
  });
});

describe('GraphExpressionService', () => {
  it('parses parabola from canonical x**2', () => {
    const result = parseGraphExpression('x**2', 'strict');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalizedSource).toBe('x**2');
    expect(result.evaluate(2)).toBeCloseTo(4);
    expect(result.evaluate(-3)).toBeCloseTo(9);
  });

  it('human mode accepts legacy ^ / implicit and normalizes', () => {
    expect(normalizeExpressionSource('y = 2x + 1', 'human')).toBe('2*x + 1');
    expect(normalizeExpressionSource('3sin(x)', 'human')).toBe('3*sin(x)');
    const result = parseGraphExpression('y = 2x + 1', 'human');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalizedSource).toBe('2*x + 1');
    expect(result.evaluate(4)).toBeCloseTo(9);
  });

  it('supports sin/cos/sqrt/ln/log10/pi/e', () => {
    const sin = parseGraphExpression('sin(x)', 'strict');
    expect(sin.ok).toBe(true);
    if (sin.ok) expect(sin.evaluate(0)).toBeCloseTo(0);

    const pi = parseGraphExpression('2*pi*x', 'strict');
    expect(pi.ok).toBe(true);
    if (pi.ok) expect(pi.evaluate(1)).toBeCloseTo(2 * Math.PI);

    const ln = parseGraphExpression('ln(x)', 'strict');
    expect(ln.ok).toBe(true);
    if (ln.ok) {
      expect(ln.parserSyntax.startsWith('log(')).toBe(true);
      expect(ln.evaluate(Math.E)).toBeCloseTo(1);
    }

    const log10 = parseGraphExpression('log10(x)', 'strict');
    expect(log10.ok).toBe(true);
    if (log10.ok) expect(log10.evaluate(100)).toBeCloseTo(2);
  });

  it('strict validate rejects caret / implicit', () => {
    expect(validateStrictGraphExpression('x^2').ok).toBe(false);
    expect(validateStrictGraphExpression('2x').ok).toBe(false);
    expect(validateStrictGraphExpression('x**2').ok).toBe(true);
  });

  it('rejects unknown variables with friendly errors', () => {
    const bad = validateGraphExpression('sin(', 'strict');
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();

    const unknown = validateGraphExpression('x + y', 'strict');
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/unsupported variable/i);
  });

  it('does not throw on domain errors during evaluation', () => {
    const sqrt = parseGraphExpression('sqrt(x)', 'strict');
    expect(sqrt.ok).toBe(true);
    if (!sqrt.ok) return;
    expect(Number.isNaN(sqrt.evaluate(-1))).toBe(true);
    expect(sqrt.evaluate(4)).toBeCloseTo(2);

    const inv = parseGraphExpression('1/x', 'strict');
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;
    expect(Number.isFinite(inv.evaluate(0))).toBe(false);
  });

  it('documents that syntax is a DSL, never executed as code', () => {
    expect(GRAPH_MATH_SYNTAX_SUMMARY).toMatch(/NOT LATEX/i);
    expect(GraphExpressionCodec.functions).toContain('sin');
    // Parsing code-like garbage must fail as math syntax — not run anything.
    expect(parseGraphExpression('__import__("os")', 'strict').ok).toBe(false);
  });
});

describe('function sampling', () => {
  const viewport = { ...DEFAULT_GRAPH_VIEWPORT };

  it('samples x**2 into finite points', () => {
    const expr = createEmptyGraphExpression(0, 'x**2');
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
    const a = createEmptyGraphExpression(0, 'x**2');
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

  it('migrates legacy x^2 graph sources to canonical x**2', () => {
    const point = createGraphPoint(2, 4, 'A');
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
          expressions: [
            {
              id: 'e1',
              sourceText: 'x^2',
              visible: true,
              domainMin: null,
              domainMax: null,
              style: { color: '#2563eb', strokeWidth: 2 },
            },
            {
              id: 'e2',
              sourceText: '2x + 1',
              visible: true,
              domainMin: null,
              domainMax: null,
              style: { color: '#dc2626', strokeWidth: 2 },
            },
          ],
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
    expect(g.expressions[0]?.sourceText).toBe('x**2');
    expect(g.expressions[1]?.sourceText).toBe('2*x + 1');
    expect(g.points[0]?.label).toBe('A');
  });

  it('does not corrupt unmigratable expression sources', () => {
    const g = migrateElement(
      {
        type: 'graph',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        expressions: [
          {
            id: 'bad',
            sourceText: 'not a valid ((( expression',
            visible: true,
            style: { color: '#000', strokeWidth: 2 },
          },
        ],
        points: [],
        viewport: {},
        settings: {},
      },
      0,
    );
    expect(g?.type).toBe('graph');
    if (g?.type !== 'graph') return;
    expect(g.expressions[0]?.sourceText).toBe('not a valid ((( expression');
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
