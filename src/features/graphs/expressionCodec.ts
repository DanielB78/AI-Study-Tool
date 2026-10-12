/**
 * GraphExpressionCodec — owns canonical graph-math syntax.
 *
 * Code-style mathematical syntax is a DSL, not executable code.
 * Never eval / Function / execute these strings.
 */

import {
  GRAPH_MATH_CONSTANTS,
  GRAPH_MATH_FUNCTIONS,
  GRAPH_MATH_VARIABLE,
} from './mathSyntax';

export type GraphCodecMode = 'strict' | 'human';

export interface GraphCodecSuccess {
  ok: true;
  /** Canonical persisted / AI form, e.g. x**2 + 2*x */
  canonical: string;
  /** Transient mathjs-compatible form, e.g. x^2 + 2*x */
  parserSyntax: string;
}

export interface GraphCodecFailure {
  ok: false;
  canonical: string;
  error: string;
  code:
    | 'empty'
    | 'invalid_token'
    | 'incomplete_exponent'
    | 'missing_paren'
    | 'unsupported_function'
    | 'unsupported_variable'
    | 'invalid_operator'
    | 'latex_rejected'
    | 'y_equals_rejected'
    | 'implicit_multiplication'
    | 'caret_rejected'
    | 'syntax';
}

export type GraphCodecResult = GraphCodecSuccess | GraphCodecFailure;

type Tok =
  | { kind: 'num'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '**' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' };

const FUNC_SET = new Set<string>(GRAPH_MATH_FUNCTIONS);
const CONST_SET = new Set<string>(GRAPH_MATH_CONSTANTS);

function fail(
  code: GraphCodecFailure['code'],
  error: string,
  canonical = '',
): GraphCodecFailure {
  return { ok: false, canonical, error, code };
}

/** Detect obvious LaTeX / markdown math that must never be machine source. */
function looksLikeLatex(raw: string): string | null {
  if (/\\[a-zA-Z]+/.test(raw)) {
    return 'LaTeX commands are not allowed (e.g. \\frac, \\sqrt, \\sin).';
  }
  if (/\$\$|\$/.test(raw)) {
    return 'Markdown/LaTeX math delimiters ($) are not allowed.';
  }
  if (/[_^]\{/.test(raw) || /\^\{/.test(raw)) {
    return 'LaTeX brace syntax is not allowed. Use x**2 instead of x^{2}.';
  }
  return null;
}

/**
 * Tokenizer for GraphMathSyntax.
 * Deliberately rejects `^` at tokenize time in strict mode (caller decides).
 */
function tokenize(
  input: string,
  options: { allowCaret: boolean },
):
  | { ok: true; tokens: Tok[] }
  | { ok: false; error: string; code: GraphCodecFailure['code'] } {
  const tokens: Tok[] = [];
  let i = 0;
  const s = input;

  while (i < s.length) {
    const ch = s[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // Numbers: 3, 3.14, 1e-3, 1E+2
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let sawDot = false;
      while (j < s.length && /[0-9.]/.test(s[j]!)) {
        if (s[j] === '.') {
          if (sawDot) {
            return { ok: false, error: 'Invalid number format.', code: 'invalid_token' };
          }
          sawDot = true;
        }
        j += 1;
      }
      if (j < s.length && (s[j] === 'e' || s[j] === 'E')) {
        let k = j + 1;
        if (k < s.length && (s[k] === '+' || s[k] === '-')) k += 1;
        const startDigits = k;
        while (k < s.length && /[0-9]/.test(s[k]!)) k += 1;
        if (k === startDigits) {
          return {
            ok: false,
            error: 'Incomplete scientific notation.',
            code: 'invalid_token',
          };
        }
        j = k;
      }
      const num = s.slice(i, j);
      if (num === '.' || !/[0-9]/.test(num)) {
        return { ok: false, error: 'Invalid number format.', code: 'invalid_token' };
      }
      tokens.push({ kind: 'num', value: num });
      i = j;
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j]!)) j += 1;
      const id = s.slice(i, j);
      if (
        id.includes('__') ||
        id === 'eval' ||
        id === 'Function' ||
        id === 'import' ||
        id === 'system' ||
        id === 'exec'
      ) {
        return {
          ok: false,
          error: `Unsupported identifier: ${id}`,
          code: 'unsupported_variable',
        };
      }
      tokens.push({ kind: 'id', value: id });
      i = j;
      continue;
    }

    // Operators
    if (ch === '*' && s[i + 1] === '*') {
      if (s[i + 2] === '*') {
        return {
          ok: false,
          error: 'Invalid operator sequence: ***',
          code: 'invalid_operator',
        };
      }
      tokens.push({ kind: 'op', value: '**' });
      i += 2;
      continue;
    }

    if (ch === '^') {
      if (!options.allowCaret) {
        return {
          ok: false,
          error: 'Use ** for powers (not ^). Example: x**2',
          code: 'caret_rejected',
        };
      }
      // Human compatibility: treat ^ as **
      tokens.push({ kind: 'op', value: '**' });
      i += 1;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' });
      i += 1;
      continue;
    }

    return {
      ok: false,
      error: `Invalid character: ${JSON.stringify(ch)}`,
      code: 'invalid_token',
    };
  }

  return { ok: true, tokens };
}

function detectImplicitMultiplication(tokens: Tok[]): string | null {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    const leftAtom = a.kind === 'num' || a.kind === 'id' || a.kind === 'rparen';
    const rightAtom = b.kind === 'num' || b.kind === 'id' || b.kind === 'lparen';
    if (!leftAtom || !rightAtom) continue;

    // Allow call shape id( — whitelist checked later in structure validation
    // so unsupported functions get a clear "Unsupported function" error.
    if (a.kind === 'id' && b.kind === 'lparen') {
      continue;
    }

    const left =
      a.kind === 'num' || a.kind === 'id' ? a.value : ')';
    const right =
      b.kind === 'num' || b.kind === 'id' ? b.value : '(';
    return `Implicit multiplication is not allowed (near "${left}${right}"). Use explicit *. Example: 2*x`;
  }
  return null;
}

/**
 * Recursive-descent validator / structure check.
 * Ensures parentheses balance, operator placement, function arity, identifiers.
 *
 * Precedence (Python-like):
 *   ** (right-associative) > unary +/- > * / > + -
 * Unary vs power: -x**2 ≡ -(x**2)
 */
function validateTokenStructure(tokens: Tok[]): string | null {
  if (tokens.length === 0) return 'Empty expression';

  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function parseExpression(): string | null {
    return parseAdd();
  }

  function parseAdd(): string | null {
    let err = parseMul();
    if (err) return err;
    while (peek()?.kind === 'op') {
      const op = peek()!;
      if (op.kind !== 'op' || (op.value !== '+' && op.value !== '-')) break;
      next();
      err = parseMul();
      if (err) return err;
    }
    return null;
  }

  function parseMul(): string | null {
    let err = parseUnary();
    if (err) return err;
    while (peek()?.kind === 'op') {
      const op = peek()!;
      if (op.kind !== 'op' || (op.value !== '*' && op.value !== '/')) break;
      next();
      err = parseUnary();
      if (err) return err;
    }
    return null;
  }

  /**
   * Unary sits above power in the call stack so that **-has-higher-precedence**:
   *   -x**2  ≡  -(x**2)
   * Power is right-associative: 2**3**2 ≡ 2**(3**2)
   * RHS of ** is a unary (factor), matching Python.
   */
  function parseUnary(): string | null {
    if (
      peek()?.kind === 'op' &&
      ((peek() as { value: string }).value === '+' ||
        (peek() as { value: string }).value === '-')
    ) {
      next();
      return parseUnary();
    }
    return parsePow();
  }

  function parsePow(): string | null {
    let err = parsePrimary();
    if (err) return err;
    if (peek()?.kind === 'op' && (peek() as { value: string }).value === '**') {
      next();
      if (!peek()) return 'Incomplete exponent';
      err = parseUnary();
      if (err) return err;
    }
    return null;
  }

  function parsePrimary(): string | null {
    const t = peek();
    if (!t) return 'Unexpected end of expression';

    if (t.kind === 'num') {
      next();
      return null;
    }

    if (t.kind === 'id') {
      next();
      const name = t.value;
      if (peek()?.kind === 'lparen') {
        if (!FUNC_SET.has(name)) {
          return `Unsupported function: ${name}`;
        }
        next(); // (
        if (peek()?.kind === 'rparen') {
          return `Missing arguments for ${name}()`;
        }
        const err = parseExpression();
        if (err) return err;
        if (peek()?.kind === 'comma') {
          return `Function ${name} does not accept multiple arguments`;
        }
        if (peek()?.kind !== 'rparen') return 'Missing closing parenthesis';
        next();
        return null;
      }
      if (name === GRAPH_MATH_VARIABLE) return null;
      if (CONST_SET.has(name)) return null;
      return `Unsupported variable: ${name}. Use x only.`;
    }

    if (t.kind === 'lparen') {
      next();
      const err = parseExpression();
      if (err) return err;
      if (peek()?.kind !== 'rparen') return 'Missing closing parenthesis';
      next();
      return null;
    }

    return 'Unexpected token in expression';
  }

  const err = parseExpression();
  if (err) return err;
  if (i < tokens.length) return 'Unexpected trailing tokens';
  return null;
}

/**
 * Pretty-print tokens to canonical GraphMathSyntax.
 * Spaces around + - ; tight * / ** ; tight unary +/-.
 */
function tokensToCanonical(tokens: Tok[]): string {
  const parts: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    const prev = tokens[i - 1];

    if (t.kind === 'op') {
      const isUnary =
        (t.value === '+' || t.value === '-') &&
        (i === 0 ||
          prev?.kind === 'lparen' ||
          prev?.kind === 'op' ||
          prev?.kind === 'comma');

      if (isUnary || t.value === '**' || t.value === '*' || t.value === '/') {
        parts.push(t.value);
      } else {
        parts.push(` ${t.value} `);
      }
      continue;
    }

    if (t.kind === 'comma') {
      parts.push(', ');
      continue;
    }

    if (t.kind === 'lparen') {
      parts.push('(');
      continue;
    }
    if (t.kind === 'rparen') {
      parts.push(')');
      continue;
    }

    parts.push(t.value);
  }

  return parts.join('').replace(/ {2,}/g, ' ').trim();
}

/**
 * Translate canonical GraphMathSyntax → mathjs parser syntax.
 * Token-aware: only transforms power operator ** → ^, and ln( → log(.
 * Never uses naive global replace on the whole string for **.
 */
export function toParserSyntax(canonical: string): string {
  const tok = tokenize(canonical, { allowCaret: false });
  if (!tok.ok) {
    // Should not happen for validated canonical; fall back carefully.
    return canonical.replaceAll('**', '^').replace(/\bln\s*\(/g, 'log(');
  }

  const out: string[] = [];
  for (let i = 0; i < tok.tokens.length; i += 1) {
    const t = tok.tokens[i]!;
    if (t.kind === 'op' && t.value === '**') {
      out.push('^');
      continue;
    }
    if (t.kind === 'op') {
      out.push(t.value);
      continue;
    }
    if (t.kind === 'lparen') {
      out.push('(');
      continue;
    }
    if (t.kind === 'rparen') {
      out.push(')');
      continue;
    }
    if (t.kind === 'comma') {
      out.push(',');
      continue;
    }
    // Map canonical ln → mathjs log (natural logarithm)
    if (
      t.kind === 'id' &&
      t.value === 'ln' &&
      tok.tokens[i + 1]?.kind === 'lparen'
    ) {
      out.push('log');
      continue;
    }
    out.push(t.value);
  }
  return out.join('');
}

/**
 * Human-editor compatibility: insert explicit * for common implicit forms,
 * convert Unicode ops, strip y=. Result is then validated / re-canonicalized.
 */
function humanPreprocess(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(?:y|Y|f\s*\(\s*x\s*\))\s*=\s*/u, '');
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi');
  // digit · letter/(  → *
  s = s.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
  // ) · letter/( /digit → *
  s = s.replace(/\)\s*([a-zA-Z(\d])/g, ')*$1');
  // single-letter var · ( → * (not function names)
  s = s.replace(/\b([a-zA-Z])\s*\(/g, (m, letter: string) => {
    if (FUNC_SET.has(letter)) return m;
    return `${letter}*(`;
  });
  return s.trim();
}

function stripYEquals(raw: string): { text: string; hadYEquals: boolean } {
  const m = raw.trim().match(/^(?:y|Y|f\s*\(\s*x\s*\))\s*=\s*(.*)$/u);
  if (m) return { text: m[1]!.trim(), hadYEquals: true };
  return { text: raw.trim(), hadYEquals: false };
}

/**
 * Encode / validate a graph expression.
 *
 * - mode `strict` (AI / persistence contract): require explicit *, **, no ^, no y=
 * - mode `human` (editor): accept ^ and some implicit forms, normalize to canonical
 */
export function encodeGraphExpression(
  raw: string,
  mode: GraphCodecMode = 'strict',
): GraphCodecResult {
  const trimmed = raw.trim();
  if (!trimmed) return fail('empty', 'Empty expression');

  const latexErr = looksLikeLatex(trimmed);
  if (latexErr) return fail('latex_rejected', latexErr, trimmed);

  let source = trimmed;
  if (mode === 'strict') {
    const stripped = stripYEquals(source);
    if (stripped.hadYEquals) {
      return fail(
        'y_equals_rejected',
        'Do not include y =. Emit only the right-hand side, e.g. x**2',
        trimmed,
      );
    }
  } else {
    source = humanPreprocess(source);
  }

  const tok = tokenize(source, { allowCaret: mode === 'human' });
  if (!tok.ok) {
    return fail(tok.code, tok.error, trimmed);
  }

  const impl = detectImplicitMultiplication(tok.tokens);
  if (impl) return fail('implicit_multiplication', impl, trimmed);

  const structureErr = validateTokenStructure(tok.tokens);
  if (structureErr) {
    if (structureErr.includes('Unsupported function')) {
      return fail('unsupported_function', structureErr, trimmed);
    }
    if (structureErr.includes('Unsupported variable')) {
      return fail('unsupported_variable', structureErr, trimmed);
    }
    if (structureErr === 'Incomplete exponent') {
      return fail('incomplete_exponent', structureErr, trimmed);
    }
    if (structureErr.includes('parenthesis')) {
      return fail('missing_paren', structureErr, trimmed);
    }
    if (structureErr.includes('Invalid operator')) {
      return fail('invalid_operator', structureErr, trimmed);
    }
    return fail('syntax', structureErr, trimmed);
  }

  const canonical = tokensToCanonical(tok.tokens);
  if (mode === 'human') {
    const again = encodeGraphExpression(canonical, 'strict');
    if (!again.ok) return again;
    return again;
  }

  return {
    ok: true,
    canonical,
    parserSyntax: toParserSyntax(canonical),
  };
}

/**
 * Migrate legacy parser-native / loose sources → canonical `**` form.
 * Safe: on failure returns ok:false so callers can keep the original string.
 */
export function migrateToCanonicalSource(raw: string): GraphCodecResult {
  if (!raw.trim()) {
    return { ok: true, canonical: '', parserSyntax: '' };
  }
  return encodeGraphExpression(raw, 'human');
}

/** True when string is already valid strict canonical syntax. */
export function isStrictCanonical(raw: string): boolean {
  return encodeGraphExpression(raw, 'strict').ok;
}

/**
 * Validate every expression for an AI graph transaction.
 * Rejects the whole batch if any expression fails strict encoding.
 */
export function validateAiGraphExpressions(
  expressions: readonly string[],
): { ok: true; canonical: string[] } | { ok: false; error: string; index: number } {
  const canonical: string[] = [];
  for (let i = 0; i < expressions.length; i += 1) {
    const result = encodeGraphExpression(expressions[i] ?? '', 'strict');
    if (!result.ok) {
      return { ok: false, error: result.error, index: i };
    }
    canonical.push(result.canonical);
  }
  return { ok: true, canonical };
}

export const GraphExpressionCodec = {
  encode: encodeGraphExpression,
  toParserSyntax,
  migrateToCanonicalSource,
  isStrictCanonical,
  validateAiGraphExpressions,
  functions: GRAPH_MATH_FUNCTIONS,
  constants: GRAPH_MATH_CONSTANTS,
  variable: GRAPH_MATH_VARIABLE,
};
