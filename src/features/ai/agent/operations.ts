/**
 * Canvas agent operations — TypeScript types + JSON Schema (single source).
 * Backend Pydantic models mirror this for future Structured Outputs.
 */

import type { TextStylePatch } from './textStyle';

export type { TextStylePatch } from './textStyle';

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
  /** Optional initial style (same patch schema as update_text_style). */
  style?: TextStylePatch;
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
  width?: number;
  height?: number;
};

export type DeleteTextOperation = {
  type: 'delete_text';
  target_element_id: string;
};

export type UpdateTextStyleOperation = {
  type: 'update_text_style';
  target_element_id: string;
  style: TextStylePatch;
};

export type CanvasOperation =
  | CreateTextOperation
  | UpdateTextOperation
  | MoveTextOperation
  | ResizeTextOperation
  | DeleteTextOperation
  | UpdateTextStyleOperation;

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

export const AI_TEXT_MIN_WIDTH = 80;
export const AI_TEXT_MIN_HEIGHT = 40;
export const AI_TEXT_MAX_WIDTH = 2400;
export const AI_TEXT_MAX_HEIGHT = 2400;

const TEXT_STYLE_PATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text_color: { type: 'string', minLength: 1 },
    background_color: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    bold: { type: 'boolean' },
    italic: { type: 'boolean' },
    underline: { type: 'boolean' },
  },
} as const;

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
              style: { $ref: '#/$defs/textStylePatch' },
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
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'style'],
            properties: {
              type: { const: 'update_text_style' },
              target_element_id: { type: 'string', minLength: 1 },
              style: { $ref: '#/$defs/textStylePatch' },
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
    textStylePatch: TEXT_STYLE_PATCH_SCHEMA,
  },
} as const;

/** Compact human-readable contract for the copied LLM prompt. */
export const CANVAS_AGENT_OUTPUT_CONTRACT = `
Return ONLY valid JSON (no Markdown, no code fences, no prose).

Shape:
{
  "operations": [ /* one or more */ ]
}

Shared style patch (all fields optional; only supplied fields change):
{
  "text_color": "#RRGGBB",
  "background_color": "#RRGGBB" | null | "transparent",
  "bold": true|false,
  "italic": true|false,
  "underline": true|false
}

create_text:
{
  "type": "create_text",
  "text": "<non-empty string>",
  "placement":
    { "mode": "viewport_default" }
    | { "mode": "relative_to_element", "anchor_element_id": "<id from context>", "relation": "left_of"|"right_of"|"above"|"below"|"near" }
    | { "mode": "absolute", "x": <number>, "y": <number> },
  "style": { /* optional TextStylePatch */ }
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

delete_text:
{
  "type": "delete_text",
  "target_element_id": "<id from context>"
}

update_text_style:
{
  "type": "update_text_style",
  "target_element_id": "<id from context>",
  "style": { /* at least one TextStylePatch field */ }
}

Rules:
- Never invent element IDs.
- Prefer #RRGGBB for colours.
- text_color = writing colour; background_color = textbox fill.
- Prefer relative_to_element over absolute for spatial relationships.
- delete_text only when the user clearly asks to delete/remove a textbox.
- Do not emit shape/image/connector/group/font-size/font-family operations.
`.trim();
