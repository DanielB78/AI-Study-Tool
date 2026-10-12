/**
 * Manual UI helpers for TextElement features.
 * Same mutations as AI ops (textFeatures) + store history/persist.
 */

import { useCanvasStore } from '../../store/canvasStore';
import type { TextElement } from '../../types/canvas';
import { touch } from '../../utils/ids';
import { measureTextElementWithFeatures } from './textAutoSizer';
import {
  addCommentToElement,
  addNoteToElement,
  ensureRichText,
  highlightQuoteInElement,
  insertHeadingInElement,
  removeCommentFromElement,
  removeNoteFromElement,
  removeTitleFromElement,
  setTitleOnElement,
  updateCommentOnElement,
  updateNoteOnElement,
  type TextCommentType,
  type TextHighlightStyle,
  type TextNoteType,
  type QuoteAnchorSpec,
} from './textFeatures';

function resizeFeatures(el: TextElement): TextElement {
  const measured = measureTextElementWithFeatures(el, {
    availableWidth: el.width,
  });
  return touch({
    ...el,
    height: Math.max(el.height, measured.height),
  });
}

function resolveTextId(elementId?: string): string | null {
  const store = useCanvasStore.getState();
  if (elementId) {
    const el = store.document.elements.find((e) => e.id === elementId);
    if (el?.type === 'text' && !el.locked) return elementId;
    return null;
  }
  const id = store.selectedIds[0];
  if (!id) return null;
  const el = store.document.elements.find((e) => e.id === id);
  if (!el || el.type !== 'text' || el.locked) return null;
  return id;
}

function mutateText(
  updater: (el: TextElement) => TextElement,
  elementId?: string,
): boolean {
  const id = resolveTextId(elementId);
  if (!id) return false;
  const store = useCanvasStore.getState();
  store.pushHistory();
  store.updateElement(id, (prev) => {
    if (prev.type !== 'text') return prev;
    return resizeFeatures(updater(prev));
  });
  store.persist();
  return true;
}

/** Find parent text element id for a comment (when selection may not match). */
function parentIdForComment(commentId: string): string | null {
  const el = useCanvasStore
    .getState()
    .document.elements.find(
      (e) => e.type === 'text' && e.comments?.some((c) => c.id === commentId),
    );
  return el?.type === 'text' ? el.id : null;
}

function parentIdForNote(noteId: string): string | null {
  const el = useCanvasStore
    .getState()
    .document.elements.find(
      (e) => e.type === 'text' && e.notes?.some((n) => n.id === noteId),
    );
  return el?.type === 'text' ? el.id : null;
}

export function uiSetTextTitle(text: string, elementId?: string): boolean {
  return mutateText((el) => setTitleOnElement(el, text), elementId);
}

export function uiRemoveTextTitle(elementId?: string): boolean {
  return mutateText((el) => removeTitleFromElement(el), elementId);
}

export function uiAddTextNote(
  text: string,
  noteType: TextNoteType = 'extra_information',
  elementId?: string,
): boolean {
  return mutateText(
    (el) => addNoteToElement(el, text, noteType).element,
    elementId,
  );
}

export function uiUpdateTextNote(noteId: string, text: string): boolean {
  const id = parentIdForNote(noteId);
  if (!id) return false;
  return mutateText((el) => updateNoteOnElement(el, noteId, { text }), id);
}

export function uiRemoveTextNote(noteId: string): boolean {
  const id = parentIdForNote(noteId);
  if (!id) return false;
  return mutateText((el) => removeNoteFromElement(el, noteId), id);
}

export function uiInsertHeading(
  text: string,
  level: 1 | 2 = 1,
  elementId?: string,
): boolean {
  return mutateText((el) => {
    const doc = ensureRichText(el);
    const firstId = doc.blocks[0]?.id;
    if (!firstId) {
      throw new Error('Cannot insert heading: text has no blocks.');
    }
    // Manual Add menu inserts at the top of the document (explicit position).
    return insertHeadingInElement(el, {
      text,
      level,
      beforeBlockId: firstId,
    }).element;
  }, elementId);
}

export function uiHighlightSelectedQuote(
  quote: string,
  style: TextHighlightStyle = 'important',
  elementId?: string,
): boolean {
  if (!quote.trim()) return false;
  return mutateText(
    (el) => highlightQuoteInElement(el, { quote: quote.trim(), style }),
    elementId,
  );
}

export function uiAddTextComment(
  anchor: QuoteAnchorSpec,
  comment: string,
  commentType: TextCommentType = 'explanation',
  elementId?: string,
): boolean {
  return mutateText(
    (el) =>
      addCommentToElement(el, {
        anchor,
        text: comment,
        commentType,
      }).element,
    elementId,
  );
}

export function uiUpdateTextComment(commentId: string, text: string): boolean {
  const id = parentIdForComment(commentId);
  if (!id) return false;
  return mutateText(
    (el) => updateCommentOnElement(el, commentId, { text }),
    id,
  );
}

export function uiRemoveTextComment(commentId: string): boolean {
  const id = parentIdForComment(commentId);
  if (!id) return false;
  return mutateText((el) => removeCommentFromElement(el, commentId), id);
}

export function uiToggleCommentOpen(commentId: string, open: boolean): boolean {
  const id = parentIdForComment(commentId);
  if (!id) return false;
  return mutateText(
    (el) =>
      updateCommentOnElement(el, commentId, {
        displayState: open ? 'open' : 'collapsed',
      }),
    id,
  );
}

/** Best-effort quote from the browser selection inside the rich editor. */
export function getSelectedTextQuote(): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return '';
  return sel.toString().trim();
}
