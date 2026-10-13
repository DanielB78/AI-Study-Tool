/**
 * Extract AI-readable content for a canvas element.
 * Does not invent descriptions for drawings/images/connectors.
 * Graphs: structured configuration only (no screenshots / samples / embeddings).
 */

import type { CanvasElement } from '../../types/canvas';
import type { WorldRect } from './geometry';
import { formatGraphElementForContext } from './graphContext';

export interface ExplicitSelectionInput {
  element_id: string;
  element_type: string;
  text: string;
  geometry: WorldRect;
  /** True when the element has meaningful AI-readable content. */
  has_readable_content: boolean;
  /** ImageElement.src when type === 'image' — asset ref only, not a caption. */
  image_src?: string | null;
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
  if (el.type === 'equation') {
    const latex = el.latex?.trim() ?? '';
    return { text: latex, has_readable_content: latex.length > 0 };
  }
  if (el.type === 'graph') {
    const text = formatGraphElementForContext(el);
    return { text, has_readable_content: true };
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
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const el = byId.get(id);
    if (!el || seen.has(el.id)) continue;
    seen.add(el.id);
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
      image_src: el.type === 'image' ? el.src : null,
    });
    // Include GraphElements / EquationElements attached to a selected TextElement.
    if (el.type === 'text') {
      for (const other of elements) {
        if (
          (other.type === 'graph' || other.type === 'equation') &&
          other.association?.associatedElementId === el.id &&
          !seen.has(other.id)
        ) {
          seen.add(other.id);
          const g = extractElementContextContent(other);
          out.push({
            element_id: other.id,
            element_type: other.type,
            text: g.text,
            has_readable_content: g.has_readable_content,
            geometry: {
              x: other.x,
              y: other.y,
              width: other.width,
              height: other.height,
            },
            image_src: null,
          });
        }
      }
    }
    // Include TextElements attached to a selected GraphElement or EquationElement.
    if (el.type === 'graph' || el.type === 'equation') {
      for (const other of elements) {
        if (
          other.type === 'text' &&
          other.componentMeta?.associatedElementId === el.id &&
          !seen.has(other.id)
        ) {
          seen.add(other.id);
          const t = extractElementContextContent(other);
          out.push({
            element_id: other.id,
            element_type: other.type,
            text: t.text,
            has_readable_content: t.has_readable_content,
            geometry: {
              x: other.x,
              y: other.y,
              width: other.width,
              height: other.height,
            },
            image_src: null,
          });
        }
      }
    }
  }
  return out;
}

/** Snapshot current editor selection (stable copy). */
export function snapshotEditorSelection(selectedIds: readonly string[]): string[] {
  return [...selectedIds];
}
