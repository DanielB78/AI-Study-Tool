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

export type MoveTextOperation = {
  type: 'move_text';
  target_element_id: string;
  placement: Placement;
};

export type ResizeTextOperation = {
  type: 'resize_text';
  target_element_id: string;
  /** New width in world units (omit to keep current). */
  width?: number;
  /** New height in world units (omit to keep current). */
  height?: number;
};

export type DeleteTextOperation = {
  type: 'delete_text';
  target_element_id: string;
};

export type CanvasOperation =
  | CreateTextOperation
  | UpdateTextOperation
  | MoveTextOperation
  | ResizeTextOperation
  | DeleteTextOperation;

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

/** Centralized AI textbox size limits (world units). */
export const AI_TEXT_MIN_WIDTH = 80;
export const AI_TEXT_MIN_HEIGHT = 40;
export const AI_TEXT_MAX_WIDTH = 2400;
export const AI_TEXT_MAX_HEIGHT = 2400;

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
            required: ['type', 'target_element_id', 'placement'],
            properties: {
              type: { const: 'move_text' },
              target_element_id: { type: 'string', minLength: 1 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id'],
            properties: {
              type: { const: 'resize_text' },
              target_element_id: { type: 'string', minLength: 1 },
              width: { type: 'number' },
              height: { type: 'number' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id'],
            properties: {
              type: { const: 'delete_text' },
              target_element_id: { type: 'string', minLength: 1 },
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
          properties: {
            mode: { const: 'viewport_default' },
          },
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

move_text:
{
  "type": "move_text",
  "target_element_id": "<id from context>",
  "placement": /* same placement modes as create_text */
}

resize_text:
{
  "type": "resize_text",
  "target_element_id": "<id from context>",
  "width": <positive number, optional>,
  "height": <positive number, optional>
}
(At least one of width/height required. Omitting one preserves the current value.)

delete_text:
{
  "type": "delete_text",
  "target_element_id": "<id from context>"
}

Rules:
- Never invent element IDs.
- Prefer relative_to_element over absolute for "next to / below / above / left / right".
- Prefer viewport_default when creating with no location.
- Prefer relative placement for moves when the user describes a relationship.
- delete_text only when the user clearly asks to delete/remove/get rid of a textbox.
- Do not emit shape/image/connector/style/group operations.
`.trim();
