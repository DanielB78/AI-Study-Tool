/**
 * Decision fixtures — expected planner behavior (no live LLM).
 * Mirrors examples in prompts/canvas_editor_system.md.
 */

import { describe, expect, it } from 'vitest';
import { parseCanvasAgentResponse } from '../parser';
import type { CanvasOperation } from '../operations';

const electricityCtx = {
  allowedElementIds: new Set(['textbox_1', 'textbox_2', 'textbox_3']),
  elementTypes: new Map([
    ['textbox_1', 'text'],
    ['textbox_2', 'text'],
    ['textbox_3', 'text'],
  ]),
};

/** Documented expected JSON for common user intents. */
export const PLANNER_DECISION_FIXTURES: Array<{
  id: string;
  user: string;
  expected: CanvasOperation[];
  notes: string;
}> = [
  {
    id: 'create-note-about-x',
    user: 'Create a note describing electric flux.',
    notes: 'No edit wording → create with viewport_default (do not overwrite related notes).',
    expected: [
      {
        type: 'create_text',
        text: 'Electric flux measures how much electric field passes through a surface.',
        placement: { mode: 'viewport_default' },
      },
    ],
  },
  {
    id: 'edit-the-x-note',
    user: 'Edit the electricity note.',
    notes: 'Explicit edit → update_text on the matching context id.',
    expected: [
      {
        type: 'update_text',
        target_element_id: 'textbox_1',
        text: 'Electricity involves electric charges and their interactions. Updated detail…',
      },
    ],
  },
  {
    id: 'make-x-shorter',
    user: 'Make the electric potential textbox shorter.',
    notes: 'Shorten wording → update_text.',
    expected: [
      {
        type: 'update_text',
        target_element_id: 'textbox_3',
        text: 'Electric potential is potential energy per unit charge.',
      },
    ],
  },
  {
    id: 'write-y-next-to-x',
    user: 'Write a textbox explaining electric fields next to the electricity note.',
    notes: 'Beside / next to → create relative near (do not overwrite electricity).',
    expected: [
      {
        type: 'create_text',
        text: 'An electric field describes the force a charge would experience at each point in space.',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_1',
          relation: 'near',
        },
      },
    ],
  },
  {
    id: 'put-note-below-x',
    user: "Add an explanation underneath the Gauss's law note.",
    notes: 'Under / below → create relative below.',
    expected: [
      {
        type: 'create_text',
        text: 'Spherical symmetry keeps |E| constant on a Gaussian sphere.',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_2',
          relation: 'below',
        },
      },
    ],
  },
  {
    id: 'write-about-x-no-edit',
    user: 'Write about electric flux.',
    notes:
      'Relevant Gauss note may be retrieved, but without edit instruction prefer create.',
    expected: [
      {
        type: 'create_text',
        text: 'Electric flux is the surface integral of the electric field.',
        placement: { mode: 'viewport_default' },
      },
    ],
  },
  {
    id: 'move-below',
    user: 'Move the electric field note below the potential note.',
    notes: 'Explicit move → move_text relative below.',
    expected: [
      {
        type: 'move_text',
        target_element_id: 'textbox_1',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_3',
          relation: 'below',
        },
      },
    ],
  },
  {
    id: 'resize-wider',
    user: 'Make the electricity note wider.',
    notes: 'Qualitative resize → resize_text with a larger width.',
    expected: [
      {
        type: 'resize_text',
        target_element_id: 'textbox_1',
        width: 360,
      },
    ],
  },
  {
    id: 'delete-note',
    user: 'Delete the electric potential textbox.',
    notes: 'Clear delete intent → delete_text.',
    expected: [
      {
        type: 'delete_text',
        target_element_id: 'textbox_3',
      },
    ],
  },
];

describe('planner decision fixtures', () => {
  for (const fixture of PLANNER_DECISION_FIXTURES) {
    it(`${fixture.id}: parses as expected planner shape`, () => {
      const raw = JSON.stringify({ operations: fixture.expected });
      const parsed = parseCanvasAgentResponse(raw, electricityCtx);
      expect(parsed.operations).toEqual(fixture.expected);
    });
  }

  it('similarity-related create must not invent update_text on Gauss note', () => {
    // USER: create flux definition next to Gauss — highest similarity may be textbox_2
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_text',
          text: 'Electric flux definition…',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_2',
            relation: 'near',
          },
        },
      ],
    });
    const ops = parseCanvasAgentResponse(raw, electricityCtx).operations;
    expect(ops.every((o) => o.type === 'create_text')).toBe(true);
    expect(ops.some((o) => o.type === 'update_text')).toBe(false);
  });
});
