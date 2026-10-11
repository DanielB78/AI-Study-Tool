/**
 * Apply formatting to the current selection inside the rich-text contenteditable.
 */

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
