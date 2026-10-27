/**
 * Visual structure templates — user-designed layouts with LLM content slots.
 *
 * The user designs relative geometry and styling. Generative slots carry a
 * natural-language content description; the LLM fills them via :::structure
 * Markdown directives. Decorative elements are copied as-is.
 *
 * Legacy NODE_SECTION components remain loadable (v≤3) but are not part of
 * the active :::structure generation path.
 *
 * Stored outside CanvasDocument (library persists across boards).
 */

import type {
  ArrowHeads,
  ConnectorType,
  FontWeight,
  StrokeStyle,
  TextAlignment,
} from '../../types/canvas';

export const NOTE_STRUCTURE_VERSION = 4 as const;

/** Generative / decorative slot content kinds. */
export type StructureFieldContentType = 'text' | 'equation' | 'graph';

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

/** Fixed TEXT, EQUATION, or GRAPH slot (or decorative static element). */
export interface NoteStructureField extends StructureComponentGeometry {
  componentKind: 'field';
  id: string;
  /** Short UI label in the editor (not the LLM marker). */
  label: string;
  /**
   * Natural-language content description — the LLM marker after `:::`.
   * Required when generative; ignored when decorative.
   * @alias contentDescription
   */
  instruction: string;
  contentType: StructureFieldContentType;
  /**
   * When true, the LLM must fill this slot. When false, `staticContent` is
   * copied from the template without LLM generation.
   */
  generative: boolean;
  /** Required generative slots must appear in each :::structure instance. */
  required: boolean;
  /** Reading order for prompt listing and validation (independent of geometry). */
  readingOrder: number;
  /** Optional rotation in degrees (preserved from the template). */
  rotation: number;
  /**
   * Fixed content for decorative elements (plain text, LaTeX, or graph body).
   * Also used as editor placeholder preview for generative slots.
   */
  staticContent: string;
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
 * @deprecated Legacy hierarchical region from structure v≤3.
 * Still loadable and editable, but not filled via :::structure directives.
 * Prefer fixed visual slots (text / equation / graph) for new templates.
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

/** Generative visual slot (participates in :::structure filling). */
export function isGenerativeField(c: StructureComponent): c is NoteStructureField {
  return isStructureField(c) && c.generative !== false && Boolean(c.instruction?.trim());
}

/** Decorative / static field copied from the template without LLM content. */
export function isDecorativeField(c: StructureComponent): c is NoteStructureField {
  return isStructureField(c) && !isGenerativeField(c);
}

/** Content description used as the LLM slot marker. */
export function fieldContentDescription(field: NoteStructureField): string {
  return field.instruction;
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
