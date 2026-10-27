/**
 * Deterministic Markdown → ContentDocument parser for content-first generation.
 * Not an LLM call. Recognises headings, paragraphs, nested lists, inline/display
 * math, fenced code, inline code, blockquotes, tables, :::graph markers, and
 * :::definition|example|warning|exercise markers.
 */

import { sanitizeLatexSource, validateLatex } from '../../equations/latex';
import { validateGraphExpression } from '../../graphs/expressionService';
import { normalizeCodeLanguage } from '../../text/syntaxHighlight';
import {
  looksLikeFenceOpen,
  parseFenceAt,
  stripMarkdownDocumentFence,
} from './markdownFences';
import { parseNestedListAt } from './markdownLists';
import { parseBlockquoteAt } from './markdownQuotes';
import {
  markdownTableToPlainText,
  parseMarkdownTableAt,
  type MarkdownTableAlignment,
  type ParsedMarkdownTable,
} from './markdownTables';
import {
  ContentParseError,
  type ContentComponentKind,
  type ContentDocument,
  type ContentDocumentNode,
  type ContentInlineSpan,
  type ContentTableCell,
  type ContentTableNode,
} from './types';

const COMPONENT_KINDS = new Set<ContentComponentKind>([
  'definition',
  'example',
  'warning',
  'exercise',
]);

function isEscapedDollar(source: string, dollarIndex: number): boolean {
  return dollarIndex > 0 && source[dollarIndex - 1] === '\\';
}

/** Pure money amounts like `5` / `12.50` — not physics `$0.50\,\mathrm{kg}$`. */
function isCurrencyAmount(content: string): boolean {
  return /^\d[\d,]*(?:\.\d+)?$/.test(content.trim());
}

/**
 * Reject runaway `$…$` that swallowed prose when the LLM omitted closers.
 * Allow short latex including leading digits (`0.50\,\mathrm{kg}`).
 */
function isPlausibleInlineLatex(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (t.length > 120) return false;
  if (isCurrencyAmount(t)) return false;
  const latexCmds = (t.match(/\\[a-zA-Z]+/g) ?? []).length;
  const spaceCount = (t.match(/ /g) ?? []).length;
  const wordCount = (t.match(/[A-Za-z]{3,}/g) ?? []).length;
  // "$5 today and $" style — spaces without TeX commands are prose, not math.
  if (spaceCount >= 1 && latexCmds === 0) return false;
  if (wordCount >= 3 && latexCmds === 0) return false;
  if (wordCount >= 5 && latexCmds < 2) return false;
  // Glued prose without spaces (ChatGPT stripping spaces inside a bad $…$).
  if (/[a-z]{16,}/i.test(t) && latexCmds < 2) return false;
  if (t.length > 80 && latexCmds < 2) return false;
  return true;
}

type TextStyle = { bold?: boolean; italic?: boolean };

/** Parse `**bold**`, `*italic*`, `***both***` (and `__` / `_`) inside a text segment. */
export function parseMarkdownEmphasis(
  raw: string,
  baseStyle: TextStyle = {},
): ContentInlineSpan[] {
  const spans: ContentInlineSpan[] = [];
  let i = 0;

  const pushText = (text: string, style: TextStyle) => {
    if (!text) return;
    const hasStyle = style.bold || style.italic;
    spans.push(
      hasStyle
        ? { type: 'text', text, style: { ...style } }
        : { type: 'text', text },
    );
  };

  while (i < raw.length) {
    // ***bold italic***
    if (raw.startsWith('***', i) || raw.startsWith('___', i)) {
      const marker = raw.slice(i, i + 3);
      const end = raw.indexOf(marker, i + 3);
      if (end !== -1) {
        pushText(raw.slice(i + 3, end), { ...baseStyle, bold: true, italic: true });
        i = end + 3;
        continue;
      }
    }
    // **bold** or __bold__
    if (raw.startsWith('**', i) || raw.startsWith('__', i)) {
      const marker = raw.slice(i, i + 2);
      const end = raw.indexOf(marker, i + 2);
      if (end !== -1) {
        pushText(raw.slice(i + 2, end), { ...baseStyle, bold: true });
        i = end + 2;
        continue;
      }
    }
    // *italic* or _italic_ (single delimiter; avoid matching mid-word _)
    if (raw[i] === '*' || raw[i] === '_') {
      const marker = raw[i]!;
      // Underscore italic only at clear boundaries (avoid snake_case).
      if (
        marker === '_' &&
        i > 0 &&
        /[A-Za-z0-9]/.test(raw[i - 1]!) &&
        i + 1 < raw.length &&
        /[A-Za-z0-9]/.test(raw[i + 1]!)
      ) {
        pushText(marker, baseStyle);
        i += 1;
        continue;
      }
      const end = raw.indexOf(marker, i + 1);
      if (end !== -1 && end > i + 1) {
        pushText(raw.slice(i + 1, end), { ...baseStyle, italic: true });
        i = end + 1;
        continue;
      }
    }

    // Accumulate plain text until next emphasis marker
    let j = i + 1;
    while (j < raw.length && raw[j] !== '*' && raw[j] !== '_') j += 1;
    pushText(raw.slice(i, j), baseStyle);
    i = j;
  }

  return spans.length > 0 ? spans : [{ type: 'text', text: '' }];
}

/**
 * Find a matching inline-code closing run of backticks of length `tickLen`
 * starting after `from` (CommonMark: longer runs of backticks open/close).
 */
function findInlineCodeClose(
  raw: string,
  from: number,
  tickLen: number,
): number {
  let i = from;
  while (i < raw.length) {
    if (raw[i] !== '`') {
      i += 1;
      continue;
    }
    let j = i;
    while (j < raw.length && raw[j] === '`') j += 1;
    if (j - i === tickLen) return i;
    i = j;
  }
  return -1;
}

/** Parse inline spans: text (+ bold/italic) + `code` + $...$ / \(...\). */
export function parseInlineSpans(raw: string): ContentInlineSpan[] {
  const spans: ContentInlineSpan[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (!textBuf) return;
    spans.push(...parseMarkdownEmphasis(textBuf));
    textBuf = '';
  };

  while (i < raw.length) {
    // Inline code — must run before math / emphasis so `$x$` stays literal.
    if (raw[i] === '`') {
      let tickLen = 0;
      while (i + tickLen < raw.length && raw[i + tickLen] === '`') tickLen += 1;
      const close = findInlineCodeClose(raw, i + tickLen, tickLen);
      if (close !== -1) {
        flushText();
        let code = raw.slice(i + tickLen, close);
        // CommonMark: strip one leading/trailing space when both present.
        if (
          code.length >= 2 &&
          code.startsWith(' ') &&
          code.endsWith(' ') &&
          code.trim().length > 0
        ) {
          code = code.slice(1, -1);
        }
        spans.push({ type: 'inline_code', text: code });
        i = close + tickLen;
        continue;
      }
    }

    // \( ... \)
    if (raw[i] === '\\' && raw[i + 1] === '(') {
      const end = raw.indexOf('\\)', i + 2);
      if (end === -1) {
        textBuf += raw.slice(i);
        break;
      }
      flushText();
      const latex = sanitizeLatexSource(raw.slice(i + 2, end));
      if (latex && isPlausibleInlineLatex(latex)) {
        spans.push({ type: 'inline_math', latex });
      } else {
        textBuf += raw.slice(i, end + 2);
      }
      i = end + 2;
      continue;
    }

    // Display $$ must never start an inline $…$ span.
    if (raw[i] === '$' && raw[i + 1] === '$') {
      textBuf += '$$';
      i += 2;
      continue;
    }

    // Escaped \$
    if (raw[i] === '$' && isEscapedDollar(raw, i)) {
      textBuf += '$';
      i += 1;
      continue;
    }

    // $...$ — allow leading digits when LaTeX follows (e.g. $0.50\,\mathrm{kg}$)
    if (raw[i] === '$') {
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') {
          j += 2;
          continue;
        }
        if (raw[j] === '$' && raw[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (raw[j] === '$') break;
        j += 1;
      }
      if (j < raw.length && raw[j] === '$') {
        const inner = raw.slice(i + 1, j);
        if (isCurrencyAmount(inner)) {
          // Keep `$12.50` as literal text
          textBuf += `$${inner}$`;
          i = j + 1;
          continue;
        }
        if (isPlausibleInlineLatex(inner)) {
          flushText();
          const latex = sanitizeLatexSource(inner);
          if (latex) spans.push({ type: 'inline_math', latex });
          i = j + 1;
          continue;
        }
        // Runaway / prose span — do not swallow; keep opening $ as text.
      }
    }

    textBuf += raw[i];
    i += 1;
  }
  flushText();
  return spans.length > 0 ? spans : [{ type: 'text', text: '' }];
}

function spansToPlain(spans: ContentInlineSpan[]): string {
  return spans
    .map((s) => {
      if (s.type === 'text') return s.text;
      if (s.type === 'inline_code') return s.text;
      return s.latex;
    })
    .join('')
    .trim();
}

function stripFenceAndNormalize(raw: string): string {
  return stripMarkdownDocumentFence(raw);
}

type ListItemBlock = {
  ordered: boolean;
  depth: number;
  start: number | null;
  body: string;
};

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; body: string }
  | { kind: 'paragraph'; body: string }
  | { kind: 'list'; ordered: boolean; items: ListItemBlock[] }
  | {
      kind: 'table';
      header: string[];
      alignments: MarkdownTableAlignment[];
      rows: string[][];
    }
  | { kind: 'display_math'; latex: string }
  | { kind: 'graph'; body: string }
  | { kind: 'component'; component: ContentComponentKind; body: string }
  | { kind: 'code'; language: string | null; body: string }
  | { kind: 'blockquote'; depth: number; body: string };

function parseGraphBody(body: string): {
  title: string | null;
  expressions: string[];
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  xLabel: string | null;
  yLabel: string | null;
} {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const expressions: string[] = [];
  let title: string | null = null;
  let xMin: number | null = null;
  let xMax: number | null = null;
  let yMin: number | null = null;
  let yMax: number | null = null;
  let xLabel: string | null = null;
  let yLabel: string | null = null;

  for (const line of lines) {
    const m = /^([a-z_]+)\s*:\s*(.+)$/i.exec(line);
    if (!m) {
      throw new ContentParseError(
        'invalid_graph',
        `Graph marker line must be key: value — got "${line}"`,
      );
    }
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    switch (key) {
      case 'title':
        title = value;
        break;
      case 'expression':
      case 'expr': {
        const check = validateGraphExpression(value, 'strict');
        if (!check.ok) {
          throw new ContentParseError(
            'invalid_expression',
            `Invalid graph expression "${value}": ${check.error ?? 'unknown'}`,
          );
        }
        expressions.push(value);
        break;
      }
      case 'x_min':
        xMin = Number(value);
        break;
      case 'x_max':
        xMax = Number(value);
        break;
      case 'y_min':
        yMin = Number(value);
        break;
      case 'y_max':
        yMax = Number(value);
        break;
      case 'x_label':
        xLabel = value;
        break;
      case 'y_label':
        yLabel = value;
        break;
      default:
        throw new ContentParseError(
          'invalid_graph',
          `Unknown graph field "${key}". Supported: title, expression, x_min, x_max, y_min, y_max, x_label, y_label.`,
        );
    }
  }

  if (expressions.length === 0) {
    throw new ContentParseError(
      'invalid_graph',
      'Graph marker requires at least one expression: … line.',
    );
  }
  for (const n of [xMin, xMax, yMin, yMax]) {
    if (n != null && !Number.isFinite(n)) {
      throw new ContentParseError('invalid_graph', 'Graph viewport bounds must be finite numbers.');
    }
  }
  return { title, expressions, xMin, xMax, yMin, yMax, xLabel, yLabel };
}

/** Tokenise Markdown source into coarse blocks (preserves order). */
export function tokenizeContentBlocks(source: string): Block[] {
  const text = stripFenceAndNormalize(source);
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  const pushParagraph = (buf: string[]) => {
    const body = buf.join('\n').trim();
    if (body) blocks.push({ kind: 'paragraph', body });
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block ``` / ~~~ — interior is literal (no math / markers / tables)
    if (looksLikeFenceOpen(line)) {
      const fence = parseFenceAt(lines, i);
      if (!fence) {
        throw new ContentParseError(
          'unclosed_fence',
          'Unclosed fenced code block.',
        );
      }
      blocks.push({
        kind: 'code',
        language: fence.language,
        body: fence.code,
      });
      i = fence.nextIndex;
      continue;
    }

    // Blockquotes (`>` / nested)
    const quote = parseBlockquoteAt(lines, i);
    if (quote) {
      for (const para of quote.paragraphs) {
        blocks.push({
          kind: 'blockquote',
          depth: para.depth,
          body: para.body,
        });
      }
      i = quote.nextIndex;
      continue;
    }

    // :::graph / :::definition / …
    const markerOpen = /^:::(graph|definition|example|warning|exercise)\s*$/i.exec(
      line.trim(),
    );
    if (markerOpen) {
      const name = markerOpen[1]!.toLowerCase();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== ':::') {
        buf.push(lines[i]!);
        i += 1;
      }
      if (i >= lines.length) {
        throw new ContentParseError(
          'unclosed_marker',
          `Unclosed :::${name} marker.`,
        );
      }
      i += 1; // closing :::
      const body = buf.join('\n').trim();
      if (name === 'graph') {
        blocks.push({ kind: 'graph', body });
      } else if (COMPONENT_KINDS.has(name as ContentComponentKind)) {
        blocks.push({
          kind: 'component',
          component: name as ContentComponentKind,
          body,
        });
      }
      continue;
    }

    // Display math $$ ... $$
    if (line.trim() === '$$' || /^\$\$/.test(line.trim())) {
      let body = '';
      if (line.trim() === '$$') {
        i += 1;
        const buf: string[] = [];
        while (i < lines.length && lines[i]!.trim() !== '$$') {
          buf.push(lines[i]!);
          i += 1;
        }
        if (i >= lines.length) {
          throw new ContentParseError('unclosed_math', 'Unclosed $$ display math.');
        }
        i += 1;
        body = buf.join('\n');
      } else {
        // Single-line $$...$$ or opening with content
        const trimmed = line.trim();
        if (trimmed.endsWith('$$') && trimmed.length > 4) {
          body = trimmed.slice(2, -2);
          i += 1;
        } else {
          body = trimmed.slice(2);
          i += 1;
          const buf: string[] = [body];
          while (i < lines.length && lines[i]!.trim() !== '$$') {
            buf.push(lines[i]!);
            i += 1;
          }
          if (i >= lines.length) {
            throw new ContentParseError('unclosed_math', 'Unclosed $$ display math.');
          }
          i += 1;
          body = buf.join('\n');
        }
      }
      blocks.push({ kind: 'display_math', latex: body });
      continue;
    }

    // \[ ... \]
    if (line.trim() === '\\[' || /^\\\[/.test(line.trim())) {
      let body = '';
      if (line.trim() === '\\[') {
        i += 1;
        const buf: string[] = [];
        while (i < lines.length && lines[i]!.trim() !== '\\]') {
          buf.push(lines[i]!);
          i += 1;
        }
        if (i >= lines.length) {
          throw new ContentParseError('unclosed_math', 'Unclosed \\[ display math.');
        }
        i += 1;
        body = buf.join('\n');
      } else {
        const trimmed = line.trim();
        if (trimmed.endsWith('\\]') && trimmed.length > 4) {
          body = trimmed.slice(2, -2);
          i += 1;
        } else {
          const buf: string[] = [trimmed.slice(2)];
          i += 1;
          while (i < lines.length && lines[i]!.trim() !== '\\]') {
            buf.push(lines[i]!);
            i += 1;
          }
          if (i >= lines.length) {
            throw new ContentParseError('unclosed_math', 'Unclosed \\[ display math.');
          }
          i += 1;
          body = buf.join('\n');
        }
      }
      blocks.push({ kind: 'display_math', latex: body });
      continue;
    }

    // Heading
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        body: heading[2]!.trim(),
      });
      i += 1;
      continue;
    }

    // Nested lists (ordered + unordered, mixed depths)
    const nestedList = parseNestedListAt(lines, i);
    if (nestedList) {
      blocks.push({
        kind: 'list',
        ordered: nestedList.items[0]?.ordered ?? false,
        items: nestedList.items,
      });
      i = nestedList.nextIndex;
      continue;
    }

    // GFM Markdown table (header + separator required)
    const tableParsed = parseMarkdownTableAt(lines, i);
    if (tableParsed) {
      blocks.push({
        kind: 'table',
        header: tableParsed.table.header,
        alignments: tableParsed.table.alignments,
        rows: tableParsed.table.rows,
      });
      i = tableParsed.nextIndex;
      continue;
    }

    // Paragraph — gather until blank / structural boundary
    const buf: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim()) break;
      if (looksLikeFenceOpen(l)) break;
      if (/^:::(graph|definition|example|warning|exercise)\s*$/i.test(l.trim()))
        break;
      if (l.trim() === '$$' || /^\$\$/.test(l.trim())) break;
      if (l.trim() === '\\[' || /^\\\[/.test(l.trim())) break;
      if (/^#{1,3}\s+/.test(l)) break;
      if (/^ {0,3}>/.test(l)) break;
      if (parseNestedListAt(lines, i)) break;
      // Do not swallow a following GFM table into the paragraph.
      if (parseMarkdownTableAt(lines, i)) break;
      buf.push(l);
      i += 1;
    }
    pushParagraph(buf);
  }

  return blocks;
}

function pushDisplayMath(
  latexRaw: string,
  sectionId: string | null,
  nodes: ContentDocumentNode[],
  warnings: string[],
): void {
  const latex = sanitizeLatexSource(latexRaw);
  if (!latex) {
    warnings.push('Skipped empty display-math block.');
    return;
  }
  const check = validateLatex(latex, true);
  if (!check.ok) {
    throw new ContentParseError(
      'invalid_latex',
      `Invalid display LaTeX: ${check.error ?? 'unknown error'}`,
    );
  }
  nodes.push({
    type: 'equation',
    latex,
    sectionId,
  });
}

function pushGraph(
  body: string,
  sectionId: string | null,
  nodes: ContentDocumentNode[],
): void {
  const g = parseGraphBody(body);
  nodes.push({
    type: 'graph',
    title: g.title,
    expressions: g.expressions,
    xMin: g.xMin,
    xMax: g.xMax,
    yMin: g.yMin,
    yMax: g.yMax,
    xLabel: g.xLabel,
    yLabel: g.yLabel,
    sectionId,
  });
}

function cellFromMarkdown(raw: string): ContentTableCell {
  const spans = parseInlineSpans(raw);
  return { spans, text: spansToPlain(spans) };
}

function pushTable(
  table: ParsedMarkdownTable,
  sectionId: string | null,
  nodes: ContentDocumentNode[],
): void {
  const columns = table.alignments.map((alignment) => ({ alignment }));
  const headerCells = table.header.map(cellFromMarkdown);
  const rows = [
    { header: true as const, cells: headerCells },
    ...table.rows.map((r) => ({ cells: r.map(cellFromMarkdown) })),
  ];
  const plain = markdownTableToPlainText(table, (raw) =>
    spansToPlain(parseInlineSpans(raw)),
  );
  const node: ContentTableNode = {
    type: 'table',
    columns,
    rows,
    text: plain,
    sectionId,
  };
  nodes.push(node);
}

/**
 * Expand :::definition|example|warning|exercise bodies into ordinary IR nodes.
 * Feature/component styling is on hold — markers are structural only (prose +
 * equations + graphs in reading order). Code for components remains elsewhere.
 */
function expandComponentBody(
  component: ContentComponentKind,
  body: string,
  sectionId: string | null,
  nodes: ContentDocumentNode[],
  warnings: string[],
): void {
  const inner = tokenizeContentBlocks(body);
  if (inner.length === 0) {
    warnings.push(`Skipped empty :::${component} block.`);
    return;
  }

  const before = nodes.length;
  for (const b of inner) {
    switch (b.kind) {
      case 'paragraph': {
        const spans = parseInlineSpans(b.body);
        const text = spansToPlain(spans);
        if (!text) break;
        nodes.push({
          type: 'paragraph',
          spans,
          text,
          sectionId,
        });
        break;
      }
      case 'heading': {
        // Keep nested step headings as paragraphs (do not open new sections).
        const spans = parseInlineSpans(b.body);
        const plain = spansToPlain(spans);
        if (!plain) break;
        nodes.push({
          type: 'paragraph',
          spans,
          text: plain,
          sectionId,
        });
        break;
      }
      case 'list': {
        const items = b.items.map((item) => {
          const spans = parseInlineSpans(item.body);
          return {
            ordered: item.ordered,
            depth: item.depth,
            start: item.start,
            spans,
            text: spansToPlain(spans),
          };
        });
        nodes.push({
          type: 'list',
          ordered: b.ordered,
          items,
          sectionId,
        });
        break;
      }
      case 'display_math':
        pushDisplayMath(b.latex, sectionId, nodes, warnings);
        break;
      case 'table':
        pushTable(
          { header: b.header, alignments: b.alignments, rows: b.rows },
          sectionId,
          nodes,
        );
        break;
      case 'graph':
        pushGraph(b.body, sectionId, nodes);
        break;
      case 'code': {
        const language = normalizeCodeLanguage(b.language);
        const code = b.body;
        const fenceLang = language ?? '';
        nodes.push({
          type: 'code_block',
          language,
          code,
          text: `\`\`\`${fenceLang}\n${code}\n\`\`\``,
          sectionId,
        });
        break;
      }
      case 'blockquote': {
        const spans = parseInlineSpans(b.body);
        const text = spansToPlain(spans);
        if (!text) break;
        nodes.push({
          type: 'blockquote',
          depth: b.depth,
          spans,
          text,
          sectionId,
        });
        break;
      }
      case 'component':
        expandComponentBody(b.component, b.body, sectionId, nodes, warnings);
        break;
    }
  }

  if (nodes.length === before) {
    warnings.push(`Skipped empty :::${component} block.`);
  }
}

/**
 * Parse a full LLM Markdown response into an ordered ContentDocument.
 * Validates LaTeX and graph expressions; throws ContentParseError on hard failures.
 */
export function parseContentDocument(raw: string): ContentDocument {
  const source = raw ?? '';
  if (!source.trim()) {
    throw new ContentParseError('empty', 'Content response is empty.');
  }

  const warnings: string[] = [];
  const blocks = tokenizeContentBlocks(source);
  const nodes: ContentDocumentNode[] = [];
  let sectionCounter = 0;
  let currentSectionId: string | null = null;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        sectionCounter += 1;
        currentSectionId = `sec_${sectionCounter}`;
        const spans = parseInlineSpans(block.body);
        nodes.push({
          type: 'heading',
          level: block.level,
          spans,
          text: spansToPlain(spans),
          sectionId: currentSectionId,
        });
        break;
      }
      case 'paragraph': {
        const spans = parseInlineSpans(block.body);
        const text = spansToPlain(spans);
        if (!text) break;
        nodes.push({
          type: 'paragraph',
          spans,
          text,
          sectionId: currentSectionId,
        });
        break;
      }
      case 'list': {
        const items = block.items.map((item) => {
          const spans = parseInlineSpans(item.body);
          return {
            ordered: item.ordered,
            depth: item.depth,
            start: item.start,
            spans,
            text: spansToPlain(spans),
          };
        });
        nodes.push({
          type: 'list',
          ordered: block.ordered,
          items,
          sectionId: currentSectionId,
        });
        break;
      }
      case 'table': {
        pushTable(
          {
            header: block.header,
            alignments: block.alignments,
            rows: block.rows,
          },
          currentSectionId,
          nodes,
        );
        break;
      }
      case 'display_math': {
        pushDisplayMath(block.latex, currentSectionId, nodes, warnings);
        break;
      }
      case 'graph': {
        pushGraph(block.body, currentSectionId, nodes);
        break;
      }
      case 'component': {
        expandComponentBody(
          block.component,
          block.body,
          currentSectionId,
          nodes,
          warnings,
        );
        break;
      }
      case 'code': {
        const language = normalizeCodeLanguage(block.language);
        const code = block.body;
        const fenceLang = language ?? '';
        nodes.push({
          type: 'code_block',
          language,
          code,
          text: `\`\`\`${fenceLang}\n${code}\n\`\`\``,
          sectionId: currentSectionId,
        });
        break;
      }
      case 'blockquote': {
        const spans = parseInlineSpans(block.body);
        const text = spansToPlain(spans);
        if (!text) break;
        nodes.push({
          type: 'blockquote',
          depth: block.depth,
          spans,
          text,
          sectionId: currentSectionId,
        });
        break;
      }
    }
  }

  if (nodes.length === 0) {
    throw new ContentParseError('empty', 'No educational content nodes were produced.');
  }

  return { nodes, raw: source, warnings };
}

/** Heuristic: does this look like JSON operations rather than Markdown content? */
export function looksLikeOperationsJson(raw: string): boolean {
  const t = raw.trim();
  // :::json directives are content-first Markdown extensions, not ops arrays.
  if (/^:::json\s*$/m.test(t)) return false;
  if (t.startsWith('{') || t.startsWith('[')) return true;
  if (/```json/i.test(t.slice(0, 80))) return true;
  return false;
}

/** Heuristic: does this look like Markdown content-first output? */
export function looksLikeContentMarkdown(raw: string): boolean {
  if (looksLikeOperationsJson(raw)) return false;
  const t = raw.trim();
  if (!t) return false;
  if (/^:::json\s*$/m.test(t)) return true;
  if (/^#{1,3}\s+/m.test(t)) return true;
  if (/\$\$/.test(t) || /\\\[[\s\S]*?\\\]/.test(t)) return true;
  if (/^:::(graph|definition|example|warning|exercise)\s*$/m.test(t)) return true;
  // GFM table separator row is a strong content-first signal.
  if (/^\s*\|?[\s:]*-{3,}[\s:]*\|/m.test(t)) return true;
  // Multi-paragraph prose without JSON operation arrays
  if (!/"operations"\s*:/.test(t) && t.split(/\n\n+/).length >= 2) return true;
  return false;
}
