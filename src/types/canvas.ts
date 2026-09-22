/** Canonical canvas document model — source of truth for the board. */

export const DOCUMENT_VERSION = 1 as const;

export type ToolType =
  | 'select'
  | 'pan'
  | 'text'
  | 'pen'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'image';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export type TextAlignment = 'left' | 'center' | 'right';
export type FontStyle = 'normal' | 'bold';
export type ShapeType = 'rectangle' | 'ellipse';
export type ConnectorType = 'line' | 'arrow';

/** Shared geometry + identity for every canvas object. */
export interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
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
  fontStyle: FontStyle;
  color: string;
  alignment: TextAlignment;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * Freehand stroke. `points` are relative to (x, y) as [x0,y0,x1,y1,...].
 * Bounding box (width/height) encloses the stroke for hit-testing / selection.
 */
export interface DrawingElement extends BaseElement {
  type: 'drawing';
  points: number[];
  color: string;
  strokeWidth: number;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Data URL or other durable source reference. */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Line or arrow. `points` are [x1,y1,x2,y2] in world space relative to (x,y)
 * (i.e. local coordinates). Optional bindings reserved for future RAG graph edges.
 */
export interface ConnectorElement extends BaseElement {
  type: 'connector';
  connectorType: ConnectorType;
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
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
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  fontBold: boolean;
  fontFamily: string;
  textColor: string;
  textAlignment: TextAlignment;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const DEFAULT_STYLE: StyleDefaults = {
  strokeColor: '#1a1a1a',
  fillColor: '#ffffff',
  strokeWidth: 2,
  fontSize: 18,
  fontBold: false,
  fontFamily: 'Inter, system-ui, sans-serif',
  textColor: '#1a1a1a',
  textAlignment: 'left',
};

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 1.08;

export function createEmptyDocument(): CanvasDocument {
  return {
    version: DOCUMENT_VERSION,
    elements: [],
    camera: { ...DEFAULT_CAMERA },
  };
}
