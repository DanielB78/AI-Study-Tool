import { describe, expect, it } from 'vitest';
import { parseCanvasAgentResponse } from '../parser';

const ctx = {
  allowedElementIds: new Set<string>(),
  elementTypes: new Map<string, string>(),
};

describe('parseCanvasAgentResponse — rich_text', () => {
  it('accepts create_text with rich_text and derives plain text', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            rich_text: {
              blocks: [
                {
                  type: 'heading',
                  spans: [{ text: 'Electric Fields', style: { bold: true } }],
                },
                {
                  type: 'bullet',
                  spans: [{ text: 'Vector quantity' }],
                },
              ],
            },
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      ctx,
    );
    const op = res.operations[0]!;
    expect(op.type).toBe('create_text');
    if (op.type === 'create_text') {
      expect(op.rich_text?.blocks).toHaveLength(2);
      expect(op.text).toContain('Electric Fields');
      expect(op.text).toContain('Vector quantity');
    }
  });

  it('accepts update_text rich_text replacement', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'update_text',
            target_element_id: 't1',
            rich_text: {
              blocks: [{ type: 'paragraph', spans: [{ text: 'Updated', style: { italic: true } }] }],
            },
          },
        ],
      }),
      {
        allowedElementIds: new Set(['t1']),
        elementTypes: new Map([['t1', 'text']]),
      },
    );
    expect(res.operations[0]).toMatchObject({
      type: 'update_text',
      text: 'Updated',
    });
  });
});
