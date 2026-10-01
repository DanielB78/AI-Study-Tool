/**
 * User-defined note structures — reusable layouts for AI-filled notes.
 * Components: fixed TEXT/EQUATION fields + dynamic NODE_SECTION hierarchies.
 * Stored outside CanvasDocument (library persists across boards).
 */

import type {
  ArrowHeads,
  ConnectorType,
  FontWeight,
  StrokeStyle,
  TextAlignment,
} from '../../types/canvas';

export const NOTE_STRUCTURE_VERSION = 3 as const;

export type StructureFieldContentType = 'text' | 'equation';

/**
 * How generated children expand from their parent.
 * Replaces legacy tree_vertical / tree_horizontal names.
 */
export type NodeChildrenPlacement = 'below' | 'sideways' | 'around';

/** @deprecated use NodeChildrenPlacement */
export type NodeSectionLayoutMode = NodeChildrenPlacement;

/** Style subset reused from TextElement when instantiating TEXT fields / nodes. */
export interface StructureFieldStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: FontWeight;
  fontItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  alignment: TextAlignment;
  lineHeight: number;
  backgroundColor: string | null;
  padding: number;
  cornerRadius: number;
}

/**
 * Geometry relative to the structure's top-left origin, in structure pixels
 * (not world canvas coordinates). Instantiation adds structure origin.
 */
export interface StructureComponentGeometry {
  relativeX: number;
  relativeY: number;
  relativeWidth: number;
  relativeHeight: number;
  zIndex: number;
}

/** Fixed TEXT or EQUATION slot. */
export interface NoteStructureField extends StructureComponentGeometry {
  componentKind: 'field';
  id: string;
  label: string;
  /** AI instruction — what the model should put in this slot. */
  instruction: string;
  contentType: StructureFieldContentType;
  required: boolean;
  style: StructureFieldStyle;
}

/**
 * Visual + AI template for root or child nodes in a Node Section.
 * relativeX/Y are design-time positions within the Node Section region
 * (same interaction model as fixed structure textboxes).
 */
export interface NodeTemplate {
  label: string;
  instruction: string;
  width: number;
  height: number;
  /** Design-time position within the Node Section (structure-relative offset from section origin). */
  relativeX: number;
  relativeY: number;
  style: StructureFieldStyle;
}

/** Connector style for parent→child edges (application-generated). */
export interface NodeSectionConnectorConfig {
  connectorType: ConnectorType;
  strokeStyle: StrokeStyle;
  strokeWidth: number;
  color: string;
  arrowHeads: ArrowHeads;
}

/**
 * Dynamic hierarchical region: LLM supplies content/hierarchy only;
 * app owns layout, IDs, and connectors (real TextElements + ConnectorElements).
 */
export interface NoteStructureNodeSection extends StructureComponentGeometry {
  componentKind: 'node_section';
  id: string;
  label: string;
  /** Higher-level instruction for organising the hierarchy. */
  instruction: string;
  required: boolean;
  rootTemplate: NodeTemplate;
  childTemplate: NodeTemplate;
  /** Children Placement: below | sideways | around */
  childrenPlacement: NodeChildrenPlacement;
  horizontalSpacing: number;
  verticalSpacing: number;
  /** Root = depth 0. */
  maxDepth: number;
  maxTotalNodes: number;
  /** Optional cap on children per node. */
  maxChildrenPerNode?: number;
  connectorConfig: NodeSectionConnectorConfig;
}

export type StructureComponent = NoteStructureField | NoteStructureNodeSection;

export interface NoteStructure {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Structure design canvas bounds (relative coordinate space). */
  width: number;
  height: number;
  fields: StructureComponent[];
  version: typeof NOTE_STRUCTURE_VERSION;
}

export const DEFAULT_STRUCTURE_FIELD_STYLE: StructureFieldStyle = {
  fontSize: 16,
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontWeight: 'normal',
  fontItalic: false,
  underline: false,
  strikethrough: false,
  color: '#1a1a1a',
  alignment: 'left',
  lineHeight: 1.35,
  backgroundColor: '#ffffff',
  padding: 10,
  cornerRadius: 8,
};

export const DEFAULT_ROOT_NODE_STYLE: StructureFieldStyle = {
  ...DEFAULT_STRUCTURE_FIELD_STYLE,
  fontSize: 18,
  fontWeight: 'bold',
  color: '#f8fafc',
  backgroundColor: '#0f172a',
  alignment: 'center',
  padding: 12,
  cornerRadius: 10,
};

export const DEFAULT_CHILD_NODE_STYLE: StructureFieldStyle = {
  ...DEFAULT_STRUCTURE_FIELD_STYLE,
  fontSize: 14,
  backgroundColor: '#e2e8f0',
  alignment: 'left',
  padding: 10,
  cornerRadius: 8,
};

export const DEFAULT_NODE_CONNECTOR_CONFIG: NodeSectionConnectorConfig = {
  connectorType: 'arrow',
  strokeStyle: 'solid',
  strokeWidth: 2,
  color: '#64748b',
  arrowHeads: 'end',
};

export const DEFAULT_STRUCTURE_WIDTH = 640;
export const DEFAULT_STRUCTURE_HEIGHT = 480;

export const DEFAULT_NODE_SECTION_MAX_DEPTH = 4;
export const DEFAULT_NODE_SECTION_MAX_TOTAL_NODES = 50;
export const NODE_SECTION_MAX_DEPTH_LIMIT = 8;
export const NODE_SECTION_MAX_TOTAL_NODES_LIMIT = 100;

export const NODE_CHILDREN_PLACEMENTS: readonly NodeChildrenPlacement[] = [
  'below',
  'sideways',
  'around',
] as const;

export function isNodeSection(
  c: StructureComponent,
): c is NoteStructureNodeSection {
  return c.componentKind === 'node_section';
}

export function isStructureField(c: StructureComponent): c is NoteStructureField {
  return c.componentKind === 'field';
}

/** Migrate legacy layoutMode strings → NodeChildrenPlacement. */
export function normalizeChildrenPlacement(raw: unknown): NodeChildrenPlacement {
  if (raw === 'below' || raw === 'tree_vertical') return 'below';
  if (raw === 'sideways' || raw === 'tree_horizontal') return 'sideways';
  if (raw === 'around') return 'around';
  return 'below';
}

export function childrenPlacementLabel(mode: NodeChildrenPlacement): string {
  switch (mode) {
    case 'below':
      return 'Below';
    case 'sideways':
      return 'Sideways';
    case 'around':
      return 'Around';
  }
}
