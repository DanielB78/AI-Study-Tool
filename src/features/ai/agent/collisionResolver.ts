/**
 * Cascade collision resolver for AI-generated canvas content.
 *
 * Generated/updated elements are treated as fixed anchors. Existing unlocked
 * elements that overlap them are pushed away along the dominant collision side
 * (the axis with the larger overlap extent; sign from centre comparison).
 * If that move causes a new overlap, the newly overlapping element is pushed
 * too, and so on.
 */

import type { CanvasElement } from '../../../types/canvas';
import { getElementBounds } from '../../../utils/coordinates';
import type { Rect } from '../canvas/placement';
import { DEFAULT_ELEMENT_GAP } from './placementService';
import { expandRect, intersectsWithMargin } from './layout/collision';
import { GRID_LAYOUT_CONFIG } from './layout/gridConfig';

export type CollisionSide = 'left' | 'right' | 'above' | 'below';

export type CollisionPush = {
  side: CollisionSide;
  dx: number;
  dy: number;
  /** Overlap width / height used to choose the dominant axis. */
  overlapWidth: number;
  overlapHeight: number;
};

export type CascadeCollisionResult = {
  /** Element ids that were translated. */
  movedIds: string[];
  /** Per-id total translation applied. */
  deltas: Map<string, { dx: number; dy: number }>;
  iterations: number;
  resolved: boolean;
};

export type CascadeCollisionOptions = {
  /** Extra margin around rects when testing overlap (world units). */
  margin?: number;
  /** Clearance gap after separation (world units). */
  gap?: number;
  /** Safety cap on cascade iterations. */
  maxIterations?: number;
};

function boundsOf(el: CanvasElement): Rect {
  return getElementBounds(el);
}

function overlapExtent(a: Rect, b: Rect): { width: number; height: number } {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * Compute how to move `movable` so it clears `fixed`.
 *
 * 1. Choose axis by which overlap extent is larger (most of the collision):
 *    - wider overlap → vertical conflict (stacked) → move up/down
 *    - taller overlap → horizontal conflict (side-by-side) → move left/right
 * 2. Choose sign from where the overlap sits on the movable element:
 *    - overlap in the top half → collision from above → move down
 *    - overlap in the bottom half → move up
 *    - overlap in the left half → move right
 *    - overlap in the right half → move left
 */
export function dominantCollisionPush(
  fixed: Rect,
  movable: Rect,
  gap: number = DEFAULT_ELEMENT_GAP,
): CollisionPush | null {
  const { width: overlapW, height: overlapH } = overlapExtent(fixed, movable);
  if (overlapW <= 0 || overlapH <= 0) return null;

  const overlapLeft = Math.max(fixed.x, movable.x);
  const overlapRight = Math.min(fixed.x + fixed.width, movable.x + movable.width);
  const overlapTop = Math.max(fixed.y, movable.y);
  const overlapBottom = Math.min(
    fixed.y + fixed.height,
    movable.y + movable.height,
  );
  const overlapCx = (overlapLeft + overlapRight) / 2;
  const overlapCy = (overlapTop + overlapBottom) / 2;
  const movableCx = movable.x + movable.width / 2;
  const movableCy = movable.y + movable.height / 2;

  let side: CollisionSide;
  if (overlapW >= overlapH) {
    // Mostly a vertical stack — resolve up/down.
    side = overlapCy <= movableCy ? 'below' : 'above';
  } else {
    // Mostly side-by-side — resolve left/right.
    side = overlapCx <= movableCx ? 'right' : 'left';
  }

  switch (side) {
    case 'below': {
      const dy = fixed.y + fixed.height + gap - movable.y;
      return {
        side,
        dx: 0,
        dy: Math.max(dy, gap),
        overlapWidth: overlapW,
        overlapHeight: overlapH,
      };
    }
    case 'above': {
      const dy = -(movable.y + movable.height + gap - fixed.y);
      return {
        side,
        dx: 0,
        dy: Math.min(dy, -gap),
        overlapWidth: overlapW,
        overlapHeight: overlapH,
      };
    }
    case 'right': {
      const dx = fixed.x + fixed.width + gap - movable.x;
      return {
        side,
        dx: Math.max(dx, gap),
        dy: 0,
        overlapWidth: overlapW,
        overlapHeight: overlapH,
      };
    }
    case 'left': {
      const dx = -(movable.x + movable.width + gap - fixed.x);
      return {
        side,
        dx: Math.min(dx, -gap),
        dy: 0,
        overlapWidth: overlapW,
        overlapHeight: overlapH,
      };
    }
  }
}

export type CollisionResolveTarget = {
  getElements: () => readonly CanvasElement[];
  updateElement: (
    id: string,
    updater: (el: CanvasElement) => CanvasElement,
  ) => void;
};

function isMovable(el: CanvasElement, anchorIds: ReadonlySet<string>): boolean {
  if (anchorIds.has(el.id)) return false;
  if (el.locked) return false;
  return true;
}

/**
 * Resolve overlaps caused by `anchorIds` (typically just-created / updated
 * elements). Anchors stay fixed; other unlocked elements are pushed away on the
 * dominant collision side, cascading until clear or the iteration cap.
 */
export function resolveCascadeCollisions(
  target: CollisionResolveTarget,
  anchorIds: ReadonlySet<string>,
  options?: CascadeCollisionOptions,
): CascadeCollisionResult {
  const margin =
    options?.margin ?? GRID_LAYOUT_CONFIG.collisionMargin;
  const gap = options?.gap ?? DEFAULT_ELEMENT_GAP;
  const maxIterations = options?.maxIterations ?? 64;

  const deltas = new Map<string, { dx: number; dy: number }>();
  let iterations = 0;
  let resolved = false;

  if (anchorIds.size === 0) {
    return { movedIds: [], deltas, iterations: 0, resolved: true };
  }

  for (iterations = 1; iterations <= maxIterations; iterations++) {
    const elements = target.getElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    let movedThisPass = false;

    // 1) Push non-anchors away from anchors.
    for (const anchorId of anchorIds) {
      const anchor = byId.get(anchorId);
      if (!anchor) continue;
      const aBounds = expandRect(boundsOf(anchor), margin);

      for (const el of elements) {
        if (!isMovable(el, anchorIds)) continue;
        const bBounds = boundsOf(el);
        if (!intersectsWithMargin(aBounds, bBounds, 0)) continue;

        const push = dominantCollisionPush(boundsOf(anchor), bBounds, gap);
        if (!push || (push.dx === 0 && push.dy === 0)) continue;

        target.updateElement(el.id, (cur) => ({
          ...cur,
          x: cur.x + push.dx,
          y: cur.y + push.dy,
        }));
        const prev = deltas.get(el.id) ?? { dx: 0, dy: 0 };
        deltas.set(el.id, {
          dx: prev.dx + push.dx,
          dy: prev.dy + push.dy,
        });
        movedThisPass = true;
        // Refresh local snapshot for subsequent checks in this pass.
        const updated = target.getElements().find((e) => e.id === el.id);
        if (updated) byId.set(el.id, updated);
      }
    }

    // 2) Cascade: if two non-anchors now overlap, push the later one (higher y,
    // then higher zIndex, then id) away from the earlier one.
    const movable = target
      .getElements()
      .filter((el) => isMovable(el, anchorIds))
      .slice()
      .sort(
        (a, b) =>
          a.y - b.y || a.zIndex - b.zIndex || a.id.localeCompare(b.id),
      );

    for (let i = 0; i < movable.length; i++) {
      const fixedEl = movable[i]!;
      // Use live bounds (may have been moved in step 1 or earlier in step 2).
      const liveFixed =
        target.getElements().find((e) => e.id === fixedEl.id) ?? fixedEl;
      const fixedBounds = expandRect(boundsOf(liveFixed), margin);

      for (let j = i + 1; j < movable.length; j++) {
        const other = movable[j]!;
        const liveOther =
          target.getElements().find((e) => e.id === other.id) ?? other;
        if (!intersectsWithMargin(fixedBounds, boundsOf(liveOther), 0)) {
          continue;
        }
        const push = dominantCollisionPush(
          boundsOf(liveFixed),
          boundsOf(liveOther),
          gap,
        );
        if (!push || (push.dx === 0 && push.dy === 0)) continue;

        target.updateElement(other.id, (cur) => ({
          ...cur,
          x: cur.x + push.dx,
          y: cur.y + push.dy,
        }));
        const prev = deltas.get(other.id) ?? { dx: 0, dy: 0 };
        deltas.set(other.id, {
          dx: prev.dx + push.dx,
          dy: prev.dy + push.dy,
        });
        movedThisPass = true;
        movable[j] = {
          ...liveOther,
          x: liveOther.x + push.dx,
          y: liveOther.y + push.dy,
        };
      }
    }

    if (!movedThisPass) {
      resolved = true;
      break;
    }
  }

  if (!resolved) {
    // Final check — may still be unresolved at cap.
    resolved = !hasAnchorCollisions(target, anchorIds, margin);
  }

  return {
    movedIds: [...deltas.keys()],
    deltas,
    iterations,
    resolved,
  };
}

function hasAnchorCollisions(
  target: CollisionResolveTarget,
  anchorIds: ReadonlySet<string>,
  margin: number,
): boolean {
  const elements = target.getElements();
  for (const anchorId of anchorIds) {
    const anchor = elements.find((e) => e.id === anchorId);
    if (!anchor) continue;
    const a = expandRect(boundsOf(anchor), margin);
    for (const el of elements) {
      if (!isMovable(el, anchorIds)) continue;
      if (intersectsWithMargin(a, boundsOf(el), 0)) return true;
    }
  }
  return false;
}
