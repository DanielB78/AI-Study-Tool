/**
 * GraphMathSyntax — restricted code-style mathematical DSL for GraphElement.
 *
 * IMPORTANT:
 *   Code-style mathematical syntax is a DSL, not executable code.
 *   Never pass these strings to eval / Function / interpreters / shells.
 *
 * MACHINE (canonical, persisted, AI):
 *   x**2 + 2*x + 1
 *
 * DISPLAY (optional UI preview later):
 *   x² + 2x + 1
 *
 * Pipeline:
 *   canonical source
 *     → GraphExpressionCodec (validate / normalize / translate)
 *     → mathjs-compatible parser syntax (^ for powers)
 *     → mathjs AST (transient)
 *     → numerical evaluation
 */

/** Whitelisted functions in the canonical language. */
export const GRAPH_MATH_FUNCTIONS = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'abs',
  'exp',
  'ln',
  'log10',
] as const;

export type GraphMathFunction = (typeof GRAPH_MATH_FUNCTIONS)[number];

/** Whitelisted constants (ASCII only). */
export const GRAPH_MATH_CONSTANTS = ['pi', 'e'] as const;

export type GraphMathConstant = (typeof GRAPH_MATH_CONSTANTS)[number];

/** Only allowed free variable for y = f(x) graphs. */
export const GRAPH_MATH_VARIABLE = 'x' as const;

/**
 * Precedence (highest → lowest), Python-like:
 *   **  (right-associative)
 *   unary +/-
 *   * /
 *   + -
 *
 * Documented unary rule: -x**2 ≡ -(x**2)
 */

export const GRAPH_MATH_SYNTAX_SUMMARY = [
  'GRAPH EXPRESSIONS ARE NOT LATEX.',
  'Use restricted code-style math: x**2, 2*x + 1, sin(x), sqrt(x**2 + 1).',
  'Use explicit * for multiplication. Use ** for powers.',
  'Do not include y =. Do not use ^, 2x, \\frac, \\sqrt, or Markdown.',
].join(' ');
