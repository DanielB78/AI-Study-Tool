/**
 * CanvasPlacementService — world-space placement for AI creates.
 *
 * New elements never push neighbours. Relative placement:
 * 1. Prefer the directed orientation around the anchor when free
 * 2. Otherwise try the other orientations around the same anchor
 * 3. If none fit, search free space away from existing elements
 */

import type { Camera, CanvasElement } from '../../../types/canvas';
import { getElementBounds, rectsIntersect } from '../../../utils/coordinates';
import {
  AI_TEXT_DEFAULT_WIDTH,
  getDefaultViewportSize,
  placeAiTextRect,
  type Rect,
  type ViewportSize,
} from '../canvas/placement';
import type { Placement, PlacementRelation } from './operations';
import { PLACEMENT_RELATIONS } from './operations';
import { spiralOffsets } from './layout/spiral';

/** Default gap between anchor edge and new note (world units). */
export const DEFAULT_ELEMENT_GAP = 48;

export interface PlacementRequest {
  placement: Placement;
  width: number;
  height: number;
  camera: Camera;
  elements: CanvasElement[];
  viewport?: ViewportSize;
  gap?: number;
}

/** Ordered orientation attempts for a requested relation (first = preferred). */
export const ORIENTATION_FALLBACKS: Record<
  PlacementRelation,
  readonly PlacementRelation[]
> = {
  below: ['below', 'right_of', 'left_of', 'above'],
  above: ['above', 'right_of', 'left_of', 'below'],
  right_of: ['right_of', 'below', 'above', 'left_of'],
  left_of: ['left_of', 'below', 'above', 'right_of'],
  near: ['right_of', 'below', 'left_of', 'above'],
};

export function preferredRelative(
  anchor: Rect,
  note: { width: number; height: number },
  relation: PlacementRelation,
  gap: number,
): Rect {
  const { width, height } = note;
  switch (relation) {
    case 'right_of':
      return { x: anchor.x + anchor.width + gap, y: anchor.y, width, height };
    case 'left_of':
      return { x: anchor.x - width - gap, y: anchor.y, width, height };
    case 'below':
      return { x: anchor.x, y: anchor.y + anchor.height + gap, width, height };
    case 'above':
      return { x: anchor.x, y: anchor.y - height - gap, width, height };
    case 'near':
      return { x: anchor.x + anchor.width + gap, y: anchor.y, width, height };
    default: {
      const _exhaustive: never = relation;
      return _exhaustive;
    }
  }
}

function overlapsAny(candidate: Rect, elements: CanvasElement[]): boolean {
  return elements.some((el) => rectsIntersect(candidate, getElementBounds(el)));
}

/**
 * Spiral-search for a free world rect starting at `preferred`.
 * Does not move existing elements — only relocates the candidate.
 */
export function findOpenSpaceAway(
  preferred: Rect,
  elements: CanvasElement[],
  options?: { step?: number; maxRings?: number },
): Rect {
  if (!overlapsAny(preferred, elements)) return preferred;

  const step = options?.step ?? Math.max(preferred.width, preferred.height, 64);
  const maxRings = options?.maxRings ?? 24;

  for (const { dx, dy } of spiralOffsets(step, maxRings)) {
    if (dx === 0 && dy === 0) continue;
    const candidate: Rect = {
      x: preferred.x + dx,
      y: preferred.y + dy,
      width: preferred.width,
      height: preferred.height,
    };
    if (!overlapsAny(candidate, elements)) {
      return candidate;
    }
  }

  // Last resort: park far below+right of the union of obstacles.
  let maxX = preferred.x;
  let maxY = preferred.y;
  for (const el of elements) {
    const b = getElementBounds(el);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return {
    x: maxX + DEFAULT_ELEMENT_GAP,
    y: maxY + DEFAULT_ELEMENT_GAP,
    width: preferred.width,
    height: preferred.height,
  };
}

/**
 * Compatibility wrapper used by equation/graph/component placers.
 * `@param _primaryAxis` is retained for call-site compatibility; search is
 * isotropic via spiral (creates never push neighbours).
 */
export function findFreeWorldPlacement(
  preferred: Rect,
  elements: CanvasElement[],
  _primaryAxis: 'x' | 'y' | 'both' = 'both',
): Rect {
  return findOpenSpaceAway(preferred, elements);
}

/**
 * Place a rect relative to an anchor: preferred orientation → other
 * orientations → free space away from existing elements. Never pushes.
 */
export function resolveRelativePlacement(input: {
  anchor: Rect;
  width: number;
  height: number;
  relation: PlacementRelation;
  elements: CanvasElement[];
  gap?: number;
}): Rect {
  const gap = input.gap ?? DEFAULT_ELEMENT_GAP;
  const note = { width: input.width, height: input.height };
  const order = ORIENTATION_FALLBACKS[input.relation] ?? [
    input.relation,
    ...PLACEMENT_RELATIONS.filter((r) => r !== input.relation && r !== 'near'),
  ];

  for (const rel of order) {
    const candidate = preferredRelative(input.anchor, note, rel, gap);
    if (!overlapsAny(candidate, input.elements)) {
      return candidate;
    }
  }

  const preferred = preferredRelative(
    input.anchor,
    note,
    input.relation,
    gap,
  );
  return findOpenSpaceAway(preferred, input.elements);
}

/**
 * Resolve world-space origin+size for a create placement.
 * Creates never displace neighbours — they relocate themselves instead.
 */
export function resolvePlacement(request: PlacementRequest): Rect {
  const viewport = request.viewport ?? getDefaultViewportSize();
  const gap = request.gap ?? DEFAULT_ELEMENT_GAP;
  const { width, height } = request;
  const placement = request.placement;

  if (placement.mode === 'viewport_default') {
    return placeAiTextRect({
      camera: request.camera,
      viewport,
      elements: request.elements,
      width,
      height,
    });
  }

  if (placement.mode === 'absolute') {
    const preferred: Rect = {
      x: placement.x,
      y: placement.y,
      width,
      height,
    };
    return findOpenSpaceAway(preferred, request.elements);
  }

  // relative_to_element
  const anchorEl = request.elements.find(
    (el) => el.id === placement.anchor_element_id,
  );
  if (!anchorEl) {
    return placeAiTextRect({
      camera: request.camera,
      viewport,
      elements: request.elements,
      width,
      height,
    });
  }

  return resolveRelativePlacement({
    anchor: getElementBounds(anchorEl),
    width,
    height,
    relation: placement.relation,
    elements: request.elements,
    gap,
  });
}

export { AI_TEXT_DEFAULT_WIDTH };
