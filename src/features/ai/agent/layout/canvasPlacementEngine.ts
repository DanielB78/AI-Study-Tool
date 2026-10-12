/**
 * CanvasPlacementEngine — translate a finished local grid to a free world origin.
 * Moves the entire arrangement together; never scatters items.
 */

import type { Camera, CanvasElement } from '../../../../types/canvas';
import type { Placement } from '../operations';
import {
  getDefaultViewportSize,
  preferredAiTextOrigin,
  type Rect,
  type ViewportSize,
} from '../../canvas/placement';
import { resolvePlacement } from '../placementService';
import { collidesAny, translateRect } from './collision';
import { GRID_LAYOUT_CONFIG, type GridLayoutConfig } from './gridConfig';
import type { CanvasPlacementResult, GridLayoutResult, ObstacleRect } from './types';

/** Deterministic expanding rectangular spiral of candidate offsets. */
export function* spiralOffsets(
  step: number,
  maxRings: number,
): Generator<{ dx: number; dy: number }> {
  yield { dx: 0, dy: 0 };
  for (let ring = 1; ring <= maxRings; ring++) {
    const s = step * ring;
    // right edge (bottom→top excluding corners handled on other edges)
    for (let i = -ring; i <= ring; i++) yield { dx: s, dy: step * i };
    // top edge
    for (let i = ring - 1; i >= -ring; i--) yield { dx: step * i, dy: -s };
    // left edge
    for (let i = -ring + 1; i <= ring; i++) yield { dx: -s, dy: step * i };
    // bottom edge
    for (let i = ring - 1; i >= -ring + 1; i--) yield { dx: step * i, dy: s };
  }
}

function preferredGroupOrigin(input: {
  placement: Placement;
  bounds: Rect;
  camera: Camera;
  elements: CanvasElement[];
  viewport: ViewportSize;
}): { x: number; y: number } {
  if (input.placement.mode === 'viewport_default') {
    return preferredAiTextOrigin(
      input.camera,
      input.viewport,
      input.bounds.width,
      input.bounds.height,
    );
  }
  // Reuse single-element placement resolver for relative/absolute group anchors.
  const placed = resolvePlacement({
    placement: input.placement,
    width: input.bounds.width,
    height: input.bounds.height,
    camera: input.camera,
    elements: input.elements,
    viewport: input.viewport,
  });
  return { x: placed.x, y: placed.y };
}

export function placeGridOnCanvas(input: {
  grid: GridLayoutResult;
  placement: Placement;
  camera: Camera;
  elements: CanvasElement[];
  obstacles: readonly ObstacleRect[];
  viewport?: ViewportSize;
  config?: GridLayoutConfig;
}): CanvasPlacementResult {
  const config = input.config ?? GRID_LAYOUT_CONFIG;
  const viewport = input.viewport ?? getDefaultViewportSize();
  const preferredOrigin = preferredGroupOrigin({
    placement: input.placement,
    bounds: input.grid.bounds,
    camera: input.camera,
    elements: input.elements,
    viewport,
  });

  const obstacleRects: Rect[] = input.obstacles.map((o) => ({
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
  }));

  // Obstacles already include collision margin; test group content bounds translated.
  // Use content collision rects (already expanded in local space) for precision.
  let candidatesTested = 0;
  let collidedAtPreferred = false;
  let chosen: { x: number; y: number } | null = null;

  for (const { dx, dy } of spiralOffsets(
    config.searchStep,
    config.maxSearchRings,
  )) {
    if (candidatesTested >= config.maxPlacementCandidates) break;
    candidatesTested += 1;
    const origin = {
      x: preferredOrigin.x + dx,
      y: preferredOrigin.y + dy,
    };
    const worldCollisions = input.grid.items.map((item) =>
      translateRect(item.collision, origin.x, origin.y),
    );
    const groupBounds = translateRect(input.grid.bounds, origin.x, origin.y);

    const hitObstacle =
      collidesAny(groupBounds, obstacleRects, 0) ||
      worldCollisions.some((r) => collidesAny(r, obstacleRects, 0));

    // Also ensure generated items don't collide with each other after translate
    // (they shouldn't if local layout was valid — cheap sanity check).
    let hitSelf = false;
    for (let i = 0; i < worldCollisions.length && !hitSelf; i++) {
      for (let j = i + 1; j < worldCollisions.length; j++) {
        if (collidesAny(worldCollisions[i]!, [worldCollisions[j]!], 0)) {
          hitSelf = true;
          break;
        }
      }
    }

    if (candidatesTested === 1) {
      collidedAtPreferred = hitObstacle || hitSelf;
    }

    if (!hitObstacle && !hitSelf) {
      chosen = origin;
      break;
    }
  }

  if (!chosen) {
    throw new Error(
      `No collision-free placement found after ${candidatesTested} candidates. Clear space near the viewport or reduce the layout size.`,
    );
  }

  const worldItems = input.grid.items.map((item) => ({
    ...item,
    worldX: item.localX + chosen!.x,
    worldY: item.localY + chosen!.y,
    worldCollision: translateRect(item.collision, chosen!.x, chosen!.y),
  }));

  return {
    origin: chosen,
    preferredOrigin,
    candidatesTested,
    collidedAtPreferred,
    worldItems,
    worldBounds: translateRect(input.grid.bounds, chosen.x, chosen.y),
  };
}
