/**
 * GitHub-Flavoured Markdown table recognition helpers.
 * Used by contentParser — not a general Markdown engine.
 */

export type MarkdownTableAlignment = 'left' | 'center' | 'right';

export type ParsedMarkdownTable = {
  header: string[];
  alignments: MarkdownTableAlignment[];
  rows: string[][];
};

/** Split a table row on unescaped `|`, honouring optional outer pipes. */
export function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return null;

  // Reject bare prose that happens to contain a single pipe without cell structure
  // unless it looks like a pipe-delimited row (at least one separator between cells,
  // or leading/trailing pipe form).
  let body = trimmed;
  const hadLeading = body.startsWith('|');
  const hadTrailing =
    body.endsWith('|') && (body.length < 2 || body[body.length - 2] !== '\\');
  if (hadLeading) body = body.slice(1);
  if (hadTrailing && body.endsWith('|')) body = body.slice(0, -1);

  const cells: string[] = [];
  let buf = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === '\\' && body[i + 1] === '|') {
      buf += '|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());

  // A lone cell without leading/trailing pipes is ordinary prose, not a row.
  if (!hadLeading && !hadTrailing && cells.length < 2) return null;
  // Need at least one column.
  if (cells.length === 0) return null;
  return cells;
}

function alignmentFromSeparatorCell(raw: string): MarkdownTableAlignment | null {
  const cell = raw.trim();
  if (!/^:?-{1,}:?$/.test(cell)) return null;
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

/** True when every cell is a GFM alignment/separator marker. */
export function isMarkdownTableSeparatorRow(cells: readonly string[]): boolean {
  return (
    cells.length > 0 &&
    cells.every((c) => alignmentFromSeparatorCell(c) !== null)
  );
}

export function alignmentsFromSeparatorRow(
  cells: readonly string[],
): MarkdownTableAlignment[] | null {
  if (!isMarkdownTableSeparatorRow(cells)) return null;
  return cells.map((c) => alignmentFromSeparatorCell(c)!);
}

/**
 * True when `lines[index]` starts a GFM table (header + separator on next line).
 */
export function looksLikeMarkdownTableStart(
  lines: readonly string[],
  index: number,
): boolean {
  if (index + 1 >= lines.length) return false;
  const header = splitMarkdownTableRow(lines[index]!);
  if (!header || header.length === 0) return false;
  const sep = splitMarkdownTableRow(lines[index + 1]!);
  if (!sep || !isMarkdownTableSeparatorRow(sep)) return false;
  // Column counts should roughly match (GFM allows mismatch; we still recognise).
  return true;
}

/**
 * Consume a GFM table starting at `index`. Returns null if not a valid table.
 * Does not require a trailing blank line.
 */
export function parseMarkdownTableAt(
  lines: readonly string[],
  index: number,
): { table: ParsedMarkdownTable; nextIndex: number } | null {
  if (!looksLikeMarkdownTableStart(lines, index)) return null;

  const header = splitMarkdownTableRow(lines[index]!)!;
  const sepCells = splitMarkdownTableRow(lines[index + 1]!)!;
  const alignmentsRaw = alignmentsFromSeparatorRow(sepCells)!;

  // Normalise column count to the wider of header / separator.
  const colCount = Math.max(header.length, alignmentsRaw.length, 1);
  const pad = <T>(arr: T[], fill: T): T[] => {
    const out = arr.slice(0, colCount);
    while (out.length < colCount) out.push(fill);
    return out;
  };

  const alignments = pad(alignmentsRaw, 'left' as MarkdownTableAlignment);
  const headerCells = pad(header, '');

  const rows: string[][] = [];
  let i = index + 2;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) break;
    // Structural boundaries that end a table
    if (/^```/.test(line.trim())) break;
    if (/^:::(graph|definition|example|warning|exercise|json)\s*$/i.test(line.trim()))
      break;
    if (line.trim() === '$$' || /^\$\$/.test(line.trim())) break;
    if (line.trim() === '\\[' || /^\\\[/.test(line.trim())) break;
    if (/^#{1,3}\s+/.test(line)) break;
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) break;

    const cells = splitMarkdownTableRow(line);
    if (!cells) break;
    // A new header+separator would be another table — stop before it.
    if (
      i + 1 < lines.length &&
      isMarkdownTableSeparatorRow(cells) === false &&
      looksLikeMarkdownTableStart(lines, i)
    ) {
      break;
    }
    // Do not treat a separator-only line mid-table as a data row.
    if (isMarkdownTableSeparatorRow(cells)) break;

    rows.push(pad(cells, ''));
    i += 1;
  }

  return {
    table: {
      header: headerCells,
      alignments,
      rows,
    },
    nextIndex: i,
  };
}

/** Markdown plain extract preserving header↔cell association for RAG. */
export function markdownTableToPlainText(
  table: ParsedMarkdownTable,
  cellPlain: (raw: string) => string = (s) => s,
): string {
  const escapePipes = (s: string) => s.replace(/\|/g, '\\|');
  const fmtRow = (cells: string[]) =>
    `| ${cells.map((c) => escapePipes(cellPlain(c))).join(' | ')} |`;
  const sep = `| ${table.alignments
    .map((a) => {
      if (a === 'center') return ':---:';
      if (a === 'right') return '---:';
      return '---';
    })
    .join(' | ')} |`;
  const lines = [
    fmtRow(table.header.map(cellPlain)),
    sep,
    ...table.rows.map((r) => fmtRow(r.map(cellPlain))),
  ];
  return lines.join('\n');
}
