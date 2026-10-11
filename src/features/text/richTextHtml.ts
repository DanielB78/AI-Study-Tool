/**
 * Render / parse helpers for rich-text HTML used by the overlay editor.
 */

import {
  resolveRichTextColor,
  resolveRichTextFontSize,
  type RichTextBlock,
  type RichTextDocument,
  type RichTextSpan,
} from './richText';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spanToHtml(
  span: RichTextSpan,
  defaults: { color: string; fontSize: number },
): string {
  const style = span.style ?? {};
  const parts: string[] = [];
  const color = resolveRichTextColor(style.color, 'text', defaults.color);
  const fontSize = resolveRichTextFontSize(style.font_size, defaults.fontSize);
  const highlight = style.highlight_color
    ? resolveRichTextColor(style.highlight_color, 'highlight', '#FEF08A')
    : null;

  if (style.bold) parts.push('font-weight:700');
  if (style.italic) parts.push('font-style:italic');
  if (style.underline) parts.push('text-decoration:underline');
  if (color !== defaults.color) parts.push(`color:${color}`);
  if (fontSize !== defaults.fontSize) parts.push(`font-size:${fontSize}px`);
  if (highlight) parts.push(`background-color:${highlight}`);

  const text = escapeHtml(span.text).replace(/\n/g, '<br/>');
  if (parts.length === 0) return text;
  return `<span style="${parts.join(';')}">${text}</span>`;
}

function blockToHtml(
  block: RichTextBlock,
  defaults: { color: string; fontSize: number },
  numberedIndex: number,
): { html: string; nextNumbered: number } {
  const inner = block.spans.map((s) => spanToHtml(s, defaults)).join('');
  if (block.type === 'heading') {
    const size = resolveRichTextFontSize('heading', defaults.fontSize);
    return {
      html: `<div data-rt-type="heading" style="font-weight:700;font-size:${size}px;margin:0 0 0.35em 0;line-height:1.25">${inner}</div>`,
      nextNumbered: 0,
    };
  }
  if (block.type === 'bullet') {
    return {
      html: `<div data-rt-type="bullet" style="display:flex;gap:0.4em;margin:0 0 0.2em 0;padding-left:0.15em"><span contenteditable="false" aria-hidden="true">•</span><div style="flex:1;min-width:0">${inner || '<br/>'}</div></div>`,
      nextNumbered: 0,
    };
  }
  if (block.type === 'numbered') {
    const n = numberedIndex + 1;
    return {
      html: `<div data-rt-type="numbered" data-rt-n="${n}" style="display:flex;gap:0.4em;margin:0 0 0.2em 0;padding-left:0.15em"><span contenteditable="false" aria-hidden="true">${n}.</span><div style="flex:1;min-width:0">${inner || '<br/>'}</div></div>`,
      nextNumbered: n,
    };
  }
  return {
    html: `<div data-rt-type="paragraph" style="margin:0 0 0.45em 0">${inner || '<br/>'}</div>`,
    nextNumbered: 0,
  };
}

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
  return `<div data-rt-root="1" style="font-family:${defaults.fontFamily};font-size:${defaults.fontSize}px;color:${defaults.color};line-height:1.35;word-wrap:break-word;overflow-wrap:anywhere">${parts.join('')}</div>`;
}

function styleFromElement(el: HTMLElement): RichTextSpan['style'] {
  const cs = el.style;
  const style: NonNullable<RichTextSpan['style']> = {};
  const weight = cs.fontWeight || getComputedStyle(el).fontWeight;
  if (weight === 'bold' || Number(weight) >= 600) style.bold = true;
  if ((cs.fontStyle || getComputedStyle(el).fontStyle) === 'italic') style.italic = true;
  const deco = cs.textDecoration || getComputedStyle(el).textDecorationLine || '';
  if (deco.includes('underline')) style.underline = true;
  if (cs.color) style.color = cs.color.startsWith('rgb') ? rgbToHex(cs.color) : cs.color;
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
    style.highlight_color = cs.backgroundColor.startsWith('rgb')
      ? rgbToHex(cs.backgroundColor)
      : cs.backgroundColor;
  }
  if (cs.fontSize) {
    const px = parseFloat(cs.fontSize);
    if (Number.isFinite(px)) style.font_size = px;
  }
  return Object.keys(style).length ? style : undefined;
}

function rgbToHex(rgb: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return '#1A1A1A';
  const h = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`.toUpperCase();
}

function spansFromNode(node: Node, inherited?: RichTextSpan['style']): RichTextSpan[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text) return [];
    return [{ text, style: inherited }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  if (el.getAttribute('contenteditable') === 'false') return [];
  const merged = { ...(inherited ?? {}), ...(styleFromElement(el) ?? {}) };
  const style = Object.keys(merged).length ? merged : undefined;
  if (el.tagName === 'BR') return [{ text: '\n', style }];
  const out: RichTextSpan[] = [];
  el.childNodes.forEach((child) => {
    out.push(...spansFromNode(child, style));
  });
  return out.length ? mergeAdjacentSpans(out) : [{ text: '', style }];
}

function mergeAdjacentSpans(spans: RichTextSpan[]): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && JSON.stringify(prev.style ?? {}) === JSON.stringify(s.style ?? {})) {
      prev.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Best-effort HTML → rich text (from contenteditable). */
export function htmlToRichText(root: HTMLElement): RichTextDocument {
  const blocks: RichTextBlock[] = [];
  const children = Array.from(root.querySelectorAll(':scope > [data-rt-type], :scope > div'));
  const nodes = children.length > 0 ? children : Array.from(root.children);

  if (nodes.length === 0) {
    const spans = spansFromNode(root);
    return { blocks: [{ type: 'paragraph', spans: spans.length ? spans : [{ text: '' }] }] };
  }

  for (const node of nodes) {
    const el = node as HTMLElement;
    const typeAttr = el.getAttribute('data-rt-type') as RichTextBlock['type'] | null;
    let contentRoot: HTMLElement = el;
    if (typeAttr === 'bullet' || typeAttr === 'numbered') {
      contentRoot = (el.querySelector(':scope > div') as HTMLElement) ?? el;
    }
    const spans = spansFromNode(contentRoot);
    const type: RichTextBlock['type'] =
      typeAttr === 'heading' || typeAttr === 'bullet' || typeAttr === 'numbered'
        ? typeAttr
        : 'paragraph';
    blocks.push({
      type,
      spans: spans.length ? spans : [{ text: '' }],
    });
  }

  return { blocks: blocks.length ? blocks : [{ type: 'paragraph', spans: [{ text: '' }] }] };
}

/**
 * Measure rendered rich-text height at a given width using an offscreen host.
 * Falls back to a heuristic when DOM is unavailable.
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
    let lines = 0;
    for (const block of doc.blocks) {
      const text = block.spans.map((s) => s.text).join('');
      const size = resolveRichTextFontSize(
        block.type === 'heading' ? 'heading' : block.spans[0]?.style?.font_size,
        defaults.fontSize,
      );
      const avg = size * 0.52;
      const cpl = Math.max(1, Math.floor(contentWidth / avg));
      lines += Math.max(1, Math.ceil(Math.max(text.length, 1) / cpl));
      lines += 0.35;
    }
    return Math.max(56, Math.ceil(lines * defaults.fontSize * (defaults.lineHeight ?? 1.35) + pad * 2));
  }

  const host = document.createElement('div');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    `width:${contentWidth}px`,
    'box-sizing:border-box',
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

  // Stub DOM environments (e.g. happy-dom) report 0 — use structural fallback.
  if (contentHeight < defaults.fontSize * 0.5) {
    let lines = 0;
    for (const block of doc.blocks) {
      const text = block.spans.map((s) => s.text).join('');
      const size = resolveRichTextFontSize(
        block.type === 'heading' ? 'heading' : block.spans[0]?.style?.font_size,
        defaults.fontSize,
      );
      const avg = size * 0.52;
      const cpl = Math.max(1, Math.floor(contentWidth / avg));
      lines += Math.max(1, Math.ceil(Math.max(text.length, 1) / cpl));
      lines += 0.35;
    }
    return Math.max(
      56,
      Math.ceil(lines * defaults.fontSize * (defaults.lineHeight ?? 1.35) + pad * 2),
    );
  }

  return Math.max(56, Math.ceil(contentHeight + pad * 2 + 4));
}
