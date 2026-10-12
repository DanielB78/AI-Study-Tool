/**
 * Automatic placement for textbook TextComponents.
 * Chooses positions from component type + associations — never from LLM coords.
 */

import type { Camera, CanvasElement, TextElement } from '../../types/canvas';
import { getElementBounds, rectsIntersect } from '../../utils/coordinates';
import { findFreeWorldPlacement } from '../ai/agent/placementService';
import {
  findNonOverlappingPlacement,
  placeAiTextRect,
  type Rect,
  type ViewportSize,
} from '../ai/canvas/placement';
import {
  COMPONENT_LAYOUT,
  getComponentType,
  measureTextComponent,
  TEXT_COMPONENT_STYLES,
  type TextComponentMeta,
  type TextComponentType,
} from './textComponents';
import type { RichTextDocument } from './richText';

export type ComponentPlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  associatedElementId?: string;
};

function asRect(el: CanvasElement): Rect {
  return getElementBounds(el);
}

function overlaps(candidate: Rect, elements: CanvasElement[]): boolean {
  return elements.some((el) => rectsIntersect(candidate, asRect(el)));
}

function tryPlace(
  preferred: Rect,
  obstacles: CanvasElement[],
  _camera: Camera,
  _viewport: ViewportSize,
): Rect {
  if (!overlaps(preferred, obstacles)) return preferred;
  return findFreeWorldPlacement(preferred, obstacles, 'both');
}

/** Stack auto-managed siblings vertically under an anchor. */
function stackBelow(
  anchor: Rect,
  size: { width: number; height: number },
  related: TextElement[],
  gap: number,
): Rect {
  let y = anchor.y + anchor.height + gap;
  for (const el of related) {
    if (el.componentMeta?.placementMode === 'manual') continue;
    const b = asRect(el);
    y = Math.max(y, b.y + b.height + gap);
  }
  return {
    x: anchor.x,
    y,
    width: size.width,
    height: size.height,
  };
}

function relatedAutoComponents(
  elements: CanvasElement[],
  associatedId: string,
): TextElement[] {
  return elements.filter(
    (el): el is TextElement =>
      el.type === 'text' &&
      el.id !== associatedId &&
      el.componentMeta?.associatedElementId === associatedId &&
      el.componentMeta?.placementMode !== 'manual',
  );
}

/**
 * Resolve world placement for a new textbook component.
 */
export function resolveComponentPlacement(opts: {
  componentType: TextComponentType;
  text: string;
  richText?: RichTextDocument;
  meta?: TextComponentMeta;
  associatedElement?: TextElement | null;
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
}): ComponentPlacementDecision {
  const preset = TEXT_COMPONENT_STYLES[opts.componentType];
  const assoc = opts.associatedElement ?? null;
  const widthHint =
    assoc && opts.componentType !== 'linked_comment' && opts.componentType !== 'title'
      ? assoc.width
      : preset.defaultWidth;
  const size = measureTextComponent({
    componentType: opts.componentType,
    text: opts.text,
    richText: opts.richText,
    meta: opts.meta,
    availableWidth:
      opts.componentType === 'title' && assoc
        ? Math.max(assoc.width, preset.defaultWidth)
        : widthHint,
  });

  const obstacles = opts.elements;

  // Title above associated main text
  if (opts.componentType === 'title' && assoc) {
    const preferred: Rect = {
      x: assoc.x,
      y: assoc.y - size.height - COMPONENT_LAYOUT.titleGap,
      width: Math.max(size.width, assoc.width * 0.6),
      height: size.height,
    };
    const placed = tryPlace(preferred, obstacles, opts.camera, opts.viewport);
    return {
      ...placed,
      width: size.width,
      height: size.height,
      reason: 'title_above_associated',
      associatedElementId: assoc.id,
    };
  }

  // Linked comment: prefer right of associated, then left, then below
  if (opts.componentType === 'linked_comment' && assoc) {
    const gap = COMPONENT_LAYOUT.sideGap;
    const candidates: Array<{ rect: Rect; reason: string }> = [
      {
        rect: {
          x: assoc.x + assoc.width + gap,
          y: assoc.y,
          width: size.width,
          height: size.height,
        },
        reason: 'comment_right_of_source',
      },
      {
        rect: {
          x: assoc.x - size.width - gap,
          y: assoc.y,
          width: size.width,
          height: size.height,
        },
        reason: 'comment_left_of_source',
      },
      {
        rect: {
          x: assoc.x,
          y: assoc.y + assoc.height + COMPONENT_LAYOUT.commentGap,
          width: size.width,
          height: size.height,
        },
        reason: 'comment_below_source',
      },
    ];
    for (const c of candidates) {
      if (!overlaps(c.rect, obstacles)) {
        return {
          ...c.rect,
          reason: c.reason,
          associatedElementId: assoc.id,
        };
      }
    }
    const placed = tryPlace(candidates[0]!.rect, obstacles, opts.camera, opts.viewport);
    return {
      ...placed,
      width: size.width,
      height: size.height,
      reason: 'comment_collision_nudge',
      associatedElementId: assoc.id,
    };
  }

  // Definition / example / warning / exercise — stack below associated main + siblings
  if (
    assoc &&
    (opts.componentType === 'definition' ||
      opts.componentType === 'example' ||
      opts.componentType === 'warning' ||
      opts.componentType === 'exercise' ||
      opts.componentType === 'main_text')
  ) {
    const related = relatedAutoComponents(obstacles, assoc.id);
    const preferred = stackBelow(
      asRect(assoc),
      size,
      related,
      COMPONENT_LAYOUT.stackGap,
    );
    // Align width with associated when sensible
    preferred.width = Math.max(size.width, Math.min(assoc.width, preset.defaultWidth + 40));
    const placed = tryPlace(preferred, obstacles, opts.camera, opts.viewport);
    return {
      x: placed.x,
      y: placed.y,
      width: size.width,
      height: size.height,
      reason: `${opts.componentType}_stack_below_associated`,
      associatedElementId: assoc.id,
    };
  }

  // Standalone / no association — viewport default with collision avoidance
  const placed = placeAiTextRect({
    width: size.width,
    height: size.height,
    camera: opts.camera,
    elements: obstacles,
    viewport: opts.viewport,
  });
  return {
    ...placed,
    reason: `${opts.componentType}_viewport_default`,
    associatedElementId: assoc?.id,
  };
}

/** When associated main text moves, shift auto-placed related components by delta. */
export function followAssociatedMove(
  elements: CanvasElement[],
  movedId: string,
  dx: number,
  dy: number,
): CanvasElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) => {
    if (el.type !== 'text') return el;
    if (el.componentMeta?.associatedElementId !== movedId) return el;
    if (el.componentMeta.placementMode === 'manual') return el;
    return { ...el, x: el.x + dx, y: el.y + dy };
  });
}

export function markManualPlacement(el: TextElement): TextElement {
  return {
    ...el,
    componentMeta: {
      ...(el.componentMeta ?? { placementMode: 'manual' }),
      placementMode: 'manual',
    },
  };
}

export function findAssociatedMain(
  elements: CanvasElement[],
  preferredId?: string | null,
): TextElement | null {
  if (preferredId) {
    const hit = elements.find((e) => e.id === preferredId && e.type === 'text');
    if (hit && hit.type === 'text') return hit;
  }
  const mains = elements.filter(
    (e): e is TextElement =>
      e.type === 'text' && getComponentType(e) === 'main_text',
  );
  return mains[0] ?? null;
}

/** Debug snapshot for RAG / AI debug panel. */
export function describePlacementDecision(
  decision: ComponentPlacementDecision,
  componentType: TextComponentType,
): Record<string, unknown> {
  return {
    componentType,
    placementMode: 'auto',
    reason: decision.reason,
    associatedElementId: decision.associatedElementId ?? null,
    resolvedPosition: { x: decision.x, y: decision.y },
    measuredBounds: { width: decision.width, height: decision.height },
  };
}

// Re-export for tests that want collision helpers
export { findNonOverlappingPlacement, overlaps as componentRectOverlaps };
