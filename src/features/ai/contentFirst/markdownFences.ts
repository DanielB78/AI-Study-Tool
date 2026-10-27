/**
 * Markdown fence helpers — ``` / ~~~ with matching length, language info string.
 * Used so fenced content stays literal (no :::json / :::graph / math parsing).
 */

export type ParsedFenceOpen = {
  marker: '`' | '~';
  length: number;
  language: string | null;
  /** Absolute end index of the opening fence line content (after \n). */
};

export function parseFenceOpenLine(line: string): ParsedFenceOpen | null {
  const trimmed = line.trimEnd();
  // Opening fence must start at column 0–3 in CommonMark; we accept indent ≤ 3 spaces.
  const m = /^ {0,3}([`~]{3,})([^`~\n]*)$/.exec(trimmed);
  if (!m) return null;
  const ticks = m[1]!;
  const marker = ticks[0] as '`' | '~';
  if (![...ticks].every((c) => c === marker)) return null;
  const info = (m[2] ?? '').trim();
  // Info string must not contain the fence character for backticks.
  if (marker === '`' && info.includes('`')) return null;
  const language = info.split(/\s+/)[0]?.trim() || null;
  return {
    marker,
    length: ticks.length,
    language: language ? language.toLowerCase() : null,
  };
}

export function isFenceCloseLine(
  line: string,
  open: Pick<ParsedFenceOpen, 'marker' | 'length'>,
): boolean {
  const trimmed = line.trimEnd();
  const m = /^ {0,3}([`~]{3,})\s*$/.exec(trimmed);
  if (!m) return false;
  const ticks = m[1]!;
  if (ticks[0] !== open.marker) return false;
  if (![...ticks].every((c) => c === open.marker)) return false;
  return ticks.length >= open.length;
}

/**
 * Consume a fenced code block starting at `index`.
 * Returns null if the line is not a fence open.
 */
export function parseFenceAt(
  lines: readonly string[],
  index: number,
): {
  language: string | null;
  code: string;
  nextIndex: number;
} | null {
  const open = parseFenceOpenLine(lines[index] ?? '');
  if (!open) return null;
  const body: string[] = [];
  let i = index + 1;
  while (i < lines.length) {
    if (isFenceCloseLine(lines[i]!, open)) {
      return {
        language: open.language,
        code: body.join('\n'),
        nextIndex: i + 1,
      };
    }
    body.push(lines[i]!);
    i += 1;
  }
  return null; // unclosed — caller throws
}

/** True when a line looks like a fence open (``` or ~~~). */
export function looksLikeFenceOpen(line: string): boolean {
  return parseFenceOpenLine(line) != null;
}

const DOC_WRAPPER_LANGS = new Set(['markdown', 'md']);

function isDocumentWrapperOpen(
  open: ParsedFenceOpen | null,
): open is ParsedFenceOpen {
  return (
    open != null &&
    open.marker === '`' &&
    open.length === 3 &&
    open.language != null &&
    DOC_WRAPPER_LANGS.has(open.language)
  );
}

/**
 * Body of a ```markdown / ```md wrapper whose closing fence is the last
 * non-blank line (so inner educational ```python … ``` fences stay intact).
 * Returns null when the span is not a dominating document wrapper.
 */
function extractDocumentWrapperBody(
  lines: readonly string[],
  openIndex: number,
): string | null {
  const open = parseFenceOpenLine(lines[openIndex] ?? '');
  if (!isDocumentWrapperOpen(open)) return null;

  // Last non-blank line must be a matching close (length ≥ 3 backticks only).
  let closeIndex = -1;
  for (let i = lines.length - 1; i > openIndex; i--) {
    if (!(lines[i] ?? '').trim()) continue;
    if (!isFenceCloseLine(lines[i]!, open)) return null;
    closeIndex = i;
    break;
  }
  if (closeIndex < 0) return null;

  const body = lines.slice(openIndex + 1, closeIndex).join('\n');
  if (!body.trim()) return null;
  return body;
}

/**
 * Unwrap an optional ChatGPT-style ```markdown / ```md document wrapper.
 *
 * Only exact length-3 backtick fences with language `markdown` or `md` are
 * treated as wrappers. Longer fences (````markdown) are educational code
 * blocks and must not be stripped — otherwise nested ``` inside them is lost.
 *
 * The closing fence is the last non-blank line so lessons that contain inner
 * ```python … ``` fences still unwrap correctly.
 */
export function stripMarkdownDocumentFence(raw: string): string {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const trimmed = text.trim();
  if (!trimmed) return text;

  const lines = trimmed.split('\n');

  // Whole document is one ```markdown / ```md fence.
  const whole = extractDocumentWrapperBody(lines, 0);
  if (whole != null) return whole;

  // Short preamble, then a dominating ```markdown / ```md fence to EOF.
  for (let i = 1; i < lines.length; i++) {
    if (!isDocumentWrapperOpen(parseFenceOpenLine(lines[i] ?? ''))) continue;
    const before = lines.slice(0, i).join('\n').trim();
    if (before.length > 120) continue;
    const body = extractDocumentWrapperBody(lines, i);
    if (body != null) return body;
  }

  return text;
}
