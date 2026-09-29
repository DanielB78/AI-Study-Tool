/**
 * CanvasPlacementService — world-space placement for AI create_text.
 * Uses viewport / relative / absolute modes with light collision avoidance.
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

const RELATIVE_OFFSET_FACTORS: Array<[number, number]> = [
  [0, 0],
  [0, 0.35],
  [0, -0.35],
  [0, 0.7],
  [0, -0.7],
  [0.35, 0],
  [-0.35, 0],
  [0.7, 0],
  [-0.7, 0],
  [0.5, 0.5],
  [-0.5, 0.5],
];

function preferredRelative(
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
      // Prefer right-of; collision helper tries alternate offsets.
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
 * World-space collision nudge for relative/absolute placement.
 * Does NOT clamp into the camera viewport — logical board relationships stay stable.
 */
export function findFreeWorldPlacement(
  preferred: Rect,
  elements: CanvasElement[],
  primaryAxis: 'x' | 'y' | 'both' = 'both',
): Rect {
  // Prefer sliding along the secondary axis first for directional relations.
  const ordered =
    primaryAxis === 'y'
      ? [...RELATIVE_OFFSET_FACTORS].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))
      : primaryAxis === 'x'
        ? [...RELATIVE_OFFSET_FACTORS].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))
        : RELATIVE_OFFSET_FACTORS;

  for (const [fx, fy] of ordered) {
    const candidate: Rect = {
      x: preferred.x + fx * preferred.width,
      y: preferred.y + fy * preferred.height,
      width: preferred.width,
      height: preferred.height,
    };
    if (!overlapsAny(candidate, elements)) {
      return candidate;
    }
  }

  // Last resort: push further along the preferred direction.
  const push: Rect = {
    x: preferred.x + (primaryAxis === 'y' ? 0 : preferred.width + DEFAULT_ELEMENT_GAP),
    y: preferred.y + (primaryAxis === 'x' ? 0 : preferred.height + DEFAULT_ELEMENT_GAP),
    width: preferred.width,
    height: preferred.height,
  };
  if (!overlapsAny(push, elements)) return push;
  return preferred;
}

function primaryAxisForRelation(relation: PlacementRelation): 'x' | 'y' | 'both' {
  if (relation === 'left_of' || relation === 'right_of') return 'y';
  if (relation === 'above' || relation === 'below') return 'x';
  return 'both';
}

/**
 * Resolve world-space origin+size for a create_text placement.
 * Never uses screen pixels for relative math — world coordinates only.
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
    // Absolute coords are user-specified world positions — avoid viewport clamp.
    return findFreeWorldPlacement(preferred, request.elements, 'both');
  }

  // relative_to_element
  const anchorId = placement.anchor_element_id;
  const anchorEl = anchorId
    ? request.elements.find((el) => el.id === anchorId)
    : undefined;
  if (!anchorEl) {
    // Fallback to viewport if anchor vanished between plan and apply.
    return placeAiTextRect({
      camera: request.camera,
      viewport,
      elements: request.elements,
      width,
      height,
    });
  }

  const anchor = getElementBounds(anchorEl);
  const preferred = preferredRelative(
    anchor,
    { width, height },
    placement.relation,
    gap,
  );
  return findFreeWorldPlacement(
    preferred,
    request.elements,
    primaryAxisForRelation(placement.relation),
  );
}

export { AI_TEXT_DEFAULT_WIDTH };
