/**
 * Apply formatting / insert math into the current rich-text contenteditable.
 */

import { renderLatexHtml, sanitizeLatexSource, validateLatex } from '../equations/latex';
import { RICH_TEXT_COLOR_PALETTE, RICH_TEXT_HIGHLIGHT_PALETTE } from './richText';

function richEditor(): HTMLElement | null {
  return document.querySelector('[data-rich-editor="1"]') as HTMLElement | null;
}

export function isRichTextEditing(): boolean {
  return !!richEditor() && document.activeElement === richEditor();
}

export function applyRichSelectionCommand(
  cmd: 'bold' | 'italic' | 'underline' | 'foreColor' | 'hiliteColor',
  value?: string,
): boolean {
  const editor = richEditor();
  if (!editor) return false;
  editor.focus();
  try {
    if (cmd === 'foreColor' && value) {
      document.execCommand('styleWithCSS', false, 'true');
      return document.execCommand('foreColor', false, value);
    }
    if (cmd === 'hiliteColor' && value) {
      document.execCommand('styleWithCSS', false, 'true');
      const ok =
        document.execCommand('hiliteColor', false, value) ||
        document.execCommand('backColor', false, value);
      return ok;
    }
    return document.execCommand(cmd, false);
  } catch {
    return false;
  }
}

export function applyRichPaletteColor(
  kind: 'text' | 'highlight',
  name: keyof typeof RICH_TEXT_COLOR_PALETTE | string,
): boolean {
  const hex =
    name in RICH_TEXT_COLOR_PALETTE
      ? kind === 'highlight'
        ? RICH_TEXT_HIGHLIGHT_PALETTE[name as keyof typeof RICH_TEXT_HIGHLIGHT_PALETTE]
        : RICH_TEXT_COLOR_PALETTE[name as keyof typeof RICH_TEXT_COLOR_PALETTE]
      : name;
  return applyRichSelectionCommand(kind === 'highlight' ? 'hiliteColor' : 'foreColor', hex);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mathNodeHtml(
  latex: string,
  mode: 'inline' | 'display',
  mathId?: string,
): string {
  const source = sanitizeLatexSource(latex);
  const displayMode = mode === 'display';
  const { html, error } = renderLatexHtml(source, { displayMode });
  const idAttr = mathId ? ` data-rt-math-id="${escapeHtml(mathId)}"` : '';
  const latexAttr = ` data-rt-latex="${escapeHtml(source)}"`;
  if (mode === 'inline') {
    const body =
      error || !html
        ? escapeHtml(source)
        : html;
    const errClass = error || !html ? ' rt-math--error' : '';
    return `<span contenteditable="false" data-rt-span="inline_math"${idAttr}${latexAttr} class="rt-math rt-math--inline${errClass}">${body}</span>`;
  }
  const body =
    error || !html
      ? `<span class="rt-math--error">${escapeHtml(source)}</span>`
      : html;
  return `<div data-rt-type="display_math"${idAttr}${latexAttr} class="rt-math rt-math--display" contenteditable="false" style="display:block;text-align:center;margin:0.65em 0;padding:0.15em 0;overflow-x:auto;line-height:1.35;background:transparent;border:none">${body}</div>`;
}

function notifyEditorInput(editor: HTMLElement) {
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

function findRtBlock(node: Node | null, editor: HTMLElement): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur instanceof HTMLElement && cur.hasAttribute('data-rt-type')) {
      return cur;
    }
    cur = cur.parentNode;
  }
  return null;
}

/** Insert inline or display math at the current selection. */
export function insertRichMath(mode: 'inline' | 'display', latex: string): boolean {
  const editor = richEditor();
  if (!editor) return false;
  const source = sanitizeLatexSource(latex);
  if (!source) return false;
  const check = validateLatex(source, mode === 'display');
  if (!check.ok) return false;

  editor.focus();
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = mathNodeHtml(source, mode);
  const node = wrapper.firstChild;
  if (!node) return false;

  if (mode === 'display') {
    // Display math must be a top-level block sibling, not nested in a paragraph.
    const root =
      (editor.querySelector('[data-rt-root]') as HTMLElement | null) ?? editor;
    const block = findRtBlock(range.commonAncestorContainer, editor);
    range.deleteContents();
    if (block && block.parentElement === root) {
      block.after(node);
    } else {
      root.appendChild(node);
    }
  } else {
    range.deleteContents();
    range.insertNode(node);
  }

  // Place caret after the inserted node.
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  notifyEditorInput(editor);
  return true;
}

export type RichMathSelection = {
  element: HTMLElement;
  mode: 'inline' | 'display';
  latex: string;
  mathId: string | null;
};

/** Find a math node from a click target or current selection. */
export function findRichMathSelection(from?: EventTarget | null): RichMathSelection | null {
  const editor = richEditor();
  if (!editor) return null;

  let el: HTMLElement | null = null;
  if (from instanceof HTMLElement) {
    el = from.closest('.rt-math') as HTMLElement | null;
  }
  if (!el) {
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      const start =
        sel.anchorNode.nodeType === Node.ELEMENT_NODE
          ? (sel.anchorNode as HTMLElement)
          : sel.anchorNode.parentElement;
      el = start?.closest('.rt-math') as HTMLElement | null;
    }
  }
  if (!el || !editor.contains(el)) return null;

  const mode =
    el.getAttribute('data-rt-span') === 'inline_math' ||
    el.classList.contains('rt-math--inline')
      ? 'inline'
      : 'display';
  const latex = el.getAttribute('data-rt-latex') ?? '';
  const mathId = el.getAttribute('data-rt-math-id');
  return { element: el, mode, latex, mathId };
}

/** Replace latex on an existing math DOM node and refresh KaTeX. */
export function updateRichMathNode(
  selection: RichMathSelection,
  latex: string,
  mode?: 'inline' | 'display',
): boolean {
  const editor = richEditor();
  if (!editor) return false;
  const nextMode = mode ?? selection.mode;
  const source = sanitizeLatexSource(latex);
  if (!source) return false;
  const check = validateLatex(source, nextMode === 'display');
  if (!check.ok) return false;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = mathNodeHtml(source, nextMode, selection.mathId ?? undefined);
  const node = wrapper.firstChild;
  if (!node) return false;

  if (selection.mode === nextMode) {
    selection.element.replaceWith(node);
  } else if (nextMode === 'display') {
    // Promote inline → top-level display block after the containing block.
    const root =
      (editor.querySelector('[data-rt-root]') as HTMLElement | null) ?? editor;
    const block = findRtBlock(selection.element, editor);
    selection.element.remove();
    if (block && block.parentElement === root) block.after(node);
    else root.appendChild(node);
  } else {
    // Display → inline: replace the display block with a paragraph containing the math.
    const para = document.createElement('div');
    para.setAttribute('data-rt-type', 'paragraph');
    para.style.cssText = 'margin:0 0 0.45em 0';
    para.appendChild(node);
    selection.element.replaceWith(para);
  }

  notifyEditorInput(editor);
  return true;
}

export function deleteRichMathNode(selection: RichMathSelection): boolean {
  const editor = richEditor();
  if (!editor) return false;
  selection.element.remove();
  notifyEditorInput(editor);
  return true;
}

/** Prompt helper used by toolbar — returns latex or null if cancelled. */
export function promptForLatex(
  initial: string,
  mode: 'inline' | 'display',
): string | null {
  const label =
    mode === 'inline'
      ? 'Inline equation LaTeX:'
      : 'Display equation LaTeX:';
  const result = window.prompt(label, initial);
  if (result === null) return null;
  const source = sanitizeLatexSource(result);
  if (!source) return null;
  const check = validateLatex(source, mode === 'display');
  if (!check.ok) {
    window.alert(check.error ?? 'Invalid LaTeX');
    return null;
  }
  return source;
}
