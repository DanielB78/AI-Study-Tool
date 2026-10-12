import { describe, expect, it } from 'vitest';
import { parseCanvasAgentResponse } from '../parser';

const ctx = {
  allowedElementIds: new Set(['text_12', 'textbox_18']),
  elementTypes: new Map([
    ['text_12', 'text'],
    ['textbox_18', 'text'],
  ]),
};

describe('parseCanvasAgentResponse — text features', () => {
  it('parses set_text_title with target_id alias', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          { type: 'set_text_title', target_id: 'text_12', text: 'Electric Fields' },
        ],
      }),
      ctx,
    );
    expect(res.operations[0]).toMatchObject({
      type: 'set_text_title',
      target_element_id: 'text_12',
      text: 'Electric Fields',
    });
  });

  it('parses create_text with title, notes, comments', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            ref: 'field_notes',
            title: 'Electric Fields',
            text: 'Force per unit positive test charge.',
            notes: [
              {
                text: 'Electric fields are vector quantities.',
                note_type: 'extra_information',
              },
            ],
            comments: [
              {
                anchor: { quote: 'positive test charge' },
                comment: 'Defines conventional direction.',
                comment_type: 'explanation',
              },
            ],
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      ctx,
    );
    const op = res.operations[0];
    expect(op.type).toBe('create_text');
    if (op.type === 'create_text') {
      expect(op.title).toBe('Electric Fields');
      expect(op.notes).toHaveLength(1);
      expect(op.comments).toHaveLength(1);
      expect(op.comments![0]!.anchor.quote).toBe('positive test charge');
    }
  });

  it('rejects feature ops on unknown targets', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_text_note',
              target_element_id: 'invented_99',
              text: 'Nope',
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/);
  });

  it('parses highlight_text and insert_text_heading with position', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'highlight_text',
            target_element_id: 'text_12',
            anchor: { quote: 'vector', occurrence: 0 },
            style: 'important',
          },
          {
            type: 'insert_text_heading',
            target_element_id: 'text_12',
            text: 'Field Direction',
            level: 1,
            before_quote: { quote: 'vector' },
          },
        ],
      }),
      ctx,
    );
    expect(res.operations).toHaveLength(2);
    expect(res.operations[0]?.type).toBe('highlight_text');
    expect(res.operations[1]?.type).toBe('insert_text_heading');
    if (res.operations[1]?.type === 'insert_text_heading') {
      expect(res.operations[1].before_quote?.quote).toBe('vector');
    }
  });

  it('rejects insert_text_heading without position', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'insert_text_heading',
              target_element_id: 'text_12',
              text: 'Field Direction',
              level: 1,
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/requires a position/);
  });
});
