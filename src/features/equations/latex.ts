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
export const EQUATION_DEFAULT_FONT_SIZE = 28;
export const EQUATION_PADDING = 12;

export interface LatexValidationResult {
  ok: boolean;
  error: string | null;
}

export interface EquationRenderMetrics {
  width: number;
  height: number;
}

/** Strip accidental $ / $$ / code fences from LLM output. */
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
  return text.trim();
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

  if (typeof document === 'undefined') {
    const approx = Math.max(source.length * fontSize * 0.45, EQUATION_MIN_WIDTH);
    return {
      width: Math.min(Math.max(approx + pad, EQUATION_MIN_WIDTH), maxWidth),
      height: Math.max(fontSize * (displayMode ? 2.2 : 1.4) + pad, EQUATION_MIN_HEIGHT),
    };
  }

  const { html, error } = renderLatexHtml(source, { displayMode });
  const host = document.createElement('div');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    `font-size:${fontSize}px`,
    'line-height:1.2',
    'display:inline-block',
    'white-space:nowrap',
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
