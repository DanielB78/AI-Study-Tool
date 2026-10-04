/**
 * GraphExpressionService — parse/evaluate y=f(x) using mathjs.
 * Source text is canonical; compiled evaluators are transient cache.
 */

import { create, all, type MathNode } from 'mathjs';

const math = create(all, {
  // Keep ordinary JS numbers for sampling performance.
});

export type GraphParseResult =
  | {
      ok: true;
      normalizedSource: string;
      node: MathNode;
      evaluate: (x: number) => number;
    }
  | {
      ok: false;
      normalizedSource: string;
      error: string;
    };

const ALLOWED_SYMBOLS = new Set(['x', 'pi', 'e', 'PI', 'E']);

/** Built-in function names that may appear as SymbolNodes in mathjs ASTs. */
const KNOWN_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'sqrt',
  'cbrt',
  'abs',
  'exp',
  'log',
  'log10',
  'log2',
  'ln',
  'floor',
  'ceil',
  'round',
  'sign',
  'min',
  'max',
  'mod',
  'pow',
]);

/**
 * Small normalization layer (not a full custom parser):
 * - strip optional "y =" / "f(x) ="
 * - insert * for common implicit multiplication: 2x, 2(x+1), 3sin(x), )(
 */
export function normalizeExpressionSource(raw: string): string {
  let s = raw.trim();
  if (!s) return '';

  // Drop leading y= / f(x)= / Y =
  s = s.replace(/^(?:y|Y|f\s*\(\s*x\s*\))\s*=\s*/u, '');

  // Replace Unicode operators with ASCII equivalents mathjs understands.
  s = s
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/π/g, 'pi');

  // Implicit multiplication patterns (kept intentionally small).
  // digit followed by letter or '(' : 2x, 2(x+1), 3sin
  s = s.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
  // closing paren/bracket followed by digit/letter/'(' : )(  )x  )2
  s = s.replace(/([)\]}])\s*([a-zA-Z(\d])/g, '$1*$2');
  // single-letter variable followed by '(' : x( → x*(
  // multi-letter tokens like sin( are not matched by this single-letter pattern.
  s = s.replace(/\b([a-zA-Z])\s*\(/g, (match, letter: string) => {
    if (KNOWN_FUNCTIONS.has(letter)) return match;
    return `${letter}*(`;
  });

  // Map ln → log (natural) for friendlier calculator notation.
  s = s.replace(/\bln\s*\(/g, 'log(');

  return s.trim();
}

function collectSymbols(node: MathNode): string[] {
  const found = new Set<string>();
  node.traverse((child) => {
    if (child.type === 'SymbolNode' && 'name' in child) {
      found.add(String((child as unknown as { name: string }).name));
    }
  });
  return [...found];
}

/**
 * Parse and compile an expression for evaluation as f(x).
 * Does not throw — invalid input returns ok:false.
 */
export function parseGraphExpression(sourceText: string): GraphParseResult {
  const normalizedSource = normalizeExpressionSource(sourceText);
  if (!normalizedSource) {
    return { ok: false, normalizedSource: '', error: 'Empty expression' };
  }

  try {
    const node = math.parse(normalizedSource);
    const symbols = collectSymbols(node);
    const free = symbols.filter(
      (name) =>
        !ALLOWED_SYMBOLS.has(name) &&
        !KNOWN_FUNCTIONS.has(name),
    );
    if (free.length > 0) {
      return {
        ok: false,
        normalizedSource,
        error: `Unknown variable(s): ${free.join(', ')}. Use x only.`,
      };
    }

    const compiled = node.compile();
    const evaluate = (x: number): number => {
      try {
        const scope = { x, pi: Math.PI, e: Math.E, PI: Math.PI, E: Math.E };
        const result = compiled.evaluate(scope);
        if (typeof result === 'number') return result;
        // mathjs may return Complex / BigNumber / Unit — treat as invalid sample.
        if (
          result &&
          typeof result === 'object' &&
          're' in result &&
          typeof (result as { re: unknown }).re === 'number'
        ) {
          const c = result as { re: number; im: number };
          if (Math.abs(c.im) < 1e-12) return c.re;
          return Number.NaN;
        }
        return Number.NaN;
      } catch {
        return Number.NaN;
      }
    };

    // Smoke-test at a safe point (avoid 0 for log/sqrt domain).
    evaluate(1);

    return { ok: true, normalizedSource, node, evaluate };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid expression';
    return { ok: false, normalizedSource, error: message };
  }
}

/** Validate without keeping the compiled node (for UI). */
export function validateGraphExpression(sourceText: string): {
  ok: boolean;
  error: string | null;
  normalizedSource: string;
} {
  const result = parseGraphExpression(sourceText);
  if (result.ok) {
    return { ok: true, error: null, normalizedSource: result.normalizedSource };
  }
  return {
    ok: false,
    error: result.error,
    normalizedSource: result.normalizedSource,
  };
}

export const GraphExpressionService = {
  normalize: normalizeExpressionSource,
  parse: parseGraphExpression,
  validate: validateGraphExpression,
};
