/**
 * Render handwriting strokes (lines / regions) to PNG data URLs for TrOCR / LLM.
 * Strokes only — no UI chrome, textboxes, or debug overlays.
 */

import Konva from 'konva';
import type { CanvasDocument, CanvasElement, DrawingElement } from '../../types/canvas';
import { strokeDashFor } from '../../types/canvas';
import type { WorldRect } from './geometry';
import { expandRect } from './geometry';
import {
  REGION_CONTEXT_BACKGROUND,
  computeRegionRenderSize,
} from './regionRenderer';
import {
  REGION_CONTEXT_MAX_DIMENSION,
  REGION_CONTEXT_MIN_DIMENSION,
  REGION_CONTEXT_RENDER_SCALE,
} from './config';

export interface HandwritingRenderOptions {
  scale?: number;
  maxDimension?: number;
  minDimension?: number;
  /** World-unit padding (already normalized by caller). */
  paddingWorld?: number;
  background?: string;
}

export interface HandwritingRenderResult {
  dataUrl: string;
  width: number;
  height: number;
  worldBounds: WorldRect;
  mimeType: 'image/png';
}

function drawingsById(
  elements: readonly CanvasElement[],
): Map<string, DrawingElement> {
  const map = new Map<string, DrawingElement>();
  for (const el of elements) {
    if (el.type === 'drawing') map.set(el.id, el);
  }
  return map;
}

/**
 * Render only the given stroke IDs clipped to worldBounds.
 */
export async function renderHandwritingStrokes(
  canvasDoc: Pick<CanvasDocument, 'elements'>,
  strokeIds: readonly string[],
  worldBounds: WorldRect,
  options?: HandwritingRenderOptions,
): Promise<HandwritingRenderResult> {
  if (typeof window === 'undefined' || typeof window.document === 'undefined') {
    throw new Error('Handwriting renderer requires a DOM');
  }

  const pad = Math.max(0, options?.paddingWorld ?? 0);
  const bounds = pad > 0 ? expandRect(worldBounds, pad) : { ...worldBounds };

  const size = computeRegionRenderSize(bounds.width, bounds.height, {
    scale: options?.scale ?? REGION_CONTEXT_RENDER_SCALE,
    maxDimension: options?.maxDimension ?? REGION_CONTEXT_MAX_DIMENSION,
    minDimension: options?.minDimension ?? Math.min(REGION_CONTEXT_MIN_DIMENSION, 96),
  });

  const background = options?.background ?? REGION_CONTEXT_BACKGROUND;
  const container = window.document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.style.width = `${size.width}px`;
  container.style.height = `${size.height}px`;
  container.style.pointerEvents = 'none';
  container.setAttribute('aria-hidden', 'true');
  window.document.body.appendChild(container);

  const stage = new Konva.Stage({
    container,
    width: size.width,
    height: size.height,
  });
  const layer = new Konva.Layer({ listening: false });
  stage.add(layer);

  layer.add(
    new Konva.Rect({
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      fill: background,
      listening: false,
    }),
  );

  const content = new Konva.Group({
    x: 0,
    y: 0,
    scaleX: size.scale,
    scaleY: size.scale,
    clip: {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    },
    listening: false,
  });
  layer.add(content);

  const byId = drawingsById(canvasDoc.elements);
  const ordered = strokeIds
    .map((id) => byId.get(id))
    .filter((el): el is DrawingElement => Boolean(el))
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const el of ordered) {
    content.add(
      new Konva.Line({
        x: el.x - bounds.x,
        y: el.y - bounds.y,
        points: el.points,
        stroke: el.color,
        strokeWidth: el.strokeWidth,
        dash: strokeDashFor(el.strokeStyle, el.strokeWidth),
        opacity: el.opacity,
        tension: 0.35,
        lineCap: 'round',
        lineJoin: 'round',
        rotation: el.rotation,
        listening: false,
      }),
    );
  }

  layer.batchDraw();
  const dataUrl = stage.toDataURL({ mimeType: 'image/png', pixelRatio: 1 });
  stage.destroy();
  container.remove();

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    worldBounds: bounds,
    mimeType: 'image/png',
  };
}
