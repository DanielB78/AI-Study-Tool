/**
 * Canvas agent operations — TypeScript types + JSON Schema (single source).
 * Backend Pydantic models mirror this for future Structured Outputs.
 */

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
  /** 1–4 columns */
  columns: number;
  placement: Placement;
  items: GridLayoutItemSpec[];
};

export type CreateTextOperation = {
  type: 'create_text';
  text: string;
  /** Omitted when assigned via layout.items — parser defaults to viewport_default. */
  placement: Placement;
  /** Temporary ref for layout.items */
  ref?: OperationRef;
};

export type CreateEquationOperation = {
  type: 'create_equation';
  latex: string;
  placement: Placement;
  ref?: OperationRef;
};

export type UpdateTextOperation = {
  type: 'update_text';
  target_element_id: string;
  text: string;
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
  ref?: OperationRef;
};

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
  ref?: OperationRef;
};

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
  | RemoveGraphPointOperation;

export type CanvasAgentResponse = {
  operations: CanvasOperation[];
  /** Required when creating multiple related objects with viewport_default. */
  layout?: GridLayoutSpec;
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
    layout: { $ref: '#/$defs/gridLayout' },
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'text'],
            properties: {
              type: { const: 'create_text' },
              text: { type: 'string', minLength: 1 },
              ref: { type: 'string', minLength: 1 },
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
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'text'],
            properties: {
              type: { const: 'update_text' },
              target_element_id: { type: 'string', minLength: 1 },
              text: { type: 'string', minLength: 1 },
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
        ],
      },
    },
  },
  $defs: {
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
    gridLayout: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'columns', 'placement', 'items'],
      properties: {
        type: { const: 'grid' },
        columns: { type: 'integer', minimum: 1, maximum: 4 },
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
              column_span: { type: 'integer', minimum: 1, maximum: 4 },
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
  "operations": [ /* one or more */ ],
  "layout": { /* REQUIRED when creating 2+ related objects — see GRID LAYOUT */ }
}

create_text:
{
  "type": "create_text",
  "ref": "<temp id for layout — required when using layout>",
  "text": "<non-empty string>",
  "placement":  /* omit when item is in layout.items */
    { "mode": "viewport_default" }
    | { "mode": "relative_to_element", "anchor_element_id": "<id from context>", "relation": "left_of"|"right_of"|"above"|"below"|"near" }
    | { "mode": "absolute", "x": <number>, "y": <number> }
}

create_equation:
{
  "type": "create_equation",
  "ref": "<temp id for layout>",
  "latex": "<LaTeX body without surrounding $$>",
  "placement": /* omit when in layout.items */
}

update_text:
{
  "type": "update_text",
  "target_element_id": "<id from context>",
  "text": "<complete replacement text>"
}

create_structured_note (ONLY when a note structure is selected):
{
  "type": "create_structured_note",
  "ref": "<temp id for layout>",
  "structure_id": "<exact selected structure id>",
  "fields": {
    "<field_id>": { "content": "<text for TEXT fields>" }
      | { "latex": "<LaTeX for EQUATION fields>" }
      | { "root": { "content": "...", "children": [ /* recursive */ ] } }
      | null
  },
  "placement": /* omit when in layout.items */
}

create_graph (new interactive GraphElement):
{
  "type": "create_graph",
  "ref": "<temp id for layout>",
  "expressions": [
    { "expression": "x**2", "visible": true, "domain_min": null, "domain_max": null }
  ],
  "points": [],
  "viewport": { "x_min": -10, "x_max": 10, "y_min": -10, "y_max": 10 },
  "settings": {
    "title": null, "x_axis_label": null, "y_axis_label": null,
    "show_grid": true, "show_x_axis": true, "show_y_axis": true
  },
  "placement": /* omit when in layout.items */
}

GRID LAYOUT (mandatory for 2+ related creates that would otherwise all use viewport_default):
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
Rules for layout:
- Assign every created item (create_text / create_equation / create_graph / create_structured_note) to exactly one cell via ref.
- Zero-based row/column. column_span defaults to 1; must not exceed columns.
- No two items may occupy the same cell. No nested grids. No row spanning. No per-item x/y.
- The application measures sizes, computes positions, avoids overlaps, and places the WHOLE grid.
- Do NOT put viewport_default on every child to bypass the grid.
- Single independent create may omit layout and use placement as before.
- Explicit relative_to_element / absolute on a single create remains valid without a grid.

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
- Prefer a grid layout (layout.placement viewport_default) when creating multiple related objects with no location.
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
