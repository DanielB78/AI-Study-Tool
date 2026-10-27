/**
 * Nested Markdown list recognition (ordered + unordered, mixed nesting).
 * Indentation is interpreted in ~2-space / tab units (CommonMark-ish).
 */

import { RICH_TEXT_LIMITS } from '../../text/richText';

export type ParsedListItem = {
  ordered: boolean;
  /** 0 = top level. */
  depth: number;
  /** Explicit start number when ordered (from the marker). */
  start: number | null;
  body: string;
};

const UNORDERED_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})([.)])\s+(.*)$/;

function indentColumns(ws: string): number {
  let cols = 0;
  for (const ch of ws) {
    if (ch === '\t') cols += 4;
    else cols += 1;
  }
  return cols;
}

function depthFromIndent(indent: number, stack: number[]): number {
  // stack holds indent columns for each open depth.
  while (stack.length > 0 && indent < stack[stack.length - 1]!) {
    stack.pop();
  }
  if (stack.length === 0) {
    stack.push(indent);
    return 0;
  }
  const top = stack[stack.length - 1]!;
  if (indent >= top + 2) {
    if (stack.length >= RICH_TEXT_LIMITS.maxListDepth) {
      return stack.length - 1;
    }
    stack.push(indent);
    return stack.length - 1;
  }
  // Same level (or slightly deeper but < 2 spaces) → keep current depth.
  return stack.length - 1;
}

export function parseListItemLine(line: string): {
  ordered: boolean;
  indent: number;
  start: number | null;
  body: string;
} | null {
  const u = UNORDERED_RE.exec(line);
  if (u) {
    return {
      ordered: false,
      indent: indentColumns(u[1] ?? ''),
      start: null,
      body: (u[3] ?? '').trimEnd(),
    };
  }
  const o = ORDERED_RE.exec(line);
  if (o) {
    return {
      ordered: true,
      indent: indentColumns(o[1] ?? ''),
      start: Number(o[2]),
      body: (o[4] ?? '').trimEnd(),
    };
  }
  return null;
}

/**
 * Consume a run of nested list items starting at `index`.
 * Continuation lines (indented without a new marker) append to the current item.
 */
export function parseNestedListAt(
  lines: readonly string[],
  index: number,
): { items: ParsedListItem[]; nextIndex: number } | null {
  const first = parseListItemLine(lines[index] ?? '');
  if (!first) return null;

  const items: ParsedListItem[] = [];
  const indentStack: number[] = [];
  let i = index;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      // Blank line ends the list (tight lists). Loose list continuation is rare in LLM output.
      break;
    }
    // Structural boundaries
    if (/^ {0,3}#{1,3}\s+/.test(line)) break;
    if (/^ {0,3}```/.test(line) || /^ {0,3}~~~/.test(line)) break;
    if (/^ {0,3}:::(graph|definition|example|warning|exercise|json)\s*$/i.test(line.trim()))
      break;
    if (line.trim() === '$$' || /^\$\$/.test(line.trim())) break;
    if (/^ {0,3}>/.test(line)) break;

    const item = parseListItemLine(line);
    if (item) {
      const depth = depthFromIndent(item.indent, indentStack);
      items.push({
        ordered: item.ordered,
        depth,
        start: item.ordered ? item.start : null,
        body: item.body,
      });
      i += 1;
      // Continuation lines for this item
      while (i < lines.length) {
        const cont = lines[i]!;
        if (!cont.trim()) break;
        if (parseListItemLine(cont)) break;
        if (/^ {0,3}#{1,3}\s+/.test(cont)) break;
        if (/^ {0,3}```/.test(cont) || /^ {0,3}~~~/.test(cont)) break;
        if (/^ {0,3}>/.test(cont)) break;
        if (cont.trim() === '$$' || /^\$\$/.test(cont.trim())) break;
        // Continuation must be indented past the marker column (~indent+2).
        const contIndent = indentColumns(/^(\s*)/.exec(cont)?.[1] ?? '');
        if (contIndent < item.indent + 2) break;
        const last = items[items.length - 1]!;
        last.body = `${last.body}\n${cont.trim()}`.trimEnd();
        i += 1;
      }
      continue;
    }
    break;
  }

  if (items.length === 0) return null;
  return { items, nextIndex: i };
}
