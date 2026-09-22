/** Canonical canvas document model — source of truth for the board. */

export const DOCUMENT_VERSION = 2 as const;

export type ShapeType =
  | 'rectangle'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'callout'
  | 'parallelogram';

export type ToolType =
  | 'select'
  | 'pan'
  | 'text'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'image'
  | ShapeType;

export type ConnectorType = 'line' | 'arrow';
export type ArrowHeads = 'none' | 'end' | 'both';
export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlignment = 'left' | 'center' | 'right';
export type FontWeight = 'normal' | 'bold';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Shared geometry + identity for every canvas object. */
export interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  /** Extensible bag for future AI/RAG annotations without schema churn. */
  metadata: Record<string, unknown>;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: FontWeight;
  fontItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  alignment: TextAlignment;
  lineHeight: number;
  /** null / empty = transparent */
  backgroundColor: string | null;
  padding: number;
  cornerRadius: number;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  /** null = no fill */
  fill: string | null;
  /** null = no stroke */
  stroke: string | null;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  cornerRadius: number;
  /** Star points (default 5). */
  starPoints: number;
  /** Inner radius ratio for star (0–1). */
  starInnerRatio: number;
  /** Label text rendered inside the shape (semantic, not rasterized). */
  label: string;
  labelFontSize: number;
  labelFontFamily: string;
  labelFontWeight: FontWeight;
  labelFontItalic: boolean;
  labelColor: string;
}

export interface DrawingElement extends BaseElement {
  type: 'drawing';
  points: number[];
  color: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ConnectorElement extends BaseElement {
  type: 'connector';
  connectorType: ConnectorType;
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  arrowHeads: ArrowHeads;
  startBindingId?: string | null;
  endBindingId?: string | null;
}

export type CanvasElement =
  | TextElement
  | ShapeElement
  | DrawingElement
  | ImageElement
  | ConnectorElement;

export type CanvasElementType = CanvasElement['type'];

export interface CanvasDocument {
  version: typeof DOCUMENT_VERSION;
  elements: CanvasElement[];
  camera: Camera;
}

export interface StyleDefaults {
  strokeColor: string | null;
  fillColor: string | null;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  cornerRadius: number;
  fontSize: number;
  fontWeight: FontWeight;
  fontItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontFamily: string;
  textColor: string;
  textAlignment: TextAlignment;
  lineHeight: number;
  textBackgroundColor: string | null;
  textPadding: number;
  textCornerRadius: number;
  arrowHeads: ArrowHeads;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const DEFAULT_STYLE: StyleDefaults = {
  strokeColor: '#1a1a1a',
  fillColor: '#ffffff',
  strokeWidth: 2,
  strokeStyle: 'solid',
  opacity: 1,
  cornerRadius: 12,
  fontSize: 18,
  fontWeight: 'normal',
  fontItalic: false,
  underline: false,
  strikethrough: false,
  fontFamily: 'Arial, Helvetica, sans-serif',
  textColor: '#1a1a1a',
  textAlignment: 'left',
  lineHeight: 1.35,
  textBackgroundColor: null,
  textPadding: 8,
  textCornerRadius: 8,
  arrowHeads: 'end',
};

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.08;

export const TRANSPARENT = null;

export function createEmptyDocument(): CanvasDocument {
  return {
    version: DOCUMENT_VERSION,
    elements: [],
    camera: { ...DEFAULT_CAMERA },
  };
}

export function isShapeTool(tool: ToolType): tool is ShapeType {
  return (
    tool === 'rectangle' ||
    tool === 'roundedRect' ||
    tool === 'ellipse' ||
    tool === 'triangle' ||
    tool === 'diamond' ||
    tool === 'pentagon' ||
    tool === 'hexagon' ||
    tool === 'star' ||
    tool === 'callout' ||
    tool === 'parallelogram'
  );
}

export function strokeDashFor(
  style: StrokeStyle,
  strokeWidth: number,
): number[] | undefined {
  switch (style) {
    case 'dashed':
      return [Math.max(8, strokeWidth * 4), Math.max(6, strokeWidth * 3)];
    case 'dotted':
      return [Math.max(2, strokeWidth), Math.max(4, strokeWidth * 2)];
    default:
      return undefined;
  }
}
