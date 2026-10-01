/**
 * Resolve editor-selected canvas elements into AI context inputs.
 * Selection alone is sufficient — no embeddings / retrieval required.
 */

import type { CanvasElement } from '../../types/canvas';
import type { WorldRect } from './geometry';

export interface ExplicitSelectionInput {
  element_id: string;
  element_type: string;
  text: string;
  geometry: WorldRect;
  /** True when the element has meaningful AI-readable content. */
  has_readable_content: boolean;
}

/**
 * Extract AI-readable content for a canvas element.
 * Does not invent descriptions for drawings/images/connectors.
 */
export function extractElementContextContent(el: CanvasElement): {
  text: string;
  has_readable_content: boolean;
} {
  if (el.type === 'text') {
    return { text: el.text, has_readable_content: el.text.trim().length > 0 };
  }
  if (el.type === 'shape') {
    const label = el.label?.trim() ?? '';
    return {
      text: label,
      has_readable_content: label.length > 0,
    };
  }
  // drawing / image / connector — preserve identity + geometry only
  return { text: '', has_readable_content: false };
}

/**
 * Map snapshotted editor selection IDs → context inputs from CURRENT CanvasDocument.
 * Missing/deleted IDs are skipped (validation at apply-time handles stale ops).
 */
export function resolveExplicitSelection(
  selectedIds: readonly string[],
  elements: readonly CanvasElement[],
): ExplicitSelectionInput[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const out: ExplicitSelectionInput[] = [];
  for (const id of selectedIds) {
    const el = byId.get(id);
    if (!el) continue;
    const { text, has_readable_content } = extractElementContextContent(el);
    out.push({
      element_id: el.id,
      element_type: el.type,
      text,
      has_readable_content,
      geometry: {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      },
    });
  }
  return out;
}

/** Snapshot current editor selection (stable copy). */
export function snapshotEditorSelection(selectedIds: readonly string[]): string[] {
  return [...selectedIds];
}
