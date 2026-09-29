/**
 * Helpers for diagnosing LaTeX-in-JSON escaping mistakes from LLM pastes.
 *
 * IMPORTANT: Do NOT globally rewrite `\` → `\\` in the pasted response.
 * Blind replacement can double-escape already-valid JSON, corrupt prose
 * `text` fields, and break legitimate escape sequences. Diagnosis only —
 * the LLM (or the user) must supply correctly escaped JSON.
 */

/** Valid single-char JSON escapes after a backslash. */
const JSON_SINGLE_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);

/**
 * LaTeX command names that begin with a letter that is ALSO a JSON single-char escape,
 * so an unescaped `\\cmd` in a JSON string silently corrupts the value.
 */
const SILENT_CORRUPTION_COMMANDS = [
  { cmd: 'frac', escape: 'f', char: '\f', hint: '\\frac' },
  { cmd: 'nabla', escape: 'n', char: '\n', hint: '\\nabla' },
  { cmd: 'times', escape: 't', char: '\t', hint: '\\times' },
  { cmd: 'rightarrow', escape: 'r', char: '\r', hint: '\\rightarrow' },
  { cmd: 'mathbf', escape: 'b', char: '\b', hint: '\\mathbf' }, // rare but possible
] as const;

/** Common LaTeX commands whose leading letter is NOT a valid JSON escape → parse throws. */
const HARD_FAIL_LATEX_PREFIXES =
  /\\(hbar|partial|mathbf|mathrm|varepsilon|oint|int|sum|prod|alpha|beta|gamma|delta|psi|Psi|hat|vec|dot|cdot|left|right|begin|end|pi|rho|sigma|infty|sqrt|overset|underset|tilde|bar|underline|overline)\b/;

export function rawLooksLikeEquationResponse(raw: string): boolean {
  return /"latex"\s*:/i.test(raw) || /"type"\s*:\s*"create_equation"/i.test(raw);
}

/**
 * Detect whether a JSON.parse failure is likely due to unescaped LaTeX backslashes.
 */
export function isLikelyLatexJsonEscapeIssue(
  raw: string,
  parseErrorMessage: string,
): boolean {
  if (!rawLooksLikeEquationResponse(raw)) return false;
  if (/bad (escape|escaped)|invalid (escape|\\u)|unexpected token|unexpected end/i.test(parseErrorMessage)) {
    return true;
  }
  // Raw paste still contains backslash + latex command (hard-fail or silent risk).
  if (HARD_FAIL_LATEX_PREFIXES.test(raw)) return true;
  if (/\\(frac|nabla|times|rightarrow|mathbf)\b/.test(raw)) return true;
  return false;
}

export const LATEX_JSON_ESCAPE_HINT =
  'Invalid JSON. A LaTeX command may contain an unescaped backslash. ' +
  'In JSON, use `\\\\frac`, `\\\\hbar`, `\\\\nabla`, etc.';

/**
 * Build user-facing + detail messages for a JSON.parse failure.
 */
export function explainJsonParseFailure(
  raw: string,
  parseErr: unknown,
): { message: string; detail: string; likelyLatexEscape: boolean } {
  const detail =
    parseErr instanceof Error
      ? parseErr.message
      : typeof parseErr === 'string'
        ? parseErr
        : 'JSON.parse failed';
  const likelyLatexEscape = isLikelyLatexJsonEscapeIssue(raw, detail);
  return {
    message: likelyLatexEscape ? LATEX_JSON_ESCAPE_HINT : 'Response is not valid JSON.',
    detail,
    likelyLatexEscape,
  };
}

/**
 * After a successful JSON.parse, detect latex strings corrupted by silent JSON escapes
 * (`\\frac` → form-feed, `\\nabla` → newline, `\\times` → tab).
 * Returns a human message or null if OK.
 */
export function detectSilentLatexJsonCorruption(latex: string): string | null {
  for (const { cmd, char, hint } of SILENT_CORRUPTION_COMMANDS) {
    // Corrupted form: control char + remainder of command name
    const remainder = cmd.slice(1); // e.g. frac → rac, nabla → abla
    if (latex.includes(char + remainder)) {
      return (
        `LaTeX looks corrupted by JSON escaping: unescaped ${hint} was interpreted as a ` +
        `JSON escape. In JSON strings write ${hint.replace('\\', '\\\\')} ` +
        `(every LaTeX backslash must be doubled).`
      );
    }
  }
  // Generic: any C0 control chars other than ordinary spaces are suspicious in LaTeX
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(latex)) {
    return (
      'LaTeX contains control characters that usually mean JSON ate a backslash escape ' +
      '(`\\\\frac` / `\\\\nabla` / `\\\\times`). Double every LaTeX backslash in the JSON string.'
    );
  }
  return null;
}

/** True if `\\X` would be a valid JSON single-char escape (for docs/tests). */
export function isJsonSingleCharEscape(ch: string): boolean {
  return JSON_SINGLE_ESCAPES.has(ch);
}
