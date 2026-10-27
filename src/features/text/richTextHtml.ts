/**
 * Render / parse helpers for rich-text HTML used by the overlay editor.
 *
 * Font sizes in generated HTML use `em` relative to the host's CSS font-size so
 * a single camera zoom scale on the host scales headings, body, and mixed spans
 * together (world coordinates stay fixed on the TextElement).
 *
 * Inline/display math reuse KaTeX via features/equations/latex.ts.
 */

import { renderLatexHtml } from '../equations/latex';
import {
  isCodeBlock,
  isDisplayMathBlock,
  isInlineCodeSpan,
  isInlineMathSpan,
  isTableBlock,
  isTextSpan,
  resolveRichTextColor,
  resolveRichTextFontSize,
  type RichTextBlock,
  type RichTextCodeBlock,
  type RichTextDocument,
  type RichTextInlineCodeSpan,
  type RichTextInlineMathSpan,
  type RichTextSpan,
  type RichTextTableAlignment,
  type RichTextTableBlock,
  type RichTextTableCell,
  type RichTextTableRow,
  type RichTextTextSpan,
} from './richText';
import { highlightCodeToHtml, normalizeCodeLanguage } from './syntaxHighlight';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** World font size → em relative to the document base (defaults.fontSize). */
function fontSizeToEm(worldPx: number, baseFontSize: number): string {
  const base = Math.max(baseFontSize, 1);
  const em = worldPx / base;
  return `${Math.round(em * 1000) / 1000}em`;
}

function mathChromeStyle(
  style: RichTextInlineMathSpan['style'] | undefined,
  defaults: { color: string },
): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.color) {
    const color = resolveRichTextColor(style.color, 'text', defaults.color);
    if (color !== defaults.color) parts.push(`color:${color}`);
  }
  if (style.highlight_color) {
    parts.push(
      `background-color:${resolveRichTextColor(style.highlight_color, 'highlight', '#FEF08A')}`,
    );
  }
  if (style.linked_comment_id) {
    parts.push('background-color:rgba(221,214,254,0.55)');
    parts.push('border-bottom:2px solid #7C3AED');
  }
  return parts.length ? ` style="${parts.join(';')}"` : '';
}

function inlineMathToHtml(
  span: RichTextInlineMathSpan,
  defaults: { color: string; fontSize: number },
): string {
  const { html, error } = renderLatexHtml(span.latex, { displayMode: false });
  const idAttr = span.id ? ` data-rt-math-id="${escapeHtml(span.id)}"` : '';
  const latexAttr = ` data-rt-latex="${escapeHtml(span.latex)}"`;
  const chrome = mathChromeStyle(span.style, defaults);
  const commentAttr = span.style?.linked_comment_id
    ? ` data-linked-comment="${escapeHtml(span.style.linked_comment_id)}"`
    : '';
  if (error || !html) {
    return `<span contenteditable="false" data-rt-span="inline_math"${idAttr}${latexAttr}${commentAttr}${chrome} class="rt-math rt-math--inline rt-math--error" title="${escapeHtml(error ?? 'Invalid LaTeX')}">${escapeHtml(span.latex)}</span>`;
  }
  return `<span contenteditable="false" data-rt-span="inline_math"${idAttr}${latexAttr}${commentAttr}${chrome} class="rt-math rt-math--inline">${html}</span>`;
}

function textSpanToHtml(
  span: RichTextTextSpan,
  defaults: { color: string; fontSize: number },
): string {
  const style = span.style ?? {};
  const parts: string[] = [];
  const color = resolveRichTextColor(style.color, 'text', defaults.color);
  const fontSize = resolveRichTextFontSize(style.font_size, defaults.fontSize);
  const highlight = style.highlight_color
    ? resolveRichTextColor(style.highlight_color, 'highlight', '#FEF08A')
    : null;
  const hasComment = !!style.linked_comment_id;

  if (style.bold) parts.push('font-weight:700');
  if (style.italic) parts.push('font-style:italic');
  if (style.underline || hasComment) parts.push('text-decoration:underline');
  if (color !== defaults.color) parts.push(`color:${color}`);
  if (fontSize !== defaults.fontSize) {
    parts.push(`font-size:${fontSizeToEm(fontSize, defaults.fontSize)}`);
  }
  if (highlight) parts.push(`background-color:${highlight}`);
  else if (hasComment) parts.push('background-color:rgba(221,214,254,0.55)');
  if (hasComment) {
    parts.push('box-decoration-break:clone');
    parts.push('-webkit-box-decoration-break:clone');
    parts.push('border-bottom:2px solid #7C3AED');
  }

  const text = escapeHtml(span.text).replace(/\n/g, '<br/>');
  const attrs = hasComment
    ? ` data-linked-comment="${escapeHtml(style.linked_comment_id!)}"`
    : '';
  if (parts.length === 0 && !attrs) return text;
  return `<span${attrs}${parts.length ? ` style="${parts.join(';')}"` : ''}>${text}</span>`;
}

function inlineCodeToHtml(
  span: RichTextInlineCodeSpan,
  defaults: { color: string },
): string {
  const chrome = mathChromeStyle(span.style, defaults);
  const commentAttr = span.style?.linked_comment_id
    ? ` data-linked-comment="${escapeHtml(span.style.linked_comment_id)}"`
    : '';
  return `<code data-rt-span="inline_code"${commentAttr}${chrome} class="rt-code-inline">${escapeHtml(span.text)}</code>`;
}

function spanToHtml(
  span: RichTextSpan,
  defaults: { color: string; fontSize: number },
): string {
  if (isInlineMathSpan(span)) return inlineMathToHtml(span, defaults);
  if (isInlineCodeSpan(span)) return inlineCodeToHtml(span, defaults);
  return textSpanToHtml(span, defaults);
}

function codeBlockToHtml(block: RichTextCodeBlock): string {
  const idAttr = block.id ? ` data-rt-block-id="${escapeHtml(block.id)}"` : '';
  const lang = block.language?.trim() || '';
  const langAttr = lang ? ` data-rt-lang="${escapeHtml(lang)}"` : '';
  const { html, highlighted } = highlightCodeToHtml(block.code, block.language);
  const hlClass = highlighted ? ' hljs' : '';
  // contenteditable=false keeps indentation stable; source is in data-rt-code for round-trip.
  return `<div data-rt-type="code_block"${idAttr}${langAttr} data-rt-code="${escapeHtml(block.code)}" class="rt-code-block" contenteditable="false" style="display:block;margin:0.75em 0;padding:0.75em 0.9em;border-radius:6px;background:color-mix(in srgb, currentColor 6%, transparent);border:1px solid color-mix(in srgb, currentColor 12%, transparent);overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.875em;line-height:1.45;white-space:pre"><pre class="rt-code-pre" style="margin:0;padding:0;background:transparent;border:none;white-space:pre;overflow:visible"><code class="rt-code-source${hlClass}"${lang ? ` data-language="${escapeHtml(lang)}"` : ''}>${html}</code></pre></div>`;
}

function displayMathToHtml(
  block: Extract<RichTextBlock, { type: 'display_math' }>,
  defaults: { color: string; fontSize: number },
): string {
  const { html, error } = renderLatexHtml(block.latex, { displayMode: true });
  const idAttr = block.id ? ` data-rt-math-id="${escapeHtml(block.id)}"` : '';
  const latexAttr = ` data-rt-latex="${escapeHtml(block.latex)}"`;
  const inner =
    error || !html
      ? `<span class="rt-math--error" title="${escapeHtml(error ?? 'Invalid LaTeX')}">${escapeHtml(block.latex)}</span>`
      : html;
  // Centred display block; overflow-x for unusually wide expressions.
  return `<div data-rt-type="display_math"${idAttr}${latexAttr} class="rt-math rt-math--display" contenteditable="false" style="display:block;text-align:center;margin:0.65em 0;padding:0.15em 0;overflow-x:auto;line-height:1.35;font-size:${fontSizeToEm(defaults.fontSize * 1.15, defaults.fontSize)};background:transparent;border:none">${inner}</div>`;
}

function alignCss(alignment: RichTextTableAlignment): string {
  if (alignment === 'center') return 'center';
  if (alignment === 'right') return 'right';
  return 'left';
}

function tableCellToHtml(
  cell: RichTextTableCell,
  alignment: RichTextTableAlignment,
  tag: 'th' | 'td',
  defaults: { color: string; fontSize: number },
): string {
  const inner = cell.spans.map((s) => spanToHtml(s, defaults)).join('') || '<br/>';
  const weight = tag === 'th' ? 'font-weight:600;' : 'font-weight:inherit;';
  return `<${tag} data-rt-cell="1" data-rt-align="${alignment}" style="text-align:${alignCss(alignment)};${weight}padding:0.4em 0.65em;vertical-align:top;border-bottom:1px solid color-mix(in srgb, currentColor 18%, transparent);word-wrap:break-word;overflow-wrap:anywhere">${inner}</${tag}>`;
}

function tableToHtml(
  block: RichTextTableBlock,
  defaults: { color: string; fontSize: number },
): string {
  const colCount = Math.max(
    block.columns.length,
    ...block.rows.map((r) => r.cells.length),
    1,
  );
  const alignments: RichTextTableAlignment[] = Array.from(
    { length: colCount },
    (_, i) => block.columns[i]?.alignment ?? 'left',
  );
  const idAttr = block.id ? ` data-rt-block-id="${escapeHtml(block.id)}"` : '';
  const colsAttr = ` data-rt-cols="${alignments.join(',')}"`;

  const headerRow = block.rows.find((r) => r.header);
  const bodyRows = headerRow
    ? block.rows.filter((r) => r !== headerRow)
    : block.rows;

  const padCells = (row: RichTextTableRow): RichTextTableCell[] =>
    Array.from({ length: colCount }, (_, i) => row.cells[i] ?? { spans: [{ text: '' }] });

  let thead = '';
  if (headerRow) {
    const cells = padCells(headerRow)
      .map((c, i) => tableCellToHtml(c, alignments[i]!, 'th', defaults))
      .join('');
    thead = `<thead><tr>${cells}</tr></thead>`;
  }

  const tbodyRows = (headerRow ? bodyRows : block.rows)
    .map((row) => {
      const cells = padCells(row)
        .map((c, i) => tableCellToHtml(c, alignments[i]!, 'td', defaults))
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  // App-owned styling: subtle separators, consistent padding, theme via currentColor.
  // overflow-x:auto avoids silent clipping when content is wider than the TextElement.
  return `<div data-rt-type="table"${idAttr}${colsAttr} class="rt-table-wrap" style="display:block;margin:0.75em 0;overflow-x:auto;max-width:100%"><table class="rt-table" style="width:100%;border-collapse:collapse;table-layout:auto;font-size:1em;line-height:1.35;border-top:1px solid color-mix(in srgb, currentColor 22%, transparent);border-bottom:1px solid color-mix(in srgb, currentColor 22%, transparent)">${thead}<tbody>${tbodyRows}</tbody></table></div>`;
}

const LIST_BULLETS = ['•', '◦', '▪', '•'] as const;

function blockToHtml(
  block: RichTextBlock,
  defaults: { color: string; fontSize: number },
  numberedIndex: number,
): { html: string; nextNumbered: number } {
  if (isDisplayMathBlock(block)) {
    return { html: displayMathToHtml(block, defaults), nextNumbered: 0 };
  }
  if (isTableBlock(block)) {
    return { html: tableToHtml(block, defaults), nextNumbered: 0 };
  }
  if (isCodeBlock(block)) {
    return { html: codeBlockToHtml(block), nextNumbered: 0 };
  }
  const inner = block.spans.map((s) => spanToHtml(s, defaults)).join('');
  if (block.type === 'heading') {
    const size = resolveRichTextFontSize('heading', defaults.fontSize);
    return {
      html: `<div data-rt-type="heading" style="font-weight:700;font-size:${fontSizeToEm(size, defaults.fontSize)};margin:0 0 0.35em 0;line-height:1.25">${inner}</div>`,
      nextNumbered: 0,
    };
  }
  if (block.type === 'blockquote') {
    const depth = Math.max(1, block.depth ?? 1);
    const pad = 0.75 + (depth - 1) * 0.55;
    return {
      html: `<div data-rt-type="blockquote" data-rt-depth="${depth}" class="rt-blockquote" style="margin:0.55em 0;padding:0.35em 0.75em 0.35em ${pad}em;border-left:3px solid color-mix(in srgb, currentColor 28%, transparent);background:color-mix(in srgb, currentColor 4%, transparent)">${inner || '<br/>'}</div>`,
      nextNumbered: 0,
    };
  }
  if (block.type === 'bullet') {
    const depth = Math.max(0, block.depth ?? 0);
    const bullet = LIST_BULLETS[Math.min(depth, LIST_BULLETS.length - 1)]!;
    const pad = 0.15 + depth * 1.15;
    return {
      html: `<div data-rt-type="bullet" data-rt-depth="${depth}" style="display:flex;gap:0.4em;margin:0 0 0.2em 0;padding-left:${pad}em"><span contenteditable="false" aria-hidden="true">${bullet}</span><div style="flex:1;min-width:0">${inner || '<br/>'}</div></div>`,
      nextNumbered: 0,
    };
  }
  if (block.type === 'numbered') {
    const depth = Math.max(0, block.depth ?? 0);
    const start = block.start && block.start > 0 ? block.start : numberedIndex + 1;
    const n = start;
    const pad = 0.15 + depth * 1.15;
    return {
      html: `<div data-rt-type="numbered" data-rt-n="${n}" data-rt-depth="${depth}" style="display:flex;gap:0.4em;margin:0 0 0.2em 0;padding-left:${pad}em"><span contenteditable="false" aria-hidden="true">${n}.</span><div style="flex:1;min-width:0">${inner || '<br/>'}</div></div>`,
      nextNumbered: n,
    };
  }
  return {
    html: `<div data-rt-type="paragraph" style="margin:0 0 0.45em 0">${inner || '<br/>'}</div>`,
    nextNumbered: 0,
  };
}

/**
 * Build HTML for a rich-text document.
 * The root uses `font-size: 1em` so the host element controls the world→screen scale.
 */
export function richTextToHtml(
  doc: RichTextDocument,
  defaults: { color: string; fontSize: number; fontFamily: string },
): string {
  let numbered = 0;
  const parts: string[] = [];
  for (const block of doc.blocks) {
    const { html, nextNumbered } = blockToHtml(
      block,
      { color: defaults.color, fontSize: defaults.fontSize },
      numbered,
    );
    numbered = block.type === 'numbered' ? nextNumbered : 0;
    parts.push(html);
  }
  return `<div data-rt-root="1" style="font-family:${defaults.fontFamily};font-size:1em;color:${defaults.color};line-height:1.35;word-wrap:break-word;overflow-wrap:anywhere">${parts.join('')}</div>`;
}

function styleFromElement(
  el: HTMLElement,
  baseFontSize: number,
  rootFontPx: number,
): RichTextTextSpan['style'] {
  const cs = el.style;
  const computed = getComputedStyle(el);
  const style: NonNullable<RichTextTextSpan['style']> = {};
  const weight = cs.fontWeight || computed.fontWeight;
  if (weight === 'bold' || Number(weight) >= 600) style.bold = true;
  if ((cs.fontStyle || computed.fontStyle) === 'italic') style.italic = true;
  const deco = cs.textDecoration || computed.textDecorationLine || '';
  if (deco.includes('underline')) style.underline = true;
  if (cs.color) style.color = cs.color.startsWith('rgb') ? rgbToHex(cs.color) : cs.color;
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
    style.highlight_color = cs.backgroundColor.startsWith('rgb')
      ? rgbToHex(cs.backgroundColor)
      : cs.backgroundColor;
  }
  const computedPx = parseFloat(computed.fontSize);
  if (Number.isFinite(computedPx) && rootFontPx > 0) {
    const world = Math.round((computedPx / rootFontPx) * baseFontSize);
    if (world !== baseFontSize && world >= 10 && world <= 48) {
      style.font_size = world;
    }
  }
  return Object.keys(style).length ? style : undefined;
}

function rgbToHex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return '#1A1A1A';
  const h = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`.toUpperCase();
}

function inlineMathFromElement(el: HTMLElement): RichTextInlineMathSpan {
  const latex = el.getAttribute('data-rt-latex') ?? el.textContent ?? '';
  const id = el.getAttribute('data-rt-math-id') ?? undefined;
  const linked = el.getAttribute('data-linked-comment') ?? undefined;
  const style: RichTextInlineMathSpan['style'] = {};
  if (el.style.color) {
    style.color = el.style.color.startsWith('rgb')
      ? rgbToHex(el.style.color)
      : el.style.color;
  }
  if (el.style.backgroundColor && el.style.backgroundColor !== 'transparent') {
    style.highlight_color = el.style.backgroundColor.startsWith('rgb')
      ? rgbToHex(el.style.backgroundColor)
      : el.style.backgroundColor;
  }
  if (linked) style.linked_comment_id = linked;
  return {
    type: 'inline_math',
    latex,
    ...(id ? { id } : {}),
    ...(Object.keys(style).length ? { style } : {}),
  };
}

function spansFromNode(
  node: Node,
  baseFontSize: number,
  rootFontPx: number,
  inherited?: RichTextTextSpan['style'],
): RichTextSpan[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text) return [];
    return [{ text, style: inherited }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;

  if (el.getAttribute('data-rt-span') === 'inline_math') {
    return [inlineMathFromElement(el)];
  }

  if (el.getAttribute('data-rt-span') === 'inline_code' || el.tagName === 'CODE') {
    // Prefer explicit attribute; bare <code> inside paragraphs is also inline code.
    // Skip <code> inside fenced code blocks (handled at block level).
    if (el.closest('[data-rt-type="code_block"]')) return [];
    const linked = el.getAttribute('data-linked-comment') ?? undefined;
    const style: RichTextInlineCodeSpan['style'] = {};
    if (linked) style.linked_comment_id = linked;
    return [
      {
        type: 'inline_code',
        text: el.textContent ?? '',
        ...(Object.keys(style).length ? { style } : {}),
      },
    ];
  }

  // Skip list markers / other non-editable chrome, but not math / inline code.
  if (el.getAttribute('contenteditable') === 'false') return [];

  const merged = {
    ...(inherited ?? {}),
    ...(styleFromElement(el, baseFontSize, rootFontPx) ?? {}),
  };
  const style = Object.keys(merged).length ? merged : undefined;
  if (el.tagName === 'BR') return [{ text: '\n', style }];
  const out: RichTextSpan[] = [];
  el.childNodes.forEach((child) => {
    out.push(...spansFromNode(child, baseFontSize, rootFontPx, style));
  });
  return out.length ? mergeAdjacentSpans(out) : [{ text: '', style }];
}

function mergeAdjacentSpans(spans: RichTextSpan[]): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const s of spans) {
    if (isInlineMathSpan(s) || isInlineCodeSpan(s)) {
      out.push({ ...s });
      continue;
    }
    const prev = out[out.length - 1];
    if (
      prev &&
      isTextSpan(prev) &&
      JSON.stringify(prev.style ?? {}) === JSON.stringify(s.style ?? {})
    ) {
      prev.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

function parseAlignAttr(raw: string | null | undefined): RichTextTableAlignment {
  if (raw === 'center' || raw === 'right' || raw === 'left') return raw;
  return 'left';
}

function tableFromElement(
  wrap: HTMLElement,
  baseFontSize: number,
  rootFontPx: number,
): RichTextTableBlock {
  const id = wrap.getAttribute('data-rt-block-id') ?? undefined;
  const colsAttr = wrap.getAttribute('data-rt-cols') ?? '';
  const alignmentsFromAttr = colsAttr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseAlignAttr(s));

  const table = wrap.querySelector('table') ?? wrap;
  const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
  // Fallback: no thead — treat first tr as header when th present, else all body.
  const allRows = Array.from(table.querySelectorAll('tr'));

  const rows: RichTextTableRow[] = [];
  let colCount = alignmentsFromAttr.length;

  const cellsFromRow = (tr: Element, header: boolean): RichTextTableRow => {
    const cellEls = Array.from(tr.querySelectorAll(':scope > th, :scope > td'));
    colCount = Math.max(colCount, cellEls.length);
    const cells: RichTextTableCell[] = cellEls.map((cellEl) => {
      const spans = spansFromNode(cellEl, baseFontSize, rootFontPx);
      return { spans: spans.length ? spans : [{ text: '' }] };
    });
    return header ? { header: true, cells } : { cells };
  };

  if (headerCells.length > 0 || table.querySelector('thead')) {
    const headerTr = table.querySelector('thead tr');
    if (headerTr) rows.push(cellsFromRow(headerTr, true));
    for (const tr of bodyRows) rows.push(cellsFromRow(tr, false));
  } else {
    allRows.forEach((tr, idx) => {
      const hasTh = tr.querySelector(':scope > th') != null;
      rows.push(cellsFromRow(tr, hasTh || idx === 0));
    });
  }

  if (rows.length === 0) {
    rows.push({ header: true, cells: [{ spans: [{ text: '' }] }] });
  }

  colCount = Math.max(colCount, ...rows.map((r) => r.cells.length), 1);
  const columns = Array.from({ length: colCount }, (_, i) => {
    const firstCell = table
      .querySelectorAll('tr')
      .item(0)
      ?.querySelectorAll('th, td')
      .item(i) as HTMLElement | null | undefined;
    const align =
      alignmentsFromAttr[i] ??
      parseAlignAttr(firstCell?.getAttribute('data-rt-align'));
    return { alignment: align };
  });

  // Pad short rows so structure stays rectangular.
  for (const row of rows) {
    while (row.cells.length < colCount) {
      row.cells.push({ spans: [{ text: '' }] });
    }
  }

  return {
    type: 'table',
    columns,
    rows,
    ...(id ? { id } : {}),
  };
}

/** Best-effort HTML → rich text (from contenteditable). */
export function htmlToRichText(
  root: HTMLElement,
  options?: { baseFontSize?: number },
): RichTextDocument {
  const baseFontSize = options?.baseFontSize ?? 16;
  const rootFontPx =
    parseFloat(getComputedStyle(root).fontSize) || baseFontSize;

  const blocks: RichTextBlock[] = [];
  const children = Array.from(root.querySelectorAll(':scope > [data-rt-type], :scope > div'));
  const nodes = children.length > 0 ? children : Array.from(root.children);

  if (nodes.length === 0) {
    const spans = spansFromNode(root, baseFontSize, rootFontPx);
    return { blocks: [{ type: 'paragraph', spans: spans.length ? spans : [{ text: '' }] }] };
  }

  for (const node of nodes) {
    const el = node as HTMLElement;
    const typeAttr = el.getAttribute('data-rt-type');

    if (typeAttr === 'display_math') {
      const latex = el.getAttribute('data-rt-latex') ?? el.textContent ?? '';
      const id = el.getAttribute('data-rt-math-id') ?? undefined;
      blocks.push({
        type: 'display_math',
        latex,
        spans: [],
        ...(id ? { id } : {}),
      });
      continue;
    }

    if (typeAttr === 'table') {
      blocks.push(tableFromElement(el, baseFontSize, rootFontPx));
      continue;
    }

    if (typeAttr === 'code_block') {
      const id = el.getAttribute('data-rt-block-id') ?? undefined;
      const language = normalizeCodeLanguage(
        el.getAttribute('data-rt-lang') || el.getAttribute('data-language'),
      );
      const code =
        el.getAttribute('data-rt-code') ??
        el.querySelector('code')?.textContent ??
        el.textContent ??
        '';
      blocks.push({
        type: 'code_block',
        code,
        language,
        ...(id ? { id } : {}),
      });
      continue;
    }

    let contentRoot: HTMLElement = el;
    if (typeAttr === 'bullet' || typeAttr === 'numbered') {
      contentRoot = (el.querySelector(':scope > div') as HTMLElement) ?? el;
    }
    const spans = spansFromNode(contentRoot, baseFontSize, rootFontPx);
    const depthRaw = el.getAttribute('data-rt-depth');
    const depth =
      depthRaw != null && Number.isFinite(Number(depthRaw))
        ? Math.max(0, Math.round(Number(depthRaw)))
        : undefined;
    const nRaw = el.getAttribute('data-rt-n');
    const start =
      typeAttr === 'numbered' && nRaw != null && Number.isFinite(Number(nRaw))
        ? Math.max(1, Math.round(Number(nRaw)))
        : undefined;

    const type: Exclude<
      RichTextBlock['type'],
      'display_math' | 'table' | 'code_block'
    > =
      typeAttr === 'heading' ||
      typeAttr === 'bullet' ||
      typeAttr === 'numbered' ||
      typeAttr === 'blockquote'
        ? typeAttr
        : 'paragraph';
    blocks.push({
      type,
      spans: spans.length ? spans : [{ text: '' }],
      ...(depth !== undefined &&
      (type === 'bullet' || type === 'numbered' || type === 'blockquote')
        ? { depth: type === 'blockquote' ? Math.max(1, depth) : depth }
        : {}),
      ...(start !== undefined ? { start } : {}),
    });
  }

  return { blocks: blocks.length ? blocks : [{ type: 'paragraph', spans: [{ text: '' }] }] };
}

/**
 * Measure rendered rich-text height at a given width using an offscreen host.
 * Falls back to a heuristic when DOM is unavailable.
 * Measurement is always in world units (host font-size = defaults.fontSize) — never zoom.
 */
export function measureRichTextHeight(
  doc: RichTextDocument,
  width: number,
  defaults: {
    color: string;
    fontSize: number;
    fontFamily: string;
    padding: number;
    lineHeight?: number;
  },
): number {
  const pad = defaults.padding;
  const contentWidth = Math.max(width - pad * 2, 40);

  if (typeof document === 'undefined') {
    return estimateRichTextHeightFallback(doc, contentWidth, defaults, pad);
  }

  const host = document.createElement('div');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    `width:${contentWidth}px`,
    'box-sizing:border-box',
    `font-size:${defaults.fontSize}px`,
    `font-family:${defaults.fontFamily}`,
    `color:${defaults.color}`,
    `line-height:${defaults.lineHeight ?? 1.35}`,
  ].join(';');
  host.innerHTML = richTextToHtml(doc, {
    color: defaults.color,
    fontSize: defaults.fontSize,
    fontFamily: defaults.fontFamily,
  });
  document.body.appendChild(host);
  const contentHeight = Math.ceil(
    Math.max(
      host.getBoundingClientRect().height,
      host.scrollHeight,
      host.offsetHeight,
      0,
    ),
  );
  document.body.removeChild(host);

  if (contentHeight < defaults.fontSize * 0.5) {
    return estimateRichTextHeightFallback(doc, contentWidth, defaults, pad);
  }

  return Math.max(56, Math.ceil(contentHeight + pad * 2 + 4));
}

function estimateRichTextHeightFallback(
  doc: RichTextDocument,
  contentWidth: number,
  defaults: { fontSize: number; lineHeight?: number },
  pad: number,
): number {
  let lines = 0;
  for (const block of doc.blocks) {
    if (isDisplayMathBlock(block)) {
      // Tall display equations (fractions etc.) need more than one body line.
      const approx = Math.max(2.2, 1.2 + block.latex.length / 40);
      lines += approx;
      lines += 0.8;
      continue;
    }
    if (isTableBlock(block)) {
      const colCount = Math.max(block.columns.length, 1);
      const cellWidth = Math.max(40, contentWidth / colCount);
      for (const row of block.rows) {
        let rowLines = 1;
        for (const cell of row.cells) {
          let textLen = 0;
          for (const s of cell.spans) {
            if (isInlineMathSpan(s)) {
              textLen += Math.max(2, Math.ceil(s.latex.length * 0.7));
            } else {
              textLen += s.text.length;
            }
          }
          const avg = defaults.fontSize * 0.52;
          const cpl = Math.max(1, Math.floor(cellWidth / avg));
          rowLines = Math.max(rowLines, Math.ceil(Math.max(textLen, 1) / cpl));
        }
        // Header / body row + cell padding ≈ 0.5 line extra.
        lines += rowLines + 0.5;
      }
      lines += 1.2; // table vertical margins
      continue;
    }
    if (isCodeBlock(block)) {
      const codeLines = Math.max(1, block.code.split('\n').length);
      // Monospace slightly denser; padding ≈ 1.5 lines.
      lines += codeLines * 0.95 + 1.5;
      continue;
    }
    let textLen = 0;
    let extraMathWidth = 0;
    for (const s of block.spans) {
      if (isInlineMathSpan(s)) {
        // Treat inline math as wider than raw latex char count.
        textLen += Math.max(2, Math.ceil(s.latex.length * 0.7));
        extraMathWidth += defaults.fontSize * 0.35;
      } else {
        textLen += s.text.length;
      }
    }
    const size = resolveRichTextFontSize(
      block.type === 'heading' ? 'heading' : undefined,
      defaults.fontSize,
    );
    const avg = size * 0.52;
    const cpl = Math.max(1, Math.floor((contentWidth - extraMathWidth) / avg));
    lines += Math.max(1, Math.ceil(Math.max(textLen, 1) / cpl));
    lines += block.type === 'blockquote' ? 0.55 : 0.35;
  }
  return Math.max(
    56,
    Math.ceil(lines * defaults.fontSize * (defaults.lineHeight ?? 1.35) + pad * 2),
  );
}
