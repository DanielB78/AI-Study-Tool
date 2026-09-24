import type {
  BaseElement,
  CanvasDocument,
  CanvasElement,
  ConnectorElement,
  DrawingElement,
  ImageElement,
  ShapeElement,
  StyleDefaults,
  TextElement,
} from '../types/canvas';
import { DOCUMENT_VERSION, DEFAULT_STYLE, createEmptyDocument } from '../types/canvas';
import { nanoid } from 'nanoid';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function colorOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (value === 'transparent') return null;
  if (typeof value === 'string') return value;
  return fallback;
}

function migrateBase(raw: Record<string, unknown>, zFallback: number): BaseElement {
  const t = Date.now();
  return {
    id: str(raw.id, `migrated-${Math.random().toString(36).slice(2, 10)}`),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 0),
    height: num(raw.height, 0),
    rotation: num(raw.rotation, 0),
    zIndex: num(raw.zIndex, zFallback),
    opacity: num(raw.opacity, 1),
    locked: bool(raw.locked, false),
    createdAt: num(raw.createdAt, t),
    updatedAt: num(raw.updatedAt, t),
    metadata: isObject(raw.metadata) ? (raw.metadata as Record<string, unknown>) : {},
  };
}

function migrateText(raw: Record<string, unknown>, z: number): TextElement {
  const legacyBold =
    raw.fontStyle === 'bold' || raw.fontWeight === 'bold';
  return {
    ...migrateBase(raw, z),
    type: 'text',
    text: str(raw.text, ''),
    fontSize: num(raw.fontSize, DEFAULT_STYLE.fontSize),
    fontFamily: str(raw.fontFamily, DEFAULT_STYLE.fontFamily),
    fontWeight: legacyBold ? 'bold' : 'normal',
    fontItalic: bool(raw.fontItalic, raw.fontStyle === 'italic'),
    underline: bool(raw.underline, false),
    strikethrough: bool(raw.strikethrough, false),
    color: str(raw.color, DEFAULT_STYLE.textColor),
    alignment:
      raw.alignment === 'center' || raw.alignment === 'right' ? raw.alignment : 'left',
    lineHeight: num(raw.lineHeight, DEFAULT_STYLE.lineHeight),
    backgroundColor: colorOrNull(raw.backgroundColor, null),
    padding: num(raw.padding, DEFAULT_STYLE.textPadding),
    cornerRadius: num(raw.cornerRadius, DEFAULT_STYLE.textCornerRadius),
  };
}

function migrateShape(raw: Record<string, unknown>, z: number): ShapeElement {
  const shapeType =
    raw.shapeType === 'roundedRect' ||
    raw.shapeType === 'ellipse' ||
    raw.shapeType === 'triangle' ||
    raw.shapeType === 'diamond' ||
    raw.shapeType === 'pentagon' ||
    raw.shapeType === 'hexagon' ||
    raw.shapeType === 'star' ||
    raw.shapeType === 'callout' ||
    raw.shapeType === 'parallelogram'
      ? raw.shapeType
      : 'rectangle';

  return {
    ...migrateBase(raw, z),
    type: 'shape',
    shapeType,
    fill: colorOrNull(raw.fill, DEFAULT_STYLE.fillColor),
    stroke: colorOrNull(raw.stroke, DEFAULT_STYLE.strokeColor),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
    cornerRadius: num(raw.cornerRadius, shapeType === 'roundedRect' ? 16 : 0),
    starPoints: num(raw.starPoints, 5),
    starInnerRatio: num(raw.starInnerRatio, 0.45),
    label: str(raw.label, ''),
    labelFontSize: num(raw.labelFontSize, 16),
    labelFontFamily: str(raw.labelFontFamily, DEFAULT_STYLE.fontFamily),
    labelFontWeight: raw.labelFontWeight === 'bold' ? 'bold' : 'normal',
    labelFontItalic: bool(raw.labelFontItalic, false),
    labelColor: str(raw.labelColor, DEFAULT_STYLE.textColor),
  };
}

function migrateDrawing(raw: Record<string, unknown>, z: number): DrawingElement {
  const points = Array.isArray(raw.points)
    ? raw.points.filter((p): p is number => typeof p === 'number')
    : [];
  return {
    ...migrateBase(raw, z),
    type: 'drawing',
    points,
    color: str(raw.color, DEFAULT_STYLE.strokeColor ?? '#1a1a1a'),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
  };
}

function migrateImage(raw: Record<string, unknown>, z: number): ImageElement {
  return {
    ...migrateBase(raw, z),
    type: 'image',
    src: str(raw.src, ''),
    naturalWidth: num(raw.naturalWidth, num(raw.width, 1)),
    naturalHeight: num(raw.naturalHeight, num(raw.height, 1)),
  };
}

function migrateConnector(raw: Record<string, unknown>, z: number): ConnectorElement {
  const pts = Array.isArray(raw.points) ? raw.points : [0, 0, 1, 1];
  const points: [number, number, number, number] = [
    num(pts[0], 0),
    num(pts[1], 0),
    num(pts[2], 1),
    num(pts[3], 1),
  ];
  const connectorType = raw.connectorType === 'arrow' ? 'arrow' : 'line';
  let arrowHeads: ConnectorElement['arrowHeads'] = 'none';
  if (raw.arrowHeads === 'end' || raw.arrowHeads === 'both' || raw.arrowHeads === 'none') {
    arrowHeads = raw.arrowHeads;
  } else if (connectorType === 'arrow') {
    arrowHeads = 'end';
  }

  return {
    ...migrateBase(raw, z),
    type: 'connector',
    connectorType,
    points,
    stroke: str(raw.stroke, '#1a1a1a'),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
    arrowHeads,
    startBindingId:
      typeof raw.startBindingId === 'string' || raw.startBindingId === null
        ? (raw.startBindingId as string | null)
        : null,
    endBindingId:
      typeof raw.endBindingId === 'string' || raw.endBindingId === null
        ? (raw.endBindingId as string | null)
        : null,
  };
}

export function migrateElement(raw: unknown, index: number): CanvasElement | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'text':
      return migrateText(raw, index + 1);
    case 'shape':
      return migrateShape(raw, index + 1);
    case 'drawing':
      return migrateDrawing(raw, index + 1);
    case 'image':
      return migrateImage(raw, index + 1);
    case 'connector':
      return migrateConnector(raw, index + 1);
    default:
      return null;
  }
}

/** Normalize any supported document version into the current schema. */
export function migrateDocument(raw: unknown): CanvasDocument | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.elements) || !isObject(raw.camera)) return null;

  const version = raw.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== DOCUMENT_VERSION) {
    return null;
  }

  const camera = raw.camera;
  if (
    typeof camera.x !== 'number' ||
    typeof camera.y !== 'number' ||
    typeof camera.zoom !== 'number'
  ) {
    return null;
  }

  const elements = raw.elements
    .map((el, i) => migrateElement(el, i))
    .filter((el): el is CanvasElement => el !== null);

  const existingId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;

  return {
    version: DOCUMENT_VERSION,
    id: existingId ?? nanoid(12),
    elements,
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
  };
}

export function styleFromElement(el: CanvasElement, style: StyleDefaults): StyleDefaults {
  switch (el.type) {
    case 'text':
      return {
        ...style,
        textColor: el.color,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        fontItalic: el.fontItalic,
        underline: el.underline,
        strikethrough: el.strikethrough,
        fontFamily: el.fontFamily,
        textAlignment: el.alignment,
        lineHeight: el.lineHeight,
        textBackgroundColor: el.backgroundColor,
        textPadding: el.padding,
        textCornerRadius: el.cornerRadius,
        opacity: el.opacity,
      };
    case 'shape':
      return {
        ...style,
        fillColor: el.fill,
        strokeColor: el.stroke,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        cornerRadius: el.cornerRadius,
        opacity: el.opacity,
        fontSize: el.labelFontSize,
        fontFamily: el.labelFontFamily,
        fontWeight: el.labelFontWeight,
        fontItalic: el.labelFontItalic,
        textColor: el.labelColor,
      };
    case 'drawing':
      return {
        ...style,
        strokeColor: el.color,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        opacity: el.opacity,
      };
    case 'connector':
      return {
        ...style,
        strokeColor: el.stroke,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        opacity: el.opacity,
        arrowHeads: el.arrowHeads,
      };
    case 'image':
      return { ...style, opacity: el.opacity };
    default:
      return style;
  }
}

export { createEmptyDocument };
