/**
 * GraphExpressionService — parse/evaluate y=f(x) using mathjs.
 *
 * Pipeline:
 *   canonical source (GraphMathSyntax)
 *     → GraphExpressionCodec (validate / normalize / translate)
 *     → mathjs-compatible parser syntax
 *     → mathjs AST (transient)
 *     → numerical evaluation
 *
 * Code-style mathematical syntax is a DSL, not executable code.
 * Never pass expressions to eval / Function / interpreters / shells.
 */

import { create, all, type MathNode } from 'mathjs';
import {
  encodeGraphExpression,
  type GraphCodecMode,
} from './expressionCodec';

const math = create(all, {
  // Keep ordinary JS numbers for sampling performance.
});

export type GraphParseResult =
  | {
      ok: true;
      /** Canonical GraphMathSyntax (persisted form). */
      normalizedSource: string;
      /** Transient mathjs-compatible syntax (not persisted). */
      parserSyntax: string;
      node: MathNode;
      evaluate: (x: number) => number;
    }
  | {
      ok: false;
      normalizedSource: string;
      parserSyntax: string;
      error: string;
    };

/** Built-in symbols allowed in the mathjs AST after codec translation. */
const ALLOWED_SYMBOLS = new Set(['x', 'pi', 'e', 'PI', 'E']);

/** Function names that may appear as SymbolNodes in mathjs ASTs. */
const KNOWN_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'abs',
  'exp',
  'log',
  'log10',
  'ln',
]);

/**
 * Normalize raw input to canonical GraphMathSyntax when possible.
 * Human mode accepts light compatibility forms (^, 2x, y=) and rewrites them.
 * Strict mode enforces the AI / persistence contract.
 */
export function normalizeExpressionSource(
  raw: string,
  mode: GraphCodecMode = 'human',
): string {
  const encoded = encodeGraphExpression(raw, mode);
  if (encoded.ok) return encoded.canonical;
  return raw.trim();
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

function encodeForParse(
  sourceText: string,
  mode: GraphCodecMode,
):
  | { ok: true; canonical: string; parserSyntax: string }
  | { ok: false; error: string; normalizedSource: string } {
  // Prefer the requested mode; for human reads also try strict first so
  // already-canonical sources skip compatibility rewriting.
  if (mode === 'human') {
    const strict = encodeGraphExpression(sourceText, 'strict');
    if (strict.ok) {
      return {
        ok: true,
        canonical: strict.canonical,
        parserSyntax: strict.parserSyntax,
      };
    }
  }

  const encoded = encodeGraphExpression(sourceText, mode);
  if (!encoded.ok) {
    return {
      ok: false,
      error: encoded.error,
      normalizedSource: sourceText.trim(),
    };
  }
  return {
    ok: true,
    canonical: encoded.canonical,
    parserSyntax: encoded.parserSyntax,
  };
}

/**
 * Parse and compile an expression for evaluation as f(x).
 * Does not throw — invalid input returns ok:false.
 *
 * Default mode is `human` so the graph editor and migrated legacy sources work.
 * AI graph operations should call with mode `'strict'`.
 */
export function parseGraphExpression(
  sourceText: string,
  mode: GraphCodecMode = 'human',
): GraphParseResult {
  const encoded = encodeForParse(sourceText, mode);
  if (!encoded.ok) {
    return {
      ok: false,
      normalizedSource: encoded.normalizedSource,
      parserSyntax: '',
      error: encoded.error,
    };
  }

  const { canonical, parserSyntax } = encoded;

  try {
    // mathjs.parse is a mathematical parser — not code execution.
    const node = math.parse(parserSyntax);
    const symbols = collectSymbols(node);
    const free = symbols.filter(
      (name) => !ALLOWED_SYMBOLS.has(name) && !KNOWN_FUNCTIONS.has(name),
    );
    if (free.length > 0) {
      return {
        ok: false,
        normalizedSource: canonical,
        parserSyntax,
        error: `Unsupported variable: ${free.join(', ')}. Use x only.`,
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

    return {
      ok: true,
      normalizedSource: canonical,
      parserSyntax,
      node,
      evaluate,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid expression';
    // Never surface raw stack traces — keep a short message.
    return {
      ok: false,
      normalizedSource: canonical,
      parserSyntax,
      error: message.split('\n')[0] ?? 'Invalid expression',
    };
  }
}

/** Validate without keeping the compiled node (for UI / human editor). */
export function validateGraphExpression(
  sourceText: string,
  mode: GraphCodecMode = 'human',
): {
  ok: boolean;
  error: string | null;
  normalizedSource: string;
  parserSyntax: string;
} {
  const result = parseGraphExpression(sourceText, mode);
  if (result.ok) {
    return {
      ok: true,
      error: null,
      normalizedSource: result.normalizedSource,
      parserSyntax: result.parserSyntax,
    };
  }
  return {
    ok: false,
    error: result.error,
    normalizedSource: result.normalizedSource,
    parserSyntax: result.parserSyntax,
  };
}

/** Strict validation for AI-supplied graph expressions. */
export function validateStrictGraphExpression(sourceText: string): {
  ok: boolean;
  error: string | null;
  normalizedSource: string;
  parserSyntax: string;
} {
  return validateGraphExpression(sourceText, 'strict');
}

export const GraphExpressionService = {
  normalize: normalizeExpressionSource,
  parse: parseGraphExpression,
  validate: validateGraphExpression,
  validateStrict: validateStrictGraphExpression,
};
