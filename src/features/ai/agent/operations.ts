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

/**
 * Relative placement. Provide exactly one of:
 * - `anchor_element_id` (existing canvas element from context), or
 * - `anchor_operation_index` (0-based index into the SAME plan's operations).
 * If both are present, `anchor_element_id` is preferred at resolve time.
 */
export type RelativePlacement = {
  mode: 'relative_to_element';
  relation: PlacementRelation;
  anchor_element_id?: string;
  /** 0-based index into the same plan's operations (must be < current op). */
  anchor_operation_index?: number;
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

export type CreateEquationOperation = {
  type: 'create_equation';
  /** Canonical LaTeX (no $ / $$ fences). */
  latex: string;
  placement: Placement;
};

export type UpdateEquationOperation = {
  type: 'update_equation';
  target_element_id: string;
  latex: string;
};

export type MoveEquationOperation = {
  type: 'move_equation';
  target_element_id: string;
  placement: Placement;
};

export type ResizeEquationOperation = {
  type: 'resize_equation';
  target_element_id: string;
  width?: number;
  height?: number;
};

export type DeleteEquationOperation = {
  type: 'delete_equation';
  target_element_id: string;
};

export type CanvasOperation =
  | CreateTextOperation
  | UpdateTextOperation
  | MoveTextOperation
  | ResizeTextOperation
  | DeleteTextOperation
  | UpdateTextStyleOperation
  | CreateEquationOperation
  | UpdateEquationOperation
  | MoveEquationOperation
  | ResizeEquationOperation
  | DeleteEquationOperation;

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

const RELATIVE_PLACEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'relation'],
  properties: {
    mode: { const: 'relative_to_element' },
    relation: {
      type: 'string',
      enum: ['left_of', 'right_of', 'above', 'below', 'near'],
    },
    anchor_element_id: { type: 'string', minLength: 1 },
    anchor_operation_index: { type: 'integer', minimum: 0 },
  },
  anyOf: [
    { required: ['anchor_element_id'] },
    { required: ['anchor_operation_index'] },
  ],
} as const;

const PLACEMENT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { const: 'viewport_default' },
      },
    },
    RELATIVE_PLACEMENT_SCHEMA,
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
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'latex', 'placement'],
            properties: {
              type: { const: 'create_equation' },
              latex: { type: 'string', minLength: 1 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'latex'],
            properties: {
              type: { const: 'update_equation' },
              target_element_id: { type: 'string', minLength: 1 },
              latex: { type: 'string', minLength: 1 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id', 'placement'],
            properties: {
              type: { const: 'move_equation' },
              target_element_id: { type: 'string', minLength: 1 },
              placement: { $ref: '#/$defs/placement' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'target_element_id'],
            properties: {
              type: { const: 'resize_equation' },
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
              type: { const: 'delete_equation' },
              target_element_id: { type: 'string', minLength: 1 },
            },
          },
        ],
      },
    },
  },
  $defs: {
    placement: PLACEMENT_SCHEMA,
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

Shared relative placement (exactly one of anchor_element_id OR anchor_operation_index required;
if both are present, anchor_element_id is preferred):
{
  "mode": "relative_to_element",
  "relation": "left_of"|"right_of"|"above"|"below"|"near",
  "anchor_element_id": "<id from context>",
  "anchor_operation_index": <0-based index into THIS plan's operations>
}

create_text:
{
  "type": "create_text",
  "text": "<non-empty string>",
  "placement":
    { "mode": "viewport_default" }
    | { "mode": "relative_to_element", "relation": "...", "anchor_element_id": "..." }
    | { "mode": "relative_to_element", "relation": "...", "anchor_operation_index": 0 }
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

create_equation:
{
  "type": "create_equation",
  "latex": "<KaTeX-compatible LaTeX WITHOUT $ / $$ fences>",
  "placement": /* same placement modes as create_text */
}

update_equation:
{
  "type": "update_equation",
  "target_element_id": "<equation id from context>",
  "latex": "<complete replacement LaTeX, no $ fences>"
}

move_equation:
{
  "type": "move_equation",
  "target_element_id": "<equation id from context>",
  "placement": /* same placement modes */
}

resize_equation:
{
  "type": "resize_equation",
  "target_element_id": "<equation id from context>",
  "width": <positive number, optional>,
  "height": <positive number, optional>
}

delete_equation:
{
  "type": "delete_equation",
  "target_element_id": "<equation id from context>"
}

Rules:
- Never invent element IDs.
- Prefer #RRGGBB for colours.
- text_color = writing colour; background_color = textbox fill.
- Prefer relative_to_element over absolute for spatial relationships.
- Use create_equation for math (LaTeX). Use create_text for prose notes.
- Never wrap LaTeX in $...$ or $$...$$ — raw source only (e.g. "E=mc^2", "\\\\nabla\\\\cdot\\\\mathbf{E}=\\\\rho/\\\\varepsilon_0").
- anchor_operation_index must point to an earlier create_text or create_equation in the SAME plan.
- delete_text / delete_equation only when the user clearly asks to delete/remove.
- Do not emit shape/image/connector/group/font-size/font-family operations.
`.trim();
