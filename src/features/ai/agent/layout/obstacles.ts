/**
 * Build obstacle rectangles for canvas placement.
 * Connectors are excluded — their long AABBs would block huge regions.
 * Handwriting regions are included when available.
 */

import type { CanvasElement } from '../../../../types/canvas';
import { getElementBounds } from '../../../../utils/coordinates';
import { handwritingRegionsAsSpatial } from '../../../rag/handwritingSync';
import { expandRect } from './collision';
import { GRID_LAYOUT_CONFIG } from './gridConfig';
import type { ObstacleRect } from './types';

const SKIP_TYPES = new Set(['connector']);

export function collectCanvasObstacles(
  elements: readonly CanvasElement[],
  options?: {
    includeHandwriting?: boolean;
    margin?: number;
    /** Extra obstacle rects (e.g. tests). */
    extra?: readonly ObstacleRect[];
  },
): ObstacleRect[] {
  const margin = options?.margin ?? GRID_LAYOUT_CONFIG.collisionMargin;
  const out: ObstacleRect[] = [];

  for (const el of elements) {
    if (SKIP_TYPES.has(el.type)) continue;
    const bounds = getElementBounds(el);
    if (bounds.width <= 0 || bounds.height <= 0) continue;
    const collision = expandRect(bounds, margin);
    out.push({
      ...collision,
      id: el.id,
      source: 'element',
      elementType: el.type,
    });
  }

  if (options?.includeHandwriting !== false) {
    try {
      for (const hw of handwritingRegionsAsSpatial()) {
        if (hw.width <= 0 || hw.height <= 0) continue;
        const collision = expandRect(
          { x: hw.x, y: hw.y, width: hw.width, height: hw.height },
          margin,
        );
        out.push({
          ...collision,
          id: hw.id,
          source: 'handwriting',
          elementType: 'handwriting_region',
        });
      }
    } catch {
      // Handwriting sync may be unavailable in isolated unit tests.
    }
  }

  if (options?.extra) {
    out.push(...options.extra);
  }

  return out;
}
