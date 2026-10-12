/**
 * CanvasRegionContextService — classify a world-coordinate marquee region for LLM context.
 *
 * Cases:
 *   empty          → no image, no region context
 *   structured_only → TextElements (etc.) via structured context; no raster
 *   visual          → structured elements + region image attachment
 *
 * Pure inspection — no rendering, no CanvasDocument mutation.
 */

import type { CanvasElement, CanvasElementType } from '../../types/canvas';
import { rectsIntersect } from '../../utils/coordinates';
import type { WorldRect } from './geometry';
import {
  extractElementContextContent,
  type ExplicitSelectionInput,
} from './explicitSelection';

/**
 * Element types whose structured CanvasDocument representation is sufficient
 * without a region screenshot. Extensible — later: equation, graph, …
 */
export const STRUCTURED_WITHOUT_IMAGE: ReadonlySet<CanvasElementType> = new Set([
  'text',
]);

export type RegionContextKind = 'empty' | 'structured_only' | 'visual';

export interface CanvasRegionInspection {
  bounds: WorldRect;
  kind: RegionContextKind;
  /** All elements whose geometry intersects the region. */
  intersectingElementIds: string[];
  /** Structured-sufficient elements (e.g. textboxes) intersecting the region. */
  structuredElementIds: string[];
  /** Elements that count as unstructured / visual content. */
  visualElementIds: string[];
  /** True when any meaningful unstructured visual content intersects. */
  hasVisualContent: boolean;
  /** True when nothing meaningful is inside the region. */
  isEmpty: boolean;
  /** Whether a region raster should be produced. */
  shouldRenderImage: boolean;
  /** Structured context inputs for intersecting structured elements (live text). */
  structuredSelections: ExplicitSelectionInput[];
}

export interface ExplicitRegionSelectionSnapshot {
  bounds: WorldRect;
  structuredElementIds: string[];
  visualElementIds: string[];
  intersectingElementIds: string[];
  hasVisualContent: boolean;
  imageAttachmentCreated: boolean;
  kind: RegionContextKind;
}

/** True when this element type is considered fully representable without a screenshot. */
export function isStructuredWithoutImage(type: CanvasElementType): boolean {
  return STRUCTURED_WITHOUT_IMAGE.has(type);
}

/** True when the element's presence should trigger region-image generation. */
export function isVisualUnstructuredContent(el: CanvasElement): boolean {
  if (isStructuredWithoutImage(el.type)) return false;
  // Connectors / drawings / images / shapes / equations / graphs all count as visual
  // for the first implementation (only text is optimized away from screenshots).
  if (el.type === 'drawing') {
    return el.points.length >= 4;
  }
  if (el.type === 'image') {
    return Boolean(el.src);
  }
  if (el.type === 'connector') {
    return el.points.length >= 4;
  }
  // shape / equation / graph / unknown
  return true;
}

/** Meaningful content for empty-region detection (ignore chrome / empty marks). */
export function hasMeaningfulContent(el: CanvasElement): boolean {
  if (el.type === 'text') {
    // Empty textboxes still count as structured content when present, but a region
    // containing only zero-size / missing elements is empty. A textbox with bounds
    // is meaningful even if the text is blank (user selected it).
    return el.width > 0 && el.height > 0;
  }
  if (el.type === 'drawing') {
    return el.points.length >= 4 && (el.width > 0 || el.height > 0 || el.strokeWidth > 0);
  }
  if (el.type === 'connector') {
    return el.points.length >= 4;
  }
  if (el.type === 'image') {
    return Boolean(el.src) && el.width > 0 && el.height > 0;
  }
  return el.width > 0 && el.height > 0;
}

export function elementWorldBounds(el: CanvasElement): WorldRect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

export function elementsIntersectingRegion(
  elements: readonly CanvasElement[],
  bounds: WorldRect,
): CanvasElement[] {
  if (bounds.width <= 0 || bounds.height <= 0) return [];
  return elements.filter((el) => rectsIntersect(bounds, elementWorldBounds(el)));
}

/**
 * Inspect a world-coordinate selection region against the current CanvasDocument.
 */
export function inspectCanvasRegion(
  elements: readonly CanvasElement[],
  bounds: WorldRect,
): CanvasRegionInspection {
  const intersecting = elementsIntersectingRegion(elements, bounds).filter(
    hasMeaningfulContent,
  );

  const structured: CanvasElement[] = [];
  const visual: CanvasElement[] = [];

  for (const el of intersecting) {
    if (isVisualUnstructuredContent(el)) {
      visual.push(el);
    } else if (isStructuredWithoutImage(el.type)) {
      structured.push(el);
    }
  }

  const isEmpty = intersecting.length === 0;
  const hasVisualContent = visual.length > 0;
  const shouldRenderImage = hasVisualContent;

  let kind: RegionContextKind;
  if (isEmpty) kind = 'empty';
  else if (hasVisualContent) kind = 'visual';
  else kind = 'structured_only';

  const structuredSelections: ExplicitSelectionInput[] = structured.map((el) => {
    const { text, has_readable_content } = extractElementContextContent(el);
    return {
      element_id: el.id,
      element_type: el.type,
      text,
      has_readable_content,
      geometry: elementWorldBounds(el),
      image_src: el.type === 'image' ? el.src : null,
    };
  });

  return {
    bounds: { ...bounds },
    kind,
    intersectingElementIds: intersecting.map((el) => el.id),
    structuredElementIds: structured.map((el) => el.id),
    visualElementIds: visual.map((el) => el.id),
    hasVisualContent,
    isEmpty,
    shouldRenderImage,
    structuredSelections,
  };
}

/** Snapshot shape for debug JSON / Manual mode. */
export function toExplicitRegionSelectionSnapshot(
  inspection: CanvasRegionInspection,
  imageAttachmentCreated: boolean,
): ExplicitRegionSelectionSnapshot {
  return {
    bounds: { ...inspection.bounds },
    structuredElementIds: [...inspection.structuredElementIds],
    visualElementIds: [...inspection.visualElementIds],
    intersectingElementIds: [...inspection.intersectingElementIds],
    hasVisualContent: inspection.hasVisualContent,
    imageAttachmentCreated,
    kind: inspection.kind,
  };
}

/** Synthetic attachment id for a selected region (stable for a given bounds). */
export function regionAttachmentId(bounds: WorldRect): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return `region:${r(bounds.x)},${r(bounds.y)},${r(bounds.width)},${r(bounds.height)}`;
}
