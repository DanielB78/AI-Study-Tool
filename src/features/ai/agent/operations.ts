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

export type CreateTextOperation = {
  type: 'create_text';
  text: string;
  placement: Placement;
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
 * Does NOT edit existing graphs — create only.
 */
export type CreateGraphOperation = {
  type: 'create_graph';
  expressions: CreateGraphExpressionSpec[];
  points: CreateGraphPointSpec[];
  viewport: CreateGraphViewportSpec;
  settings: CreateGraphSettingsSpec;
  placement: Placement;
};

export type CanvasOperation =
  | CreateTextOperation
  | UpdateTextOperation
  | CreateStructuredNoteOperation
  | CreateGraphOperation;

export type CanvasAgentResponse = {
  operations: CanvasOperation[];
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
    operations: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'text', 'placement'],
            properties: {
              type: { const: 'create_text' },
              text: { type: 'string', minLength: 1 },
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
            required: ['type', 'structure_id', 'fields', 'placement'],
            properties: {
              type: { const: 'create_structured_note' },
              structure_id: { type: 'string', minLength: 1 },
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
              'placement',
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
              placement: { $ref: '#/$defs/placement' },
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
  },
} as const;

/** Compact human-readable contract for the copied LLM prompt. */
export const CANVAS_AGENT_OUTPUT_CONTRACT = `
Return ONLY valid JSON (no Markdown, no code fences, no prose).

Shape:
{
  "operations": [ /* one or more */ ]
}

create_text:
{
  "type": "create_text",
  "text": "<non-empty string>",
  "placement":
    { "mode": "viewport_default" }
    | { "mode": "relative_to_element", "anchor_element_id": "<id from context>", "relation": "left_of"|"right_of"|"above"|"below"|"near" }
    | { "mode": "absolute", "x": <number>, "y": <number> }
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
  "structure_id": "<exact selected structure id>",
  "fields": {
    "<field_id>": { "content": "<text for TEXT fields>" }
      | { "latex": "<LaTeX for EQUATION fields>" }
      | { "root": { "content": "...", "children": [ /* recursive */ ] } }
      | null
  },
  "placement": { "mode": "viewport_default" } | ...
}

create_graph (NEW interactive GraphElement only — never edit existing graphs):
{
  "type": "create_graph",
  "expressions": [
    {
      "expression": "x**2",
      "visible": true,
      "domain_min": null,
      "domain_max": null
    }
  ],
  "points": [],
  "viewport": { "x_min": -10, "x_max": 10, "y_min": -10, "y_max": 10 },
  "settings": {
    "title": null,
    "x_axis_label": null,
    "y_axis_label": null,
    "show_grid": true,
    "show_x_axis": true,
    "show_y_axis": true
  },
  "placement": { "mode": "viewport_default" } | ...
}

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
- Never invent element IDs, node IDs, connector IDs, or structure IDs.
- Prefer relative_to_element over absolute for "next to / below / above / left / right".
- Prefer viewport_default when the user gives no location.
- When a structure is selected and the user asks for new structured content, use create_structured_note — do NOT recreate the layout with create_text/create_equation/create_connector.
- Omit or null optional structure fields when there is no meaningful content.
- Use create_graph only when the user asks to graph/plot/draw a function visually.
- Put multiple curves in ONE create_graph unless the user asks for separate graphs.
- Defaults: viewport ±10, show_grid/axes true, empty title/labels — omit unusual values.
- Do NOT emit update_graph / add_graph_expression / remove_graph_expression / delete graph.
- Do NOT edit existing GraphElements even if they appear in context or selection.
- Do not emit delete/move/resize/style/shape/connector operations.
- Do not invent structure geometry; the application owns layout and tree connectors.
`.trim();
