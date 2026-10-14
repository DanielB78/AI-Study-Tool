/**
 * KaTeX-backed LaTeX validation, measurement, and HTML rendering for EquationElements.
 * Stack note: this is React + Konva (not Flutter). flutter_math_fork does not apply;
 * katex provides native math rendering in the browser.
 */

import katex from 'katex';
import 'katex/dist/katex.min.css';

export const EQUATION_MIN_WIDTH = 48;
export const EQUATION_MIN_HEIGHT = 36;
export const EQUATION_MAX_INITIAL_WIDTH = 720;
/**
 * Fixed world-space display size for all EquationElements.
 * Bounding-box resize must not change this; camera zoom scales visually only.
 */
export const EQUATION_DEFAULT_FONT_SIZE = 20;
export const EQUATION_PADDING = 12;

export interface LatexValidationResult {
  ok: boolean;
  error: string | null;
}

export interface EquationRenderMetrics {
  width: number;
  height: number;
}

/** Environments where bare `&` is a valid alignment tab. */
const ALIGNMENT_ENV_RE =
  /\\begin\{(?:aligned|align\*?|gathered|gather\*?|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|smallmatrix)\}/;

/**
 * Find the matching `}` for an opening `{` at `openBraceIndex`, respecting
 * nested braces and skipping escaped characters.
 */
function findMatchingBrace(source: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 1; // skip escaped character
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Strip bare alignment tabs (`&`) inside `\boxed{…}` when the boxed body is
 * not itself an alignment environment. LLMs often emit
 * `\boxed{lhs&=rhs}` inside an outer `aligned`, which KaTeX rejects.
 * Nested `\boxed{\begin{aligned}…\end{aligned}}` is left unchanged.
 */
export function repairLatexForKatex(source: string): string {
  const boxedCmd = '\\boxed';
  let result = '';
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf(boxedCmd, i);
    if (start === -1) {
      result += source.slice(i);
      break;
    }
    result += source.slice(i, start);
    const afterCmd = start + boxedCmd.length;
    // Optional whitespace before `{`
    let braceAt = afterCmd;
    while (braceAt < source.length && /\s/.test(source[braceAt]!)) braceAt += 1;
    if (source[braceAt] !== '{') {
      result += source.slice(start, afterCmd);
      i = afterCmd;
      continue;
    }
    const closeAt = findMatchingBrace(source, braceAt);
    if (closeAt === -1) {
      result += source.slice(start);
      break;
    }
    const inner = source.slice(braceAt + 1, closeAt);
    let repairedInner: string;
    if (ALIGNMENT_ENV_RE.test(inner)) {
      // Keep alignment tabs; still repair nested \boxed bodies.
      repairedInner = repairLatexForKatex(inner);
    } else {
      // Drop alignment tabs; preserve literal ampersands (\&).
      repairedInner = inner
        .replace(/\\&/g, '\u0000')
        .replace(/&/g, '')
        .replace(/\u0000/g, '\\&');
    }
    result += `${boxedCmd}${source.slice(afterCmd, braceAt + 1)}${repairedInner}}`;
    i = closeAt + 1;
  }
  return result;
}

/** Strip accidental $ / $$ / code fences from LLM output; repair common KaTeX pitfalls. */
export function sanitizeLatexSource(raw: string): string {
  let text = raw.trim();
  const fence = /^```(?:latex|tex)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1]!.trim();
  if (/^\$\$[\s\S]*\$\$$/.test(text)) {
    text = text.slice(2, -2).trim();
  } else if (/^\$[^$]*\$$/.test(text)) {
    text = text.slice(1, -1).trim();
  }
  if (/^\\\[[\s\S]*\\\]$/.test(text)) {
    text = text.slice(2, -2).trim();
  } else if (/^\\\([\s\S]*\\\)$/.test(text)) {
    text = text.slice(2, -2).trim();
  }
  return repairLatexForKatex(text.trim());
}

export function validateLatex(
  latex: string,
  displayMode: boolean = true,
): LatexValidationResult {
  const source = sanitizeLatexSource(latex);
  if (!source) {
    return { ok: false, error: 'LaTeX cannot be empty.' };
  }
  try {
    katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    });
    return { ok: true, error: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid LaTeX',
    };
  }
}

/** Render KaTeX HTML for overlays / previews. */
export function renderLatexHtml(
  latex: string,
  options: { displayMode?: boolean } = {},
): { html: string; error: string | null } {
  const source = sanitizeLatexSource(latex);
  const displayMode = options.displayMode !== false;
  if (!source) {
    return { html: '', error: 'LaTeX cannot be empty.' };
  }
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'html',
    });
    return { html, error: null };
  } catch (err) {
    return {
      html: '',
      error: err instanceof Error ? err.message : 'Invalid LaTeX',
    };
  }
}

/**
 * Measure rendered equation size in world units using an offscreen container.
 * Falls back to a heuristic if DOM is unavailable (unit tests).
 */
export function measureEquationSize(
  latex: string,
  options: {
    fontSize?: number;
    displayMode?: boolean;
    maxWidth?: number;
  } = {},
): EquationRenderMetrics {
  const fontSize = options.fontSize ?? EQUATION_DEFAULT_FONT_SIZE;
  const displayMode = options.displayMode !== false;
  const maxWidth = options.maxWidth ?? EQUATION_MAX_INITIAL_WIDTH;
  const source = sanitizeLatexSource(latex);
  const pad = EQUATION_PADDING * 2;

  // Count aligned / gathered lines for heuristic height when DOM is unavailable.
  const lineHints =
    (source.match(/\\\\/g)?.length ?? 0) +
    (source.includes('\\begin{aligned}') || source.includes('\\begin{gather}')
      ? 1
      : 0);

  if (typeof document === 'undefined') {
    const approx = Math.max(source.length * fontSize * 0.45, EQUATION_MIN_WIDTH);
    const lines = Math.max(1, lineHints || 1);
    return {
      width: Math.min(Math.max(approx + pad, EQUATION_MIN_WIDTH), maxWidth),
      height: Math.max(
        fontSize * (displayMode ? 2.2 : 1.4) * lines + pad,
        EQUATION_MIN_HEIGHT,
      ),
    };
  }

  const { html, error } = renderLatexHtml(source, { displayMode });
  const host = document.createElement('div');
  // Allow multiline display equations (aligned/gather) to wrap vertically.
  // Inline mode keeps nowrap for single-line metrics.
  const whiteSpace = displayMode ? 'normal' : 'nowrap';
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    `font-size:${fontSize}px`,
    'line-height:1.35',
    'display:inline-block',
    `white-space:${whiteSpace}`,
    `max-width:${maxWidth}px`,
    'text-align:center',
  ].join(';');
  if (error || !html) {
    host.textContent = source || '(empty)';
  } else {
    host.innerHTML = html;
  }
  document.body.appendChild(host);
  const rect = host.getBoundingClientRect();
  document.body.removeChild(host);

  return {
    width: Math.min(
      Math.max(Math.ceil(rect.width) + pad, EQUATION_MIN_WIDTH),
      maxWidth,
    ),
    height: Math.max(Math.ceil(rect.height) + pad, EQUATION_MIN_HEIGHT),
  };
}
