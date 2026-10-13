/** Canonical canvas document model — source of truth for the board. */

import { nanoid } from 'nanoid';
import type {
  GraphExpression,
  GraphPoint,
  GraphRegion,
  GraphSettings,
  GraphViewport,
} from '../features/graphs/types';
import type { RichTextDocument } from '../features/text/richText';
import type {
  TextComment,
  TextNote,
  TextTitle,
} from '../features/text/textFeatureTypes';
import type {
  TextComponentMeta,
  TextComponentType,
} from '../features/text/textComponents';

export type { TextComponentMeta, TextComponentType };

export const DOCUMENT_VERSION = 8 as const;

/** Logical association of a GraphElement to a parent TextElement. */
export type GraphAssociationMeta = {
  associatedElementId?: string;
  placementMode: 'auto' | 'manual';
  /** Order among graphs attached to the same TextElement (creation order). */
  order?: number;
};

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
  | 'equation'
  | 'graph'
  | 'pen'
  | 'line'
  | 'arrow'
  | 'image'
  | ShapeType;

export type EquationDisplayMode = 'display' | 'inline';

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
  /** Plain-text extract (always set). Base body for RAG; features augment indexing. */
  text: string;
  /**
   * Optional structured rich text. When set, rendering/editing use this document
   * and `text` is kept in sync as the plain extract.
   */
  richText?: RichTextDocument;
  /**
   * Textbook component role. Defaults to main_text when omitted.
   * Title / definition / example / warning / linked_comment / exercise are
   * independent canvas TextElements — not nested chrome on main_text.
   */
  componentType?: TextComponentType;
  /** Component relationships, placement mode, labels, comment anchors. */
  componentMeta?: TextComponentMeta;
  /**
   * @deprecated Legacy nested title (DOCUMENT_VERSION ≤ 5). Migrated to a
   * separate title TextElement on load.
   */
  title?: TextTitle;
  /**
   * @deprecated Legacy nested notes (DOCUMENT_VERSION ≤ 5). Migrated to
   * standalone text components on load.
   */
  notes?: TextNote[];
  /**
   * @deprecated Legacy nested comments (DOCUMENT_VERSION ≤ 5). Migrated to
   * linked_comment TextElements on load.
   */
  comments?: TextComment[];
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

/** Standalone mathematical expression — LaTeX is the source of truth. */
export interface EquationElement extends BaseElement {
  type: 'equation';
  /** Canonical LaTeX source (no $ / $$ fences). */
  latex: string;
  fontSize: number;
  color: string;
  displayMode: EquationDisplayMode;
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

/** Interactive graphing calculator — canvas geometry is separate from GraphViewport. */
export interface GraphElement extends BaseElement {
  type: 'graph';
  expressions: GraphExpression[];
  points: GraphPoint[];
  /** Native shaded / highlighted regions in mathematical coordinates. */
  regions: GraphRegion[];
  viewport: GraphViewport;
  settings: GraphSettings;
  /**
   * Optional association to a parent TextElement (attached_graph).
   * Graph remains an independent editable canvas object.
   */
  association?: GraphAssociationMeta;
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
  | EquationElement
  | ShapeElement
  | DrawingElement
  | ImageElement
  | GraphElement
  | ConnectorElement;

export type CanvasElementType = CanvasElement['type'];

export interface CanvasDocument {
  version: typeof DOCUMENT_VERSION;
  /** Stable board identity for RAG indexing / sync (not regenerated on load). */
  id: string;
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
    id: nanoid(12),
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
