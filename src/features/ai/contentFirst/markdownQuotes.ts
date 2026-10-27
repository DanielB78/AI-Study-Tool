/**
 * Markdown blockquote recognition (`>` / nested `>>`).
 */

import { RICH_TEXT_LIMITS } from '../../text/richText';

export type ParsedQuoteLine = {
  depth: number;
  /** Content after quote markers (may be empty for blank quote lines). */
  body: string;
};

const QUOTE_RE = /^ {0,3}>(.*)$/;

export function parseQuoteLine(line: string): ParsedQuoteLine | null {
  const m = QUOTE_RE.exec(line);
  if (!m) return null;
  let rest = m[1] ?? '';
  // Optional space after >
  if (rest.startsWith(' ')) rest = rest.slice(1);
  let depth = 1;
  while (rest.startsWith('>') && depth < RICH_TEXT_LIMITS.maxQuoteDepth) {
    depth += 1;
    rest = rest.slice(1);
    if (rest.startsWith(' ')) rest = rest.slice(1);
  }
  return { depth, body: rest };
}

/**
 * Consume consecutive blockquote lines into paragraph-like quote bodies.
 * Blank quote lines (`>`) separate paragraphs at the same nesting depth.
 */
export function parseBlockquoteAt(
  lines: readonly string[],
  index: number,
): {
  paragraphs: Array<{ depth: number; body: string }>;
  nextIndex: number;
} | null {
  if (!parseQuoteLine(lines[index] ?? '')) return null;

  const paragraphs: Array<{ depth: number; body: string }> = [];
  let currentDepth = 0;
  let buf: string[] = [];
  let i = index;

  const flush = () => {
    const body = buf.join('\n').trimEnd();
    if (body.trim() || buf.length > 0) {
      // Keep empty paragraphs only when they were explicit separators — skip trailing empties.
      if (body.trim()) {
        paragraphs.push({ depth: Math.max(1, currentDepth), body: body.trim() });
      }
    }
    buf = [];
  };

  while (i < lines.length) {
    const q = parseQuoteLine(lines[i]!);
    if (!q) break;
    if (q.body.trim() === '' && buf.length === 0 && paragraphs.length === 0) {
      // Leading empty quote line — skip.
      i += 1;
      continue;
    }
    if (q.body.trim() === '') {
      // Paragraph break inside the quote.
      flush();
      currentDepth = q.depth;
      i += 1;
      continue;
    }
    if (currentDepth === 0) currentDepth = q.depth;
    if (q.depth !== currentDepth && buf.length > 0) {
      flush();
      currentDepth = q.depth;
    } else {
      currentDepth = q.depth;
    }
    buf.push(q.body);
    i += 1;
  }
  flush();

  if (paragraphs.length === 0) return null;
  return { paragraphs, nextIndex: i };
}
