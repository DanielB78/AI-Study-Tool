/**
 * Deterministic Markdown → ContentDocument parser for content-first generation.
 * Not an LLM call. Recognises headings, paragraphs, lists, inline/display math,
 * :::graph markers, and :::definition|example|warning|exercise markers.
 */

import { sanitizeLatexSource, validateLatex } from '../../equations/latex';
import { validateGraphExpression } from '../../graphs/expressionService';
import {
  ContentParseError,
  type ContentComponentKind,
  type ContentDocument,
  type ContentDocumentNode,
  type ContentInlineSpan,
} from './types';

const COMPONENT_KINDS = new Set<ContentComponentKind>([
  'definition',
  'example',
  'warning',
  'exercise',
]);

function isCurrencyContext(source: string, dollarIndex: number): boolean {
  // "$5" or "USD $12.50" — digit immediately after $ → not math.
  const next = source[dollarIndex + 1];
  if (next && /\d/.test(next)) return true;
  // Escaped \$
  if (dollarIndex > 0 && source[dollarIndex - 1] === '\\') return true;
  return false;
}

/** Parse inline spans: text + $...$ / \(...\). */
export function parseInlineSpans(raw: string): ContentInlineSpan[] {
  const spans: ContentInlineSpan[] = [];
  let i = 0;
  let textBuf = '';

  const flushText = () => {
    if (textBuf) {
      spans.push({ type: 'text', text: textBuf });
      textBuf = '';
    }
  };

  while (i < raw.length) {
    // \( ... \)
    if (raw[i] === '\\' && raw[i + 1] === '(') {
      const end = raw.indexOf('\\)', i + 2);
      if (end === -1) {
        textBuf += raw.slice(i);
        break;
      }
      flushText();
      const latex = sanitizeLatexSource(raw.slice(i + 2, end));
      if (latex) spans.push({ type: 'inline_math', latex });
      i = end + 2;
      continue;
    }

    // $...$ (not $$ and not currency)
    if (raw[i] === '$' && raw[i + 1] !== '$' && !isCurrencyContext(raw, i)) {
      let j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '\\') {
          j += 2;
          continue;
        }
        if (raw[j] === '$') break;
        j += 1;
      }
      if (j < raw.length && raw[j] === '$') {
        flushText();
        const latex = sanitizeLatexSource(raw.slice(i + 1, j));
        if (latex) spans.push({ type: 'inline_math', latex });
        i = j + 1;
        continue;
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
    .map((s) => (s.type === 'text' ? s.text : s.latex))
    .join('')
    .trim();
}

function stripFenceAndNormalize(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const trimmed = text.trim();
  // Preferred: whole response is one ```markdown fence.
  const whole = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i.exec(
    trimmed,
  );
  if (whole) return whole[1]!;
  // ChatGPT often adds a short preamble ("Here is the document:") before the fence.
  // Prefer the largest ```markdown / ```md fenced body when present.
  const fenced =
    /```(?:markdown|md)\s*\n([\s\S]*?)\n```/i.exec(trimmed) ??
    /```text\s*\n([\s\S]*?)\n```/i.exec(trimmed);
  if (fenced?.[1] != null && fenced[1].trim().length > 0) {
    return fenced[1];
  }
  return text;
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; body: string }
  | { kind: 'paragraph'; body: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'display_math'; latex: string }
  | { kind: 'graph'; body: string }
  | { kind: 'component'; component: ContentComponentKind; body: string }
  | { kind: 'code'; body: string };

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

    // Fenced code block ``` — treat interior as opaque paragraph text (no math split)
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!.trim())) {
        buf.push(lines[i]!);
        i += 1;
      }
      if (i >= lines.length) {
        throw new ContentParseError('unclosed_fence', 'Unclosed ``` code fence.');
      }
      i += 1; // closing fence
      blocks.push({ kind: 'code', body: buf.join('\n') });
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

    // List (consecutive items)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const lm = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(lines[i]!);
        if (!lm) break;
        items.push(lm[1]!.trim());
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph — gather until blank / structural boundary
    const buf: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (!l.trim()) break;
      if (/^```/.test(l.trim())) break;
      if (/^:::(graph|definition|example|warning|exercise)\s*$/i.test(l.trim()))
        break;
      if (l.trim() === '$$' || /^\$\$/.test(l.trim())) break;
      if (l.trim() === '\\[' || /^\\\[/.test(l.trim())) break;
      if (/^#{1,3}\s+/.test(l)) break;
      if (/^\s*([-*+]|\d+\.)\s+/.test(l) && buf.length === 0) break;
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) break;
      buf.push(l);
      i += 1;
    }
    pushParagraph(buf);
  }

  return blocks;
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
          const spans = parseInlineSpans(item);
          return { spans, text: spansToPlain(spans) };
        });
        nodes.push({
          type: 'list',
          ordered: block.ordered,
          items,
          sectionId: currentSectionId,
        });
        break;
      }
      case 'display_math': {
        const latex = sanitizeLatexSource(block.latex);
        if (!latex) {
          warnings.push('Skipped empty display-math block.');
          break;
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
          sectionId: currentSectionId,
        });
        break;
      }
      case 'graph': {
        const g = parseGraphBody(block.body);
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
          sectionId: currentSectionId,
        });
        break;
      }
      case 'component': {
        const spans = parseInlineSpans(block.body);
        const text = spansToPlain(spans);
        if (!text) {
          warnings.push(`Skipped empty :::${block.component} block.`);
          break;
        }
        nodes.push({
          type: 'component',
          component: block.component,
          spans,
          text,
          sectionId: currentSectionId,
        });
        break;
      }
      case 'code': {
        // Opaque code → plain paragraph (preserve content, no math parsing).
        const text = block.body.trim();
        if (text) {
          nodes.push({
            type: 'paragraph',
            spans: [{ type: 'text', text }],
            text,
            sectionId: currentSectionId,
          });
        }
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
  if (t.startsWith('{') || t.startsWith('[')) return true;
  if (/```json/i.test(t.slice(0, 80))) return true;
  return false;
}

/** Heuristic: does this look like Markdown content-first output? */
export function looksLikeContentMarkdown(raw: string): boolean {
  if (looksLikeOperationsJson(raw)) return false;
  const t = raw.trim();
  if (!t) return false;
  if (/^#{1,3}\s+/m.test(t)) return true;
  if (/\$\$/.test(t) || /\\\[[\s\S]*?\\\]/.test(t)) return true;
  if (/^:::(graph|definition|example|warning|exercise)\s*$/m.test(t)) return true;
  // Multi-paragraph prose without JSON keys
  if (!/"operations"\s*:/.test(t) && t.split(/\n\n+/).length >= 2) return true;
  return false;
}
