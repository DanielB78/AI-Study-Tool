/**
 * CanvasRegionRenderer — rasterize a world-coordinate canvas region to a PNG data URL.
 *
 * Renders only canvas content (no UI chrome, selection handles, overlays).
 * Transient output — never written into CanvasDocument.
 */

import Konva from 'konva';
import type {
  CanvasDocument,
  CanvasElement,
  ConnectorElement,
  DrawingElement,
  ImageElement,
  ShapeElement,
  TextElement,
} from '../../types/canvas';
import { strokeDashFor } from '../../types/canvas';
import { shapePointsFor } from '../../utils/shapeGeometry';
import type { WorldRect } from './geometry';
import {
  REGION_CONTEXT_MAX_DIMENSION as CFG_MAX_DIMENSION,
  REGION_CONTEXT_MIN_DIMENSION as CFG_MIN_DIMENSION,
  REGION_CONTEXT_RENDER_SCALE as CFG_RENDER_SCALE,
} from './config';
import { elementsIntersectingRegion } from './regionContext';

/** Output pixels per world unit before max/min clamping. */
export const REGION_CONTEXT_RENDER_SCALE = CFG_RENDER_SCALE;

/** Cap the longest output edge (provider / memory safety). */
export const REGION_CONTEXT_MAX_DIMENSION = CFG_MAX_DIMENSION;

/** Upscale tiny handwriting crops to a readable minimum edge. */
export const REGION_CONTEXT_MIN_DIMENSION = CFG_MIN_DIMENSION;

/** Match the live canvas board background for readable multimodal crops. */
export const REGION_CONTEXT_BACKGROUND = '#f3f1ec';

export interface RegionRenderSize {
  width: number;
  height: number;
  /** Effective world→pixel scale after min/max clamps. */
  scale: number;
}

export interface RegionRenderResult {
  dataUrl: string;
  width: number;
  height: number;
  worldBounds: WorldRect;
  scale: number;
  mimeType: 'image/png';
}

export interface RenderCanvasRegionOptions {
  scale?: number;
  maxDimension?: number;
  minDimension?: number;
  background?: string;
  /** Pixel ratio for Konva (defaults to 1 — scale already encodes resolution). */
  pixelRatio?: number;
}

/**
 * Compute output bitmap size for a world region.
 * Preserves aspect ratio; applies max/min dimension clamps.
 */
export function computeRegionRenderSize(
  worldWidth: number,
  worldHeight: number,
  options?: {
    scale?: number;
    maxDimension?: number;
    minDimension?: number;
  },
): RegionRenderSize {
  const baseScale = options?.scale ?? REGION_CONTEXT_RENDER_SCALE;
  const maxDim = options?.maxDimension ?? REGION_CONTEXT_MAX_DIMENSION;
  const minDim = options?.minDimension ?? REGION_CONTEXT_MIN_DIMENSION;

  const w = Math.max(worldWidth, 0);
  const h = Math.max(worldHeight, 0);
  if (w <= 0 || h <= 0) {
    return { width: 1, height: 1, scale: baseScale };
  }

  let scale = baseScale;
  let outW = w * scale;
  let outH = h * scale;

  const longest = Math.max(outW, outH);
  if (longest > maxDim) {
    scale *= maxDim / longest;
    outW = w * scale;
    outH = h * scale;
  }

  const shortest = Math.min(outW, outH);
  if (shortest < minDim) {
    const up = minDim / shortest;
    const nextLongest = Math.max(outW, outH) * up;
    if (nextLongest <= maxDim) {
      scale *= up;
      outW = w * scale;
      outH = h * scale;
    } else {
      // Upscale as far as max allows.
      const capped = maxDim / Math.max(outW, outH);
      if (capped > 1) {
        scale *= capped;
        outW = w * scale;
        outH = h * scale;
      }
    }
  }

  return {
    width: Math.max(1, Math.round(outW)),
    height: Math.max(1, Math.round(outH)),
    scale,
  };
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image asset for region render`));
    img.src = src;
  });
}

function addTextNode(layer: Konva.Layer, el: TextElement, origin: WorldRect): void {
  const x = el.x - origin.x;
  const y = el.y - origin.y;
  if (el.backgroundColor) {
    layer.add(
      new Konva.Rect({
        x,
        y,
        width: el.width,
        height: el.height,
        fill: el.backgroundColor,
        cornerRadius: el.cornerRadius,
        opacity: el.opacity,
        rotation: el.rotation,
        listening: false,
      }),
    );
  }
  const styleParts: string[] = [];
  if (el.fontWeight === 'bold') styleParts.push('bold');
  if (el.fontItalic) styleParts.push('italic');
  const deco: string[] = [];
  if (el.underline) deco.push('underline');
  if (el.strikethrough) deco.push('line-through');
  layer.add(
    new Konva.Text({
      x: x + el.padding,
      y: y + el.padding,
      width: Math.max(el.width - el.padding * 2, 1),
      height: Math.max(el.height - el.padding * 2, 1),
      text: el.text,
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      fontStyle: styleParts.join(' ') || 'normal',
      textDecoration: deco.join(' '),
      fill: el.color,
      align: el.alignment,
      lineHeight: el.lineHeight,
      opacity: el.opacity,
      rotation: el.rotation,
      listening: false,
      wrap: 'word',
    }),
  );
}

function addDrawingNode(
  layer: Konva.Layer,
  el: DrawingElement,
  origin: WorldRect,
): void {
  layer.add(
    new Konva.Line({
      x: el.x - origin.x,
      y: el.y - origin.y,
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

function addConnectorNode(
  layer: Konva.Layer,
  el: ConnectorElement,
  origin: WorldRect,
): void {
  const common = {
    x: el.x - origin.x,
    y: el.y - origin.y,
    points: [...el.points],
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    dash: strokeDashFor(el.strokeStyle, el.strokeWidth),
    opacity: el.opacity,
    rotation: el.rotation,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
    listening: false,
  };
  const showArrow =
    el.connectorType === 'arrow' ||
    el.arrowHeads === 'end' ||
    el.arrowHeads === 'both';
  if (showArrow) {
    layer.add(
      new Konva.Arrow({
        ...common,
        pointerLength: Math.max(10, el.strokeWidth * 3),
        pointerWidth: Math.max(8, el.strokeWidth * 2.5),
        pointerAtBeginning: el.arrowHeads === 'both',
      }),
    );
  } else {
    layer.add(new Konva.Line(common));
  }
}

function addShapeNode(layer: Konva.Layer, el: ShapeElement, origin: WorldRect): void {
  const x = el.x - origin.x;
  const y = el.y - origin.y;
  const fill = el.fill ?? 'rgba(0,0,0,0)';
  const stroke = el.stroke ?? 'rgba(0,0,0,0)';
  const dash = strokeDashFor(el.strokeStyle, el.strokeWidth);
  const group = new Konva.Group({
    x,
    y,
    opacity: el.opacity,
    rotation: el.rotation,
    listening: false,
  });

  if (el.shapeType === 'ellipse') {
    group.add(
      new Konva.Ellipse({
        x: el.width / 2,
        y: el.height / 2,
        radiusX: Math.max(el.width / 2, 0.5),
        radiusY: Math.max(el.height / 2, 0.5),
        fill,
        stroke,
        strokeWidth: el.strokeWidth,
        dash,
        listening: false,
      }),
    );
  } else if (el.shapeType === 'rectangle' || el.shapeType === 'roundedRect') {
    group.add(
      new Konva.Rect({
        width: el.width,
        height: el.height,
        fill,
        stroke,
        strokeWidth: el.strokeWidth,
        dash,
        cornerRadius:
          el.shapeType === 'roundedRect' ? el.cornerRadius : 0,
        listening: false,
      }),
    );
  } else {
    const pts = shapePointsFor(el.shapeType, el.width, el.height, {
      starPoints: el.starPoints,
      starInnerRatio: el.starInnerRatio,
    });
    if (pts) {
      group.add(
        new Konva.Line({
          points: pts,
          closed: true,
          fill,
          stroke,
          strokeWidth: el.strokeWidth,
          dash,
          listening: false,
        }),
      );
    }
  }

  if (el.label) {
    const pad = 8;
    group.add(
      new Konva.Text({
        x: pad,
        y: pad,
        width: Math.max(el.width - pad * 2, 1),
        height: Math.max(el.height - pad * 2, 1),
        text: el.label,
        fontSize: el.labelFontSize,
        fontFamily: el.labelFontFamily,
        fontStyle:
          [
            el.labelFontWeight === 'bold' ? 'bold' : '',
            el.labelFontItalic ? 'italic' : '',
          ]
            .filter(Boolean)
            .join(' ') || 'normal',
        fill: el.labelColor,
        align: 'center',
        verticalAlign: 'middle',
        listening: false,
        wrap: 'word',
      }),
    );
  }

  layer.add(group);
}

async function addImageNode(
  layer: Konva.Layer,
  el: ImageElement,
  origin: WorldRect,
): Promise<void> {
  try {
    const img = await loadHtmlImage(el.src);
    layer.add(
      new Konva.Image({
        image: img,
        x: el.x - origin.x,
        y: el.y - origin.y,
        width: el.width,
        height: el.height,
        opacity: el.opacity,
        rotation: el.rotation,
        listening: false,
      }),
    );
  } catch {
    // Placeholder if asset fails — still show something in the crop.
    layer.add(
      new Konva.Rect({
        x: el.x - origin.x,
        y: el.y - origin.y,
        width: el.width,
        height: el.height,
        fill: '#e7e5e4',
        stroke: '#a8a29e',
        strokeWidth: 1,
        listening: false,
      }),
    );
  }
}

/** HTML-backed equation / graph → simple labeled placeholder (no UI chrome). */
function addPlaceholderNode(
  layer: Konva.Layer,
  el: CanvasElement,
  origin: WorldRect,
  label: string,
): void {
  const x = el.x - origin.x;
  const y = el.y - origin.y;
  layer.add(
    new Konva.Rect({
      x,
      y,
      width: el.width,
      height: el.height,
      fill: '#ffffff',
      stroke: '#a8a29e',
      strokeWidth: 1,
      opacity: el.opacity,
      rotation: el.rotation,
      listening: false,
    }),
  );
  layer.add(
    new Konva.Text({
      x: x + 6,
      y: y + 6,
      width: Math.max(el.width - 12, 1),
      height: Math.max(el.height - 12, 1),
      text: label,
      fontSize: 12,
      fontFamily: 'monospace',
      fill: '#44403c',
      listening: false,
      wrap: 'word',
    }),
  );
}

async function addElementToLayer(
  layer: Konva.Layer,
  el: CanvasElement,
  origin: WorldRect,
): Promise<void> {
  switch (el.type) {
    case 'text':
      addTextNode(layer, el, origin);
      return;
    case 'drawing':
      addDrawingNode(layer, el, origin);
      return;
    case 'connector':
      addConnectorNode(layer, el, origin);
      return;
    case 'shape':
      addShapeNode(layer, el, origin);
      return;
    case 'image':
      await addImageNode(layer, el, origin);
      return;
    case 'equation':
      addPlaceholderNode(
        layer,
        el,
        origin,
        el.latex?.trim() ? `$$ ${el.latex.trim()} $$` : '[equation]',
      );
      return;
    case 'graph':
      addPlaceholderNode(layer, el, origin, '[graph]');
      return;
    default: {
      const _exhaustive: never = el;
      return _exhaustive;
    }
  }
}

/**
 * Render the exact world rectangle to a PNG data URL.
 * Clips to bounds — partially intersecting strokes appear only inside the crop.
 */
export async function renderCanvasRegion(
  canvasDoc: Pick<CanvasDocument, 'elements'>,
  worldBounds: WorldRect,
  options?: RenderCanvasRegionOptions,
): Promise<RegionRenderResult> {
  if (typeof window === 'undefined' || typeof window.document === 'undefined') {
    throw new Error('CanvasRegionRenderer requires a DOM (window.document)');
  }

  const size = computeRegionRenderSize(worldBounds.width, worldBounds.height, {
    scale: options?.scale,
    maxDimension: options?.maxDimension,
    minDimension: options?.minDimension,
  });

  const background = options?.background ?? REGION_CONTEXT_BACKGROUND;
  const pixelRatio = options?.pixelRatio ?? 1;

  // Offscreen container — never attached to the app chrome.
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

  // Solid background for multimodal readability (no transparency).
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

  // Content group: scale so world region fills the bitmap; clip to exact selection.
  const content = new Konva.Group({
    x: 0,
    y: 0,
    scaleX: size.scale,
    scaleY: size.scale,
    clip: {
      x: 0,
      y: 0,
      width: worldBounds.width,
      height: worldBounds.height,
    },
    listening: false,
  });
  layer.add(content);

  // Only intersecting elements — still clipped to exact selection bounds.
  const intersecting = elementsIntersectingRegion(
    canvasDoc.elements,
    worldBounds,
  ).sort((a, b) => a.zIndex - b.zIndex);

  // Nested layer-like group so child nodes use world-relative coords inside clip.
  const worldGroup = new Konva.Group({ listening: false });
  content.add(worldGroup);

  // Temporarily use a Layer-compatible add target via a sub-layer pattern:
  // Konva.Group accepts the same Shape children.
  const proxyLayer = {
    add: (node: Konva.Shape | Konva.Group) => {
      worldGroup.add(node);
    },
  } as unknown as Konva.Layer;

  for (const el of intersecting) {
    await addElementToLayer(proxyLayer, el, worldBounds);
  }

  layer.batchDraw();

  const dataUrl = stage.toDataURL({
    mimeType: 'image/png',
    pixelRatio,
  });

  stage.destroy();
  container.remove();

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    worldBounds: { ...worldBounds },
    scale: size.scale,
    mimeType: 'image/png',
  };
}
