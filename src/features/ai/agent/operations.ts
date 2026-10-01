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

export type StructuredFieldPayload =
  | StructuredTextFieldPayload
  | StructuredEquationFieldPayload
  | null;

export type CreateStructuredNoteOperation = {
  type: 'create_structured_note';
  structure_id: string;
  /** field_id → payload; optional fields may be omitted or null */
  fields: Record<string, StructuredFieldPayload>;
  placement: Placement;
};

export type CanvasOperation =
  | CreateTextOperation
  | UpdateTextOperation
  | CreateStructuredNoteOperation;

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
                    { type: 'null' },
                  ],
                },
              },
              placement: { $ref: '#/$defs/placement' },
            },
          },
        ],
      },
    },
  },
  $defs: {
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
      | null
  },
  "placement": { "mode": "viewport_default" } | ...
}

Rules:
- Never invent element IDs or structure IDs.
- Prefer relative_to_element over absolute for "next to / below / above / left / right".
- Prefer viewport_default when the user gives no location.
- When a structure is selected and the user asks for new structured content, use create_structured_note — do NOT recreate the layout with create_text/create_equation.
- Omit or null optional structure fields when there is no meaningful content.
- Do not emit delete/move/resize/style/shape/connector operations.
- Do not invent structure geometry; the application owns layout.
`.trim();
