import { describe, expect, it } from 'vitest';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
} from '../parser';

const ctx = {
  allowedElementIds: new Set(['textbox_18', 'textbox_42', 'textbox_12']),
  elementTypes: new Map([
    ['textbox_18', 'text'],
    ['textbox_42', 'text'],
    ['textbox_12', 'text'],
  ]),
};

describe('parseCanvasAgentResponse', () => {
  it('parses valid create_text viewport_default', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_text',
          text: 'Electric flux measures field through a surface.',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.operations).toHaveLength(1);
    expect(res.operations[0]).toMatchObject({ type: 'create_text' });
  });

  it('parses valid update_text', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_text',
          target_element_id: 'textbox_18',
          text: 'Updated full text.',
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.operations[0]).toMatchObject({
      type: 'update_text',
      target_element_id: 'textbox_18',
    });
  });

  it('parses multiple operations', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_text',
          target_element_id: 'textbox_18',
          text: 'A',
        },
        {
          type: 'create_text',
          text: 'B',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_42',
            relation: 'near',
          },
        },
      ],
    });
    expect(parseCanvasAgentResponse(raw, ctx).operations).toHaveLength(2);
  });

  it('rejects unknown operation', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({ operations: [{ type: 'delete_element', target_element_id: 'x' }] }),
        ctx,
      ),
    ).toThrow(CanvasAgentParseError);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseCanvasAgentResponse('not json', ctx)).toThrow(/valid JSON/i);
  });

  it('rejects missing required property', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({ operations: [{ type: 'create_text', text: 'hi' }] }),
        ctx,
      ),
    ).toThrow(/placement/i);
  });

  it('rejects invented target ID', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'update_text', target_element_id: 'invented_99', text: 'nope' },
          ],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/i);
  });

  it('rejects invalid relative anchor', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text',
              text: 'hi',
              placement: {
                mode: 'relative_to_element',
                anchor_element_id: 'missing',
                relation: 'near',
              },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/anchor_element_id/i);
  });

  it('rejects invalid relation', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text',
              text: 'hi',
              placement: {
                mode: 'relative_to_element',
                anchor_element_id: 'textbox_12',
                relation: 'diagonal',
              },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/relation/i);
  });

  it('rejects empty text', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'update_text', target_element_id: 'textbox_18', text: '   ' },
          ],
        }),
        ctx,
      ),
    ).toThrow(/non-empty/i);
  });

  it('rejects invalid absolute coordinates', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text',
              text: 'hi',
              placement: { mode: 'absolute', x: Number.NaN, y: 10 },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/finite/i);
  });

  it('strips markdown fences', () => {
    const raw = '```json\n{"operations":[{"type":"create_text","text":"ok","placement":{"mode":"viewport_default"}}]}\n```';
    expect(parseCanvasAgentResponse(raw, ctx).operations).toHaveLength(1);
  });

  it('describeOperationPlan is human readable', () => {
    const lines = describeOperationPlan([
      {
        type: 'update_text',
        target_element_id: 'textbox_18',
        text: 'Hello',
      },
      {
        type: 'create_text',
        text: 'World',
        placement: {
          mode: 'relative_to_element',
          anchor_element_id: 'textbox_42',
          relation: 'right_of',
        },
      },
    ]);
    expect(lines[0]).toContain('UPDATE TEXT');
    expect(lines[0]).toContain('textbox_18');
    expect(lines[1]).toContain('CREATE TEXT');
    expect(lines[1]).toContain('right_of textbox_42');
  });
});
