/**
 * CanvasAgentResponsePreprocessor — targeted repair of malformed LaTeX
 * backslash escaping inside known JSON string fields.
 *
 * ONLY touches registered LaTeX fields (currently: "latex").
 * Does NOT globally rewrite `\` → `\\` across the document.
 *
 * Used for manual / freeform LLM paste ingestion. Strict structured API
 * responses should not need this; schema validation remains authoritative.
 */

/** JSON object keys whose string values are LaTeX source. */
export const LATEX_JSON_FIELDS = ['latex'] as const;

export type LatexJsonFieldName = (typeof LATEX_JSON_FIELDS)[number];

export interface LatexJsonRepairResult {
  /** Text after targeted repair (may equal input if nothing changed). */
  repaired: string;
  /** True when at least one character inside a latex field was rewritten. */
  changed: boolean;
  /** Number of single-backslash sequences doubled inside latex fields. */
  repairCount: number;
}

export interface LatexJsonRepairMeta {
  applied: boolean;
  rawResponse: string;
  /** Present when a repair pass was run (whether or not it changed bytes). */
  repairedResponse: string | null;
  repairCount: number;
  message: string | null;
}

export const LATEX_JSON_REPAIR_INDICATOR =
  'Recovered malformed LaTeX JSON escaping.';

const LATEX_FIELD_SET = new Set<string>(LATEX_JSON_FIELDS);

function isHex(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'a' && ch <= 'f') ||
    (ch >= 'A' && ch <= 'F')
  );
}

/**
 * True if `source[i..]` begins a JSON object key that is a registered
 * LaTeX field, followed by `:` and the opening `"` of its string value.
 * Returns the index of that opening quote, or -1.
 */
function findLatexValueOpenQuote(source: string, i: number): number {
  if (source[i] !== '"') return -1;
  let j = i + 1;
  let key = '';
  while (j < source.length) {
    const c = source[j]!;
    if (c === '"') break;
    // Keys are plain identifiers; reject escapes / oddities.
    if (c === '\\' || c === '\n' || c === '\r') return -1;
    key += c;
    j += 1;
    if (key.length > 64) return -1;
  }
  if (j >= source.length || source[j] !== '"') return -1;
  if (!LATEX_FIELD_SET.has(key)) return -1;
  j += 1; // past closing key quote
  while (j < source.length && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j += 1;
  }
  if (j >= source.length || source[j] !== ':') return -1;
  j += 1;
  while (j < source.length && (source[j] === ' ' || source[j] === '\t' || source[j] === '\n' || source[j] === '\r')) {
    j += 1;
  }
  if (j >= source.length || source[j] !== '"') return -1;
  return j;
}

/**
 * Repair the contents of one JSON string value that holds LaTeX.
 * Starts at the first character AFTER the opening quote.
 * Returns { text, end } where end is the index AFTER the closing quote.
 */
function repairLatexStringContents(
  source: string,
  start: number,
): { text: string; end: number; repairs: number } {
  let i = start;
  let out = '';
  let repairs = 0;

  while (i < source.length) {
    const c = source[i]!;

    if (c === '"') {
      // Unescaped closing quote.
      out += '"';
      return { text: out, end: i + 1, repairs };
    }

    if (c === '\\') {
      const next = i + 1 < source.length ? source[i + 1]! : '';

      if (next === '') {
        // Trailing lone backslash — emit a valid JSON literal backslash.
        out += '\\\\';
        repairs += 1;
        return { text: out + '"', end: i + 1, repairs };
      }

      // Already-correct doubled backslash → preserve both (do NOT quadruple).
      if (next === '\\') {
        out += '\\\\';
        i += 2;
        continue;
      }

      // Structural / legitimate JSON escapes to preserve as-is:
      //   \"  escaped quote (string structure)
      //   \/  escaped solidus
      //   \uXXXX  unicode escape
      if (next === '"') {
        out += '\\"';
        i += 2;
        continue;
      }
      if (next === '/') {
        out += '\\/';
        i += 2;
        continue;
      }
      if (
        next === 'u' &&
        i + 5 < source.length &&
        isHex(source[i + 2]!) &&
        isHex(source[i + 3]!) &&
        isHex(source[i + 4]!) &&
        isHex(source[i + 5]!)
      ) {
        out += source.slice(i, i + 6);
        i += 6;
        continue;
      }

      // Everything else — including \b \f \n \r \t and LaTeX commands —
      // is treated as a literal LaTeX backslash that must be JSON-escaped.
      out += '\\\\';
      out += next;
      repairs += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }

  // Unterminated string — emit what we have; caller will likely fail JSON.parse.
  return { text: out, end: i, repairs };
}

/**
 * Scan `raw` and double single backslashes inside registered LaTeX JSON
 * string fields only. Already-correct `\\` pairs are preserved.
 */
export function repairLatexJsonFields(raw: string): LatexJsonRepairResult {
  let i = 0;
  let out = '';
  let repairCount = 0;

  while (i < raw.length) {
    const openQuote = findLatexValueOpenQuote(raw, i);
    if (openQuote >= 0) {
      // Copy from current index through the opening quote of the value.
      out += raw.slice(i, openQuote + 1);
      const repaired = repairLatexStringContents(raw, openQuote + 1);
      out += repaired.text;
      repairCount += repaired.repairs;
      i = repaired.end;
      continue;
    }
    out += raw[i]!;
    i += 1;
  }

  return {
    repaired: out,
    changed: repairCount > 0,
    repairCount,
  };
}

/**
 * Walk a parsed JSON value and collect every string under a registered
 * LaTeX field key (shallow object walk of operations arrays is enough,
 * but we recurse for safety).
 */
export function collectLatexStrings(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLatexStrings(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (LATEX_FIELD_SET.has(k) && typeof v === 'string') {
        out.push(v);
      } else {
        collectLatexStrings(v, out);
      }
    }
  }
  return out;
}
