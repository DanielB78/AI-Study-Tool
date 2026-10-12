/**
 * Canvas agent operations — TypeScript types + JSON Schema (single source).
 * Backend Pydantic models mirror this for future Structured Outputs.
 */

import type { TextFeatureOperation } from './textFeatureOperations';
import type { TextComponentOperation } from './textComponentOperations';
import type { TextCommentType, TextNoteType } from '../../text/textFeatureTypes';

export type { TextFeatureOperation } from './textFeatureOperations';
export type { TextComponentOperation } from './textComponentOperations';

export type PlacementRelation = 'left_of' | 'right_of' | 'above' | 'below' | 'near';

export type ViewportDefaultPlacement = {
  mode: 'viewport_default';
};

export type RelativePlacement = {
  mode: 'relative_to_element';
  anchor_element_id: string;
  relation: PlacementRelation;
};

export type AbsolutePlacement = {
  mode: 'absolute';
  x: number;
  y: number;
};

export type Placement = ViewportDefaultPlacement | RelativePlacement | AbsolutePlacement;

/** Temporary plan reference for grid layout items (not a CanvasElement id). */
export type OperationRef = string;

export type GridLayoutItemSpec = {
  ref: OperationRef;
  row: number;
  column: number;
  /** Defaults to 1. Must not exceed grid width. */
  column_span?: number;
};

/**
 * Multi-element grid layout. The LLM assigns cells; the app computes geometry.
 * `placement` positions the whole group (not individual items).
 */
export type GridLayoutSpec = {
  type: 'grid';
  /** 1–4 columns (dynamic max may be lower; app reflows). */
  columns: number;
  placement: Placement;
  items: GridLayoutItemSpec[];
};

/**
 * Chronological multi-object cell layout (High-mode default).
 * Creation-operation order is authoritative. Optional `layout_cell` on create
 * ops groups consecutive objects into the same grid cell (1–4 per cell).
 * The application assigns rows/columns and stacks members vertically.
 */
export type ChronologicalGridLayoutSpec = {
  type: 'chronological_grid';
  placement: Placement;
  /** Optional column hint; clamped by dynamic max_columns(N). */
  columns?: number;
};

/** Explicit grid or chronological cell grid. */
export type AnyLayoutSpec = GridLayoutSpec | ChronologicalGridLayoutSpec;

export function isChronologicalGridLayout(
  layout: AnyLayoutSpec,
): layout is ChronologicalGridLayoutSpec {
  return layout.type === 'chronological_grid';
}

export function isExplicitGridLayout(layout: AnyLayoutSpec): layout is GridLayoutSpec {
  return layout.type === 'grid';
}

/** Lightweight semantic role for presentation / debug (does not reorder). */
export const LAYOUT_ROLES = [
  'introduction',
  'explanation',
  'mathematical_step',
  'visualisation',
  'given_information',
  'final_result',
  'verification',
] as const;

export type LayoutRole = (typeof LAYOUT_ROLES)[number];

/** LLM-selected output preset; app maps it to OutputLayoutConfig. */
export type AgentOutputType = 'lesson' | 'step_by_step';

/** Optional layout grouping fields shared by creatable operations. */
export type CreationLayoutFields = {
  /** Temporary ref for layout / chronological ordering. */
  ref?: OperationRef;
  /**
   * Optional cell id — consecutive creates with the same id share one grid cell
   * (max depends on output_type; oversized groups are auto-split).
   * Non-contiguous reuse is rejected.
   */
  layout_cell?: string;
  /** Optional column span for the containing cell (defaults to 1; lesson grid). */
  column_span?: number;
  /** Optional presentation role — does not change operation order. */
  layout_role?: LayoutRole;
};

/** Structured rich-text document (mirrors features/text/richText). */
export type AgentRichTextSpanStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  highlight_color?: string;
  font_size?: string | number;
};

export type AgentRichTextSpan = {
  text: string;
  style?: AgentRichTextSpanStyle;
};

export type AgentRichTextBlock = {
  /** Optional temporary local id for comment anchors within the same create plan. */
  id?: string;
  type: 'paragraph' | 'heading' | 'bullet' | 'numbered';
  role?: 'heading' | 'body';
  spans: AgentRichTextSpan[];
};

export type AgentRichTextDocument = {
  blocks: AgentRichTextBlock[];
};

/** Optional note attached at create_text time (IDs assigned by the app). */
export type CreateTextNoteSpec = {
  text: string;
  note_type?: TextNoteType;
};

/** Optional linked comment attached at create_text time. */
export type CreateTextCommentSpec = {
  anchor: {
    quote: string;
    block_id?: string;
    block_ref?: string;
    occurrence?: number;
  };
  comment: string;
  comment_type?: TextCommentType;
};

export type CreateTextOperation = {
  type: 'create_text';
  /**
   * Plain-text extract (always populated by the parser).
   * LLM may omit this when providing `rich_text`.
   */
  text: string;
  /** Structured rich text — preferred for formatted notes. */
  rich_text?: AgentRichTextDocument;
  /** Optional title above the main text. */
  title?: string;
  /** Optional supplementary notes below the main text. */
  notes?: CreateTextNoteSpec[];
  /** Optional comments anchored to phrases in the new text. */
  comments?: CreateTextCommentSpec[];
  /** Omitted when assigned via layout — parser defaults to viewport_default. */
  placement: Placement;
} & CreationLayoutFields;

export type CreateEquationOperation = {
  type: 'create_equation';
  latex: string;
  placement: Placement;
} & CreationLayoutFields;

export type UpdateTextOperation = {
  type: 'update_text';
  target_element_id: string;
  /** Plain-text extract (always populated by the parser). */
  text: string;
  rich_text?: AgentRichTextDocument;
};

/** TEXT field payload for create_structured_note. */
export type StructuredTextFieldPayload = {
  content: string;
};

/** EQUATION field payload for create_structured_note. */
export type StructuredEquationFieldPayload = {
  latex: string;
};

/** Recursive hierarchy node for NODE_SECTION fields (content only — no geometry/IDs). */
export type StructuredHierarchyNode = {
  content: string;
  children: StructuredHierarchyNode[];
};

/** NODE_SECTION field payload for create_structured_note. */
export type StructuredNodeSectionFieldPayload = {
  root: StructuredHierarchyNode;
};

export type StructuredFieldPayload =
  | StructuredTextFieldPayload
  | StructuredEquationFieldPayload
  | StructuredNodeSectionFieldPayload
  | null;

export type CreateStructuredNoteOperation = {
  type: 'create_structured_note';
  structure_id: string;
  /** field_id → payload; optional fields may be omitted or null */
  fields: Record<string, StructuredFieldPayload>;
  placement: Placement;
} & CreationLayoutFields;

/** One curve on a newly created GraphElement (canonical GraphMathSyntax). */
export type CreateGraphExpressionSpec = {
  /** Canonical code-style math DSL, e.g. "x**2" — NOT LaTeX, NOT "y = …". */
  expression: string;
  visible: boolean;
  domain_min: number | null;
  domain_max: number | null;
};

/** Explicit labeled point on a newly created GraphElement. */
export type CreateGraphPointSpec = {
  x: number;
  y: number;
  label: string;
  visible: boolean;
};

export type CreateGraphViewportSpec = {
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
};

export type CreateGraphSettingsSpec = {
  title: string | null;
  x_axis_label: string | null;
  y_axis_label: string | null;
  show_grid: boolean;
  show_x_axis: boolean;
  show_y_axis: boolean;
};

/**
 * Create a new interactive GraphElement.
 */
export type CreateGraphOperation = {
  type: 'create_graph';
  expressions: CreateGraphExpressionSpec[];
  points: CreateGraphPointSpec[];
  viewport: CreateGraphViewportSpec;
  settings: CreateGraphSettingsSpec;
  placement: Placement;
} & CreationLayoutFields;

export type AddGraphExpressionOperation = {
  type: 'add_graph_expression';
  graph_id: string;
  expression: CreateGraphExpressionSpec;
};

/** PATCH: only provided fields change. */
export type UpdateGraphExpressionOperation = {
  type: 'update_graph_expression';
  graph_id: string;
  expression_id: string;
  expression?: string;
  domain_min?: number | null;
  domain_max?: number | null;
};

export type RemoveGraphExpressionOperation = {
  type: 'remove_graph_expression';
  graph_id: string;
  expression_id: string;
};

export type SetGraphExpressionVisibilityOperation = {
  type: 'set_graph_expression_visibility';
  graph_id: string;
  expression_id: string;
  visible: boolean;
};

/** PATCH viewport — omit fields to leave unchanged. */
export type UpdateGraphViewportOperation = {
  type: 'update_graph_viewport';
  graph_id: string;
  x_min?: number;
  x_max?: number;
  y_min?: number;
  y_max?: number;
};

/** PATCH settings — omit fields to leave unchanged. */
export type UpdateGraphSettingsOperation = {
  type: 'update_graph_settings';
  graph_id: string;
  title?: string | null;
  x_axis_label?: string | null;
  y_axis_label?: string | null;
  show_grid?: boolean;
  show_x_axis?: boolean;
  show_y_axis?: boolean;
};

export type AddGraphPointOperation = {
  type: 'add_graph_point';
  graph_id: string;
  x: number;
  y: number;
  label: string;
  visible: boolean;
};

/** PATCH point — omit fields to leave unchanged. */
export type UpdateGraphPointOperation = {
  type: 'update_graph_point';
  graph_id: string;
  point_id: string;
  x?: number;
  y?: number;
  label?: string;
  visible?: boolean;
};

export type RemoveGraphPointOperation = {
  type: 'remove_graph_point';
  graph_id: string;
  point_id: string;
};

export type CanvasOperation =
  | CreateTextOperation
  | CreateEquationOperation
  | UpdateTextOperation
  | CreateStructuredNoteOperation
  | CreateGraphOperation
  | AddGraphExpressionOperation
  | UpdateGraphExpressionOperation
  | RemoveGraphExpressionOperation
  | SetGraphExpressionVisibilityOperation
  | UpdateGraphViewportOperation
  | UpdateGraphSettingsOperation
  | AddGraphPointOperation
  | UpdateGraphPointOperation
  | RemoveGraphPointOperation
  | TextFeatureOperation
  | TextComponentOperation;

export type CanvasAgentResponse = {
  operations: CanvasOperation[];
  /**
   * Output preset selected by the LLM from the user request.
   * Defaults to `lesson` when omitted. Controls max objects/cell and
   * in-cell arrangement (lesson vertical stack vs step_by_step horizontal pair).
   */
  output_type?: AgentOutputType;
  /**
   * Required when creating multiple related objects with viewport_default.
   * Prefer `chronological_grid` (operation order + optional layout_cell);
   * use explicit `grid` only when the user demands a specific arrangement.
   */
  layout?: AnyLayoutSpec;
};

export const PLACEMENT_RELATIONS: readonly PlacementRelation[] = [
  'left_of',
  'right_of',
  'above',
  'below',
  'near',
] as const;

/** Authoritative JSON Schema for LLM Structured Outputs / prompt contract. */
export const CANVAS_AGENT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CanvasAgentResponse',
  type: 'object',
  additionalProperties: false,
  required: ['operations'],
  properties: {
    output_type: {
      type: 'string',
      enum: ['lesson', 'step_by_step'],
    },
    layout: {
      oneOf: [
        { $ref: '#/$defs/chronologicalGridLayout' },
        { $ref: '#/$defs/gridLayout' },
      ],
    },
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type'],
            properties: {
              type: { const: 'create_text' },
              text: { type: 'string', minLength: 1 },
              rich_text: { $ref: '#/$defs/richText' },
              title: { type: 'string', minLength: 1 },
              notes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['text'],
                  properties: {
                    text: { type: 'string', minLength: 1 },
                    note_type: {
                      type: 'string',
                      enum: [
                        'extra_information',
                        'important',
                        'caution',
                        'reference',
                      ],
                    },
                  },
                },
              },
              comments: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['anchor'],
                  properties: {
                    anchor: { $ref: '#/$defs/textAnchor' },
                    comment: { type: 'string', minLength: 1 },
                    text: { type: 'string', minLength: 1 },
                    comment_type: {
                      type: 'string',
                      enum: [
                        'explanation',
                        'correction',
                        'suggestion',
                        'question',
                      ],
                    },
                    type: {
                      type: 'string',
                      enum: [
                        'explanation',
                        'correction',
                        'suggestion',
                        'question',
                      ],
                    },
                  },
                },
              },
              ref: { type: 'string', minLength: 1 },
              layout_cell: { type: 'string', minLength: 1 },
              layout_role: { $ref: '#/$defs/layoutRole' },
              column_span: { type: 'integer', minimum: 1, maximum: 4 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'latex'],
            properties: {
              type: { const: 'create_equation' },
              latex: { type: 'string', minLength: 1 },
              ref: { type: 'string', minLength: 1 },
              layout_cell: { type: 'string', minLength: 1 },
              layout_role: { $ref: '#/$defs/layoutRole' },
              column_span: { type: 'integer', minimum: 1, maximum: 4 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id'],
            properties: {
              type: { const: 'update_text' },
              target_element_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              rich_text: { $ref: '#/$defs/richText' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'structure_id', 'fields'],
            properties: {
              type: { const: 'create_structured_note' },
              structure_id: { type: 'string', minLength: 1 },
              ref: { type: 'string', minLength: 1 },
              layout_cell: { type: 'string', minLength: 1 },
              layout_role: { $ref: '#/$defs/layoutRole' },
              column_span: { type: 'integer', minimum: 1, maximum: 4 },
              fields: {
                type: 'object',
                additionalProperties: {
                  anyOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['content'],
                      properties: { content: { type: 'string', minLength: 1 } },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['latex'],
                      properties: { latex: { type: 'string', minLength: 1 } },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      required: ['root'],
                      properties: {
                        root: { $ref: '#/$defs/hierarchyNode' },
                      },
                    },
                    { type: 'null' },
                  ],
                },
              },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: [
              'type',
              'expressions',
              'points',
              'viewport',
              'settings',
            ],
            properties: {
              type: { const: 'create_graph' },
              expressions: {
                type: 'array',
                items: { $ref: '#/$defs/graphExpression' },
              },
              points: {
                type: 'array',
                items: { $ref: '#/$defs/graphPoint' },
              },
              viewport: { $ref: '#/$defs/graphViewport' },
              settings: { $ref: '#/$defs/graphSettings' },
              ref: { type: 'string', minLength: 1 },
              layout_cell: { type: 'string', minLength: 1 },
              layout_role: { $ref: '#/$defs/layoutRole' },
              column_span: { type: 'integer', minimum: 1, maximum: 4 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'expression'],
            properties: {
              type: { const: 'add_graph_expression' },
              graph_id: { type: 'string', minLength: 1 },
              expression: { $ref: '#/$defs/graphExpression' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'expression_id'],
            properties: {
              type: { const: 'update_graph_expression' },
              graph_id: { type: 'string', minLength: 1 },
              expression_id: { type: 'string', minLength: 1 },
              expression: { type: 'string', minLength: 1 },
              domain_min: { type: ['number', 'null'] },
              domain_max: { type: ['number', 'null'] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'expression_id'],
            properties: {
              type: { const: 'remove_graph_expression' },
              graph_id: { type: 'string', minLength: 1 },
              expression_id: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'expression_id', 'visible'],
            properties: {
              type: { const: 'set_graph_expression_visibility' },
              graph_id: { type: 'string', minLength: 1 },
              expression_id: { type: 'string', minLength: 1 },
              visible: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id'],
            properties: {
              type: { const: 'update_graph_viewport' },
              graph_id: { type: 'string', minLength: 1 },
              x_min: { type: 'number' },
              x_max: { type: 'number' },
              y_min: { type: 'number' },
              y_max: { type: 'number' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id'],
            properties: {
              type: { const: 'update_graph_settings' },
              graph_id: { type: 'string', minLength: 1 },
              title: { type: ['string', 'null'] },
              x_axis_label: { type: ['string', 'null'] },
              y_axis_label: { type: ['string', 'null'] },
              show_grid: { type: 'boolean' },
              show_x_axis: { type: 'boolean' },
              show_y_axis: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'x', 'y'],
            properties: {
              type: { const: 'add_graph_point' },
              graph_id: { type: 'string', minLength: 1 },
              x: { type: 'number' },
              y: { type: 'number' },
              label: { type: 'string' },
              visible: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'point_id'],
            properties: {
              type: { const: 'update_graph_point' },
              graph_id: { type: 'string', minLength: 1 },
              point_id: { type: 'string', minLength: 1 },
              x: { type: 'number' },
              y: { type: 'number' },
              label: { type: 'string' },
              visible: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'graph_id', 'point_id'],
            properties: {
              type: { const: 'remove_graph_point' },
              graph_id: { type: 'string', minLength: 1 },
              point_id: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'component', 'content'],
            properties: {
              type: { const: 'create_text_component' },
              component: {
                type: 'string',
                enum: [
                  'main_text',
                  'title',
                  'definition',
                  'example',
                  'warning',
                  'exercise',
                ],
              },
              content: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              ref: { type: 'string', minLength: 1 },
              associated_element_id: { type: 'string', minLength: 1 },
              variant: {
                type: 'string',
                enum: ['warning', 'common_mistake', 'important_caution'],
              },
              rich_text: {},
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'anchor'],
            properties: {
              type: { const: 'add_linked_comment' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              associated_element_id: { type: 'string', minLength: 1 },
              anchor: { $ref: '#/$defs/textAnchor' },
              comment: { type: 'string', minLength: 1 },
              content: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              comment_type: {
                type: 'string',
                enum: ['explanation', 'correction', 'suggestion', 'question'],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'content'],
            properties: {
              type: { const: 'update_text_component' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              content: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'text'],
            properties: {
              type: { const: 'insert_text_heading' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              level: { type: 'integer', enum: [1, 2] },
              after_block_id: { type: 'string', minLength: 1 },
              before_block_id: { type: 'string', minLength: 1 },
              before_quote: { $ref: '#/$defs/textAnchor' },
              after_quote: { $ref: '#/$defs/textAnchor' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'anchor'],
            properties: {
              type: { const: 'highlight_text' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              anchor: { $ref: '#/$defs/textAnchor' },
              style: {
                type: 'string',
                enum: ['important', 'definition', 'warning', 'emphasis'],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'text'],
            properties: {
              type: { const: 'set_text_title' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id'],
            properties: {
              type: { const: 'remove_text_title' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'anchor'],
            properties: {
              type: { const: 'add_text_comment' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              anchor: { $ref: '#/$defs/textAnchor' },
              comment: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              comment_type: {
                type: 'string',
                enum: ['explanation', 'correction', 'suggestion', 'question'],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'comment_id'],
            properties: {
              type: { const: 'update_text_comment' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              comment_id: { type: 'string', minLength: 1 },
              comment: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'comment_id'],
            properties: {
              type: { const: 'remove_text_comment' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              comment_id: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'text'],
            properties: {
              type: { const: 'add_text_note' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
              note_type: {
                type: 'string',
                enum: [
                  'extra_information',
                  'important',
                  'caution',
                  'reference',
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'note_id', 'text'],
            properties: {
              type: { const: 'update_text_note' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              note_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'note_id'],
            properties: {
              type: { const: 'remove_text_note' },
              target_element_id: { type: 'string', minLength: 1 },
              target_id: { type: 'string', minLength: 1 },
              note_id: { type: 'string', minLength: 1 },
            },
          },
        ],
      },
    },
  },
  $defs: {
    textAnchor: {
      type: 'object',
      additionalProperties: false,
      required: ['quote'],
      properties: {
        quote: { type: 'string', minLength: 1 },
        block_id: { type: 'string', minLength: 1 },
        block_ref: { type: 'string', minLength: 1 },
        occurrence: { type: 'integer', minimum: 0 },
      },
    },
    graphExpression: {
      type: 'object',
      additionalProperties: false,
      required: ['expression'],
      properties: {
        expression: { type: 'string', minLength: 1 },
        visible: { type: 'boolean' },
        domain_min: { type: ['number', 'null'] },
        domain_max: { type: ['number', 'null'] },
      },
    },
    graphPoint: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        label: { type: 'string' },
        visible: { type: 'boolean' },
      },
    },
    graphViewport: {
      type: 'object',
      additionalProperties: false,
      required: ['x_min', 'x_max', 'y_min', 'y_max'],
      properties: {
        x_min: { type: 'number' },
        x_max: { type: 'number' },
        y_min: { type: 'number' },
        y_max: { type: 'number' },
      },
    },
    graphSettings: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: ['string', 'null'] },
        x_axis_label: { type: ['string', 'null'] },
        y_axis_label: { type: ['string', 'null'] },
        show_grid: { type: 'boolean' },
        show_x_axis: { type: 'boolean' },
        show_y_axis: { type: 'boolean' },
      },
    },
    hierarchyNode: {
      type: 'object',
      additionalProperties: false,
      required: ['content', 'children'],
      properties: {
        content: { type: 'string', minLength: 1 },
        children: {
          type: 'array',
          items: { $ref: '#/$defs/hierarchyNode' },
        },
      },
    },
    placement: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode'],
          properties: { mode: { const: 'viewport_default' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'anchor_element_id', 'relation'],
          properties: {
            mode: { const: 'relative_to_element' },
            anchor_element_id: { type: 'string', minLength: 1 },
            relation: {
              type: 'string',
              enum: ['left_of', 'right_of', 'above', 'below', 'near'],
            },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['mode', 'x', 'y'],
          properties: {
            mode: { const: 'absolute' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
        },
      ],
    },
    layoutRole: {
      type: 'string',
      enum: [
        'introduction',
        'explanation',
        'mathematical_step',
        'visualisation',
        'given_information',
        'final_result',
        'verification',
      ],
    },
    chronologicalGridLayout: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'placement'],
      properties: {
        type: { const: 'chronological_grid' },
        columns: { type: 'integer', minimum: 1, maximum: 4 },
        placement: { $ref: '#/$defs/placement' },
      },
    },
    gridLayout: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'columns', 'placement', 'items'],
      properties: {
        type: { const: 'grid' },
        columns: { type: 'integer', minimum: 1, maximum: 48 },
        placement: { $ref: '#/$defs/placement' },
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ref', 'row', 'column'],
            properties: {
              ref: { type: 'string', minLength: 1 },
              row: { type: 'integer', minimum: 0 },
              column: { type: 'integer', minimum: 0 },
              column_span: { type: 'integer', minimum: 1, maximum: 48 },
            },
          },
        },
      },
    },
    richText: {
      type: 'object',
      additionalProperties: false,
      required: ['blocks'],
      properties: {
        blocks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'spans'],
            properties: {
              id: { type: 'string', minLength: 1 },
              type: {
                type: 'string',
                enum: ['paragraph', 'heading', 'bullet', 'numbered'],
              },
              role: { type: 'string', enum: ['heading', 'body'] },
              spans: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['text'],
                  properties: {
                    text: { type: 'string' },
                    style: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        bold: { type: 'boolean' },
                        italic: { type: 'boolean' },
                        underline: { type: 'boolean' },
                        color: { type: 'string' },
                        highlight_color: { type: 'string' },
                        font_size: {
                          anyOf: [
                            { type: 'number' },
                            {
                              type: 'string',
                              enum: [
                                'heading_large',
                                'heading',
                                'subheading',
                                'body',
                                'small',
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** Compact human-readable contract for the copied LLM prompt. */
export const CANVAS_AGENT_OUTPUT_CONTRACT = `
Return ONLY valid JSON (no Markdown, no code fences, no prose).

Shape:
{
  "output_type": "lesson" | "step_by_step",  /* REQUIRED for multi-create educational plans; default lesson */
  "operations": [ /* one or more */ ],
  "layout": { /* REQUIRED when creating 2+ related objects — see LAYOUT */ }
}

OUTPUT TYPE:
- "lesson" — comprehensive topic coverage; chronological multi-column grid; up to 4 objects per layout_cell (vertical stack).
- "step_by_step" — derivations / worked solutions; ONE vertical column of cells; up to 2 objects per layout_cell (horizontal: explanation left, math/graph right).
Select from the user request (derive/solve/work through → step_by_step; explain/teach topic → lesson). Ambiguous → lesson. Respect explicit user requests.

create_text (general prose / main textbox — prefer create_text_component for textbook parts):
{
  "type": "create_text",
  "ref": "<temp id — required for multi-create layout>",
  "layout_cell": "<optional shared cell id — consecutive ops only>",
  "layout_role": "introduction"|"explanation"|"mathematical_step"|"visualisation"|"given_information"|"final_result"|"verification",
  "column_span": 1|2|3|4,  /* optional; lesson grid only */
  "text": "<plain string — optional if rich_text provided>",
  "rich_text": { /* optional structured formatting — see RICH TEXT */ },
  "placement":  /* omit when using response-level layout */
    { "mode": "viewport_default" }
    | { "mode": "relative_to_element", "anchor_element_id": "<id from context>", "relation": "left_of"|"right_of"|"above"|"below"|"near" }
    | { "mode": "absolute", "x": <number>, "y": <number> }
}

create_equation:
{
  "type": "create_equation",
  "ref": "<temp id for layout>",
  "layout_cell": "<optional shared cell id>",
  "layout_role": "mathematical_step"|"final_result"|…,
  "latex": "<LaTeX body without surrounding $$>",
  "placement": /* omit when using response-level layout */
}

update_text:
{
  "type": "update_text",
  "target_element_id": "<id from context>",
  "text": "<complete plain replacement — optional if rich_text>",
  "rich_text": { /* optional complete rich-text replacement */ }
}

TEXTBOOK COMPONENTS (preferred — app owns style, size, and placement; never send x/y/width/height/colours/fonts):
- create_text_component: { "type":"create_text_component", "component":"main_text"|"title"|"definition"|"example"|"warning"|"exercise", "content":"…", "ref":"<optional>", "associated_element_id":"<optional existing id or plan ref>", "variant":"warning"|"common_mistake"|"important_caution" }
  Title / definition / example / warning / exercise are SEPARATE editable TextElements. Headings are NOT — use insert_text_heading inside main text.
  Do NOT supply coordinates, dimensions, font sizes, colours, borders, padding, grid cells, or column indices for components.
- add_linked_comment: ONE op that highlights the phrase AND creates a permanently visible Comment TextElement nearby.
  { "type":"add_linked_comment", "target_element_id":"<id>", "anchor":{ "quote":"positive test charge", "occurrence":0 }, "comment":"…" }
  Identifying the subject phrase is NOT the same as specifying physical placement — the app places the comment.
  If a quote appears more than once, provide block_id or occurrence — never guess. Ambiguous anchors are rejected.
- update_text_component: { "type":"update_text_component", "target_element_id":"<component id>", "content":"…" }
  Prefer updating an existing title/example/definition/comment over creating a duplicate.

IN-DOCUMENT RICH TEXT (inside a Main TextElement — not separate canvas objects):
- insert_text_heading: REQUIRES an explicit position (after_block_id | before_block_id | before_quote | after_quote). Never omit it.
  { "type":"insert_text_heading", "target_element_id":"<id>", "text":"Field Direction", "level":1, "before_quote":{ "quote":"The direction of the field" } }
- highlight_text: ordinary emphasis without a comment. { "type":"highlight_text", "target_element_id":"<id>", "anchor":{ "quote":"vector quantity" }, "style":"important"|"definition"|"warning"|"emphasis" }
  Do NOT also create a linked comment for the same phrase unless the user asked for commentary.

WHEN TO USE COMPONENTS:
| User request | Operation |
| Comment on my notes / explain this sentence | add_linked_comment (one or a few precise anchors) |
| Add a definition / example / warning / exercise | create_text_component with that component |
| Give this a title | create_text_component title (or update existing) |
| Organise with headings | insert_text_heading inside existing main text |
| Highlight this (no commentary) | highlight_text |
| Rewrite this | update_text / update_text_component |

Rules:
- Prefer native components over simulating them with plain textboxes, shapes, or arrows.
- Features are optional — a simple explanation may need only main_text. Do not inflate lessons with redundant definitions, warnings, or comments.
- Do not highlight every important-looking phrase. Prefer comments that add information, identify an error, or clarify a difficult point.
- Never invent comment_id / block_id. Canonical target field is target_element_id.

RICH TEXT (optional on create_text / update_text):
{
  "rich_text": {
    "blocks": [
      { "type": "heading", "spans": [{ "text": "Title", "style": { "bold": true, "font_size": "heading", "color": "blue" } }] },
      { "type": "paragraph", "spans": [
          { "text": "Gauss's law", "style": { "bold": true, "highlight_color": "default" } },
          { "text": " relates flux to enclosed charge." }
      ]},
      { "type": "bullet", "spans": [{ "text": "Closed surface required." }] },
      { "type": "numbered", "spans": [{ "text": "First step." }] }
    ]
  }
}
Span style (all optional): bold, italic, underline, color (default|blue|green|red|orange|purple|grey|#hex),
highlight_color (same palette), font_size (heading_large|heading|subheading|body|small|number 10–48).
Use formatting intentionally — not every sentence needs colour/highlight.
Prefer one textbox with headings/lists over many tiny textboxes for emphasis.

GRID COLUMN LIMIT:
For N created objects: columns must satisfy 1 <= columns <= min(4, ceil(sqrt(N))).
Examples: 1→1, 2–4→2, 5–9→3, 10+→4. The app reflows/wraps if exceeded.

create_structured_note (ONLY when a note structure is selected):
{
  "type": "create_structured_note",
  "ref": "<temp id for layout>",
  "layout_cell": "<optional shared cell id>",
  "structure_id": "<exact selected structure id>",
  "fields": {
    "<field_id>": { "content": "<text for TEXT fields>" }
      | { "latex": "<LaTeX for EQUATION fields>" }
      | { "root": { "content": "...", "children": [ /* recursive */ ] } }
      | null
  },
  "placement": /* omit when using response-level layout */
}

create_graph (new interactive GraphElement):
{
  "type": "create_graph",
  "ref": "<temp id for layout>",
  "layout_cell": "<optional shared cell id>",
  "expressions": [
    { "expression": "x**2", "visible": true, "domain_min": null, "domain_max": null }
  ],
  "points": [],
  "viewport": { "x_min": -10, "x_max": 10, "y_min": -10, "y_max": 10 },
  "settings": {
    "title": null, "x_axis_label": null, "y_axis_label": null,
    "show_grid": true, "show_x_axis": true, "show_y_axis": true
  },
  "placement": /* omit when using response-level layout */
}

LAYOUT (mandatory for 2+ related creates that would otherwise all use viewport_default):

PREFERRED — chronological_grid (operation order is reading order; geometry depends on output_type):

LESSON example:
{
  "output_type": "lesson",
  "layout": { "type": "chronological_grid", "placement": { "mode": "viewport_default" } },
  "operations": [
    { "type": "create_text", "ref": "intro", "layout_cell": "cell_1", "layout_role": "introduction", "text": "…" },
    { "type": "create_equation", "ref": "eq", "layout_cell": "cell_1", "layout_role": "mathematical_step", "latex": "E=F/q" },
    { "type": "create_graph", "ref": "graph", "layout_cell": "cell_2", "layout_role": "visualisation", … }
  ]
}

STEP BY STEP example (explanation left, math/graph right; cells stack top→bottom):
{
  "output_type": "step_by_step",
  "layout": { "type": "chronological_grid", "placement": { "mode": "viewport_default" } },
  "operations": [
    { "type": "create_text", "ref": "s1e", "layout_cell": "step_1", "layout_role": "explanation", "text": "Restoring force obeys Hooke's law." },
    { "type": "create_equation", "ref": "s1m", "layout_cell": "step_1", "layout_role": "mathematical_step", "latex": "F=-kx" },
    { "type": "create_text", "ref": "s2e", "layout_cell": "step_2", "layout_role": "explanation", "text": "Apply Newton's second law." },
    { "type": "create_equation", "ref": "s2m", "layout_cell": "step_2", "layout_role": "mathematical_step", "latex": "m\\\\frac{d^2x}{dt^2}=-kx" },
    { "type": "create_equation", "ref": "final", "layout_cell": "result", "layout_role": "final_result", "latex": "x(t)=A\\\\cos(\\\\omega t+\\\\phi)" }
  ]
}
Rules:
- Emit creation operations in the order the learner should read them.
- Optional layout_cell groups consecutive creates into one cell (lesson max 4 vertical; step_by_step max 2 horizontal).
- Contiguous layout_cell members only — non-contiguous reuse is rejected.
- Omit layout_cell for a solo cell. Single-object step_by_step cells may be full-width (e.g. final_result).
- Prefer explanation + equation / explanation + graph pairs in step_by_step; do not invent filler objects.
- Optional layout_role is presentation metadata only — never reorder by role.
- Do NOT assign row/column or world coordinates. relationship_grid is rejected.

EXPLICIT grid (only when the user demands a specific arrangement):
{
  "layout": {
    "type": "grid",
    "columns": 1|2|3|4,
    "placement": { "mode": "viewport_default" } | relative | absolute,
    "items": [
      { "ref": "<matches operation.ref>", "row": 0, "column": 0, "column_span": 2 }
    ]
  }
}
Rules for explicit grid:
- Zero-based row/column. column_span defaults to 1; must not exceed columns.
- No two items may occupy the same cell. No nested grids. No row spanning. No per-item x/y.
- Column limit: 1 <= columns <= min(4, ceil(sqrt(N))); app reflows if exceeded.

Shared layout rules:
- The application measures sizes, computes positions, avoids overlaps, and places the WHOLE group.
- Do NOT put viewport_default on every child to bypass the layout.
- Single independent create may omit layout and use placement as before.
- Explicit relative_to_element / absolute on a single create remains valid without a layout.

GRAPH EDITING (only for GraphElements supplied in context — explicit selection or spatial neighbour; graphs are NOT semantically retrieved):
- add_graph_expression: { "type":"add_graph_expression", "graph_id":"<id>", "expression":{ "expression":"x**3", "visible":true, "domain_min":null, "domain_max":null } }
- update_graph_expression: { "type":"update_graph_expression", "graph_id":"<id>", "expression_id":"<id from context>", "expression":"x**2 + 2*x + 1" }  // PATCH — omit unchanged fields
- remove_graph_expression: { "type":"remove_graph_expression", "graph_id":"<id>", "expression_id":"<id>" }
- set_graph_expression_visibility: { "type":"set_graph_expression_visibility", "graph_id":"<id>", "expression_id":"<id>", "visible":false }
- update_graph_viewport: { "type":"update_graph_viewport", "graph_id":"<id>", "x_min":-5, "x_max":5 }  // PATCH — omit y to keep y
- update_graph_settings: { "type":"update_graph_settings", "graph_id":"<id>", "title":"Projectile Motion", "show_grid":false }  // PATCH
- add_graph_point: { "type":"add_graph_point", "graph_id":"<id>", "x":2, "y":4, "label":"A", "visible":true }
- update_graph_point: { "type":"update_graph_point", "graph_id":"<id>", "point_id":"<id>", "x":3, "y":9 }  // PATCH
- remove_graph_point: { "type":"remove_graph_point", "graph_id":"<id>", "point_id":"<id>" }

Never invent graph_id / expression_id / point_id. Application generates IDs for newly added expressions/points.
Minimal PATCH: do not reset unspecified curves/limits/settings.

GRAPH EXPRESSION SYNTAX (canonical code-style DSL — NOT LaTeX, NOT executable code):
- Use: x**2, 2*x + 1, sin(x), sqrt(x), 1/x, exp(-x**2), (x + 1)*(x - 1), pi*x, e**x
- Explicit * required (2*x, not 2x). Powers use ** (not ^).
- Independent variable is x only. Do NOT include "y =".
- Supported functions: sin, cos, tan, asin, acos, atan, sqrt, abs, exp, ln, log10
- Supported constants: pi, e
- Do NOT emit LaTeX (\\frac, \\sin, ^{}, $, $$) or programming code.

NODE_SECTION fields:
- Return hierarchy/content only under "root" (no x/y, no node IDs, no connectors).
- Respect MAX DEPTH and MAX TOTAL NODES from the selected structure.
- Leaf nodes use "children": [].
- The application creates TextElements + ConnectorElements and owns all geometry.

Rules:
- Never invent element IDs, node IDs, connector IDs, structure IDs, graph expression IDs, or point IDs.
- Prefer relative_to_element over absolute for "next to / below / above / left / right" of ONE object.
- Prefer chronological_grid for educational multi-element plans; use explicit grid only for user-specified arrangements.
- Never invent world coordinates to avoid overlaps — the application guarantees geometric validity.
- When a structure is selected and the user asks for new structured content, use create_structured_note — do NOT recreate the layout with create_text/create_equation/create_connector.
- Omit or null optional structure fields when there is no meaningful content.
- Use create_graph when the user asks to create a new graph/plot.
- Use create_equation for standalone LaTeX (not for graphing).
- Edit existing graphs only when that graph_id appears in supplied context (selection or spatial).
- Put multiple new curves in ONE create_graph unless the user asks for separate graphs.
- Defaults for create_graph: viewport ±10, show_grid/axes true, empty title/labels.
- Do not emit delete/move/resize/style/shape/connector operations.
- Do not invent structure geometry; the application owns layout and tree connectors.
`.trim();
