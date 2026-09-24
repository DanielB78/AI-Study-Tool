import type { Camera, CanvasElement } from '../../../types/canvas';
import { getElementBounds, rectsIntersect, screenToWorld } from '../../../utils/coordinates';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/** Default AI note width in world units (medium card, not full-line). */
export const AI_TEXT_DEFAULT_WIDTH = 360;

/** Keep notes clear of the floating prompt near the bottom. */
const PROMPT_CLEARANCE_SCREEN_PX = 140;

const COLLISION_OFFSET_FACTORS: Array<[number, number]> = [
  [0, 0],
  [1.05, 0],
  [0, 1.05],
  [-1.05, 0],
  [0, -1.05],
  [1.1, 1.1],
  [-1.1, 1.1],
  [0.5, -1.2],
];

export function getVisibleWorldBounds(camera: Camera, viewport: ViewportSize): Rect {
  const x = (0 - camera.x) / camera.zoom;
  const y = (0 - camera.y) / camera.zoom;
  return {
    x,
    y,
    width: viewport.width / camera.zoom,
    height: viewport.height / camera.zoom,
  };
}

/**
 * Prefer the visible viewport centre, raised so the note is not under the Ask AI bar.
 */
export function preferredAiTextOrigin(
  camera: Camera,
  viewport: ViewportSize,
  noteWidth: number,
  noteHeight: number,
): { x: number; y: number } {
  const screenCentre = {
    x: viewport.width / 2,
    y: Math.max(viewport.height / 2 - PROMPT_CLEARANCE_SCREEN_PX / 2, viewport.height * 0.32),
  };
  const world = screenToWorld(screenCentre, camera);
  return {
    x: world.x - noteWidth / 2,
    y: world.y - noteHeight / 2,
  };
}

export function clampRectToVisible(
  rect: Rect,
  camera: Camera,
  viewport: ViewportSize,
  margin = 16,
): Rect {
  const visible = getVisibleWorldBounds(camera, viewport);
  const pad = margin / camera.zoom;
  const maxX = visible.x + visible.width - rect.width - pad;
  const maxY = visible.y + visible.height - rect.height - pad;
  const minX = visible.x + pad;
  const minY = visible.y + pad;

  return {
    ...rect,
    x: Math.min(Math.max(rect.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(rect.y, minY), Math.max(minY, maxY)),
  };
}

export function overlapsAny(candidate: Rect, elements: CanvasElement[]): boolean {
  return elements.some((el) => rectsIntersect(candidate, getElementBounds(el)));
}

/**
 * Lightweight collision avoidance: try a few offsets, else keep the preferred spot.
 */
export function findNonOverlappingPlacement(
  preferred: Rect,
  elements: CanvasElement[],
  camera: Camera,
  viewport: ViewportSize,
): Rect {
  for (const [fx, fy] of COLLISION_OFFSET_FACTORS) {
    const candidate = clampRectToVisible(
      {
        x: preferred.x + fx * preferred.width,
        y: preferred.y + fy * preferred.height,
        width: preferred.width,
        height: preferred.height,
      },
      camera,
      viewport,
    );
    if (!overlapsAny(candidate, elements)) {
      return candidate;
    }
  }
  return clampRectToVisible(preferred, camera, viewport);
}

export function placeAiTextRect(options: {
  camera: Camera;
  viewport: ViewportSize;
  elements: CanvasElement[];
  width: number;
  height: number;
}): Rect {
  const origin = preferredAiTextOrigin(
    options.camera,
    options.viewport,
    options.width,
    options.height,
  );
  const preferred: Rect = {
    x: origin.x,
    y: origin.y,
    width: options.width,
    height: options.height,
  };
  return findNonOverlappingPlacement(
    preferred,
    options.elements,
    options.camera,
    options.viewport,
  );
}

export function getDefaultViewportSize(): ViewportSize {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}
