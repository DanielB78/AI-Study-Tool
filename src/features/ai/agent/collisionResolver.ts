/**
 * Cascade collision resolver for AI **edits** (not new creates).
 *
 * Updated elements are fixed anchors. Existing unlocked elements that overlap
 * them are pushed away along the dominant collision side. If that move causes
 * a new overlap, the newly overlapping element is pushed too.
 *
 * If more than `maxMovedElements` would need to move, all pushes are reverted
 * and the edit is left overlapping (collision ignored).
 *
 * New creates must NOT use this path — they resolve placement by trying
 * alternate orientations / free space without moving neighbours.
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
  overlapWidth: number;
  overlapHeight: number;
};

export type CascadeCollisionResult = {
  movedIds: string[];
  deltas: Map<string, { dx: number; dy: number }>;
  iterations: number;
  resolved: boolean;
  /** True when too many neighbours would move — pushes were reverted. */
  skipped: boolean;
  skipReason?: 'too_many_moves' | 'no_anchors';
};

/** Default cap: if more neighbours than this need moving, ignore collisions. */
export const DEFAULT_MAX_MOVED_FOR_EDIT = 4;

export type CascadeCollisionOptions = {
  margin?: number;
  gap?: number;
  maxIterations?: number;
  /**
   * If cascade would move more than this many distinct elements, revert all
   * moves and leave the edited content overlapping. Defaults to
   * DEFAULT_MAX_MOVED_FOR_EDIT.
   */
  maxMovedElements?: number;
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
 * Axis = larger overlap extent. Sign = which half of the movable the overlap
 * sits in (top → down, bottom → up, left → right, right → left).
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
    side = overlapCy <= movableCy ? 'below' : 'above';
  } else {
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

function revertDeltas(
  target: CollisionResolveTarget,
  deltas: Map<string, { dx: number; dy: number }>,
): void {
  for (const [id, d] of deltas) {
    target.updateElement(id, (cur) => ({
      ...cur,
      x: cur.x - d.dx,
      y: cur.y - d.dy,
    }));
  }
}

/**
 * Resolve overlaps caused by **edited** anchors only.
 * Returns `skipped: true` (and moves nothing) when too many neighbours would move.
 */
export function resolveCascadeCollisions(
  target: CollisionResolveTarget,
  anchorIds: ReadonlySet<string>,
  options?: CascadeCollisionOptions,
): CascadeCollisionResult {
  const margin = options?.margin ?? GRID_LAYOUT_CONFIG.collisionMargin;
  const gap = options?.gap ?? DEFAULT_ELEMENT_GAP;
  const maxIterations = options?.maxIterations ?? 64;
  const maxMoved =
    options?.maxMovedElements ?? DEFAULT_MAX_MOVED_FOR_EDIT;

  const deltas = new Map<string, { dx: number; dy: number }>();
  let iterations = 0;
  let resolved = false;

  if (anchorIds.size === 0) {
    return {
      movedIds: [],
      deltas,
      iterations: 0,
      resolved: true,
      skipped: true,
      skipReason: 'no_anchors',
    };
  }

  for (iterations = 1; iterations <= maxIterations; iterations++) {
    const elements = target.getElements();
    const byId = new Map(elements.map((el) => [el.id, el]));
    let movedThisPass = false;

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
        const updated = target.getElements().find((e) => e.id === el.id);
        if (updated) byId.set(el.id, updated);

        if (deltas.size > maxMoved) {
          revertDeltas(target, deltas);
          return {
            movedIds: [],
            deltas: new Map(),
            iterations,
            resolved: false,
            skipped: true,
            skipReason: 'too_many_moves',
          };
        }
      }
    }

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

        if (deltas.size > maxMoved) {
          revertDeltas(target, deltas);
          return {
            movedIds: [],
            deltas: new Map(),
            iterations,
            resolved: false,
            skipped: true,
            skipReason: 'too_many_moves',
          };
        }
      }
    }

    if (!movedThisPass) {
      resolved = true;
      break;
    }
  }

  if (!resolved) {
    resolved = !hasAnchorCollisions(target, anchorIds, margin);
  }

  return {
    movedIds: [...deltas.keys()],
    deltas,
    iterations,
    resolved,
    skipped: false,
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
