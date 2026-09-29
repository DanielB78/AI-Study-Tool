import { describe, expect, it } from 'vitest';
import { describeOperationPlan, parseCanvasAgentResponse } from '../parser';

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
    expect(res.response.operations).toHaveLength(1);
    expect(res.response.operations[0]).toMatchObject({ type: 'create_text' });
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
    expect(res.response.operations[0]).toMatchObject({
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
    expect(parseCanvasAgentResponse(raw, ctx).response.operations).toHaveLength(2);
  });

  it('rejects unknown operation', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({ operations: [{ type: 'delete_element', target_element_id: 'x' }] }),
        ctx,
      ),
    ).toThrow(
      /Allowed: create_text, update_text, move_text, resize_text, delete_text, update_text_style, create_equation/,
    );
  });

  it('parses valid update_text_style', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_text_style',
          target_element_id: 'textbox_18',
          style: { text_color: 'blue', bold: true },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'update_text_style',
      target_element_id: 'textbox_18',
      style: { text_color: '#0000FF', bold: true },
    });
  });

  it('parses create_text with optional style', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_text',
          text: 'Styled note',
          placement: { mode: 'viewport_default' },
          style: { italic: true, background_color: '#FFFF00' },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'create_text',
      style: { italic: true, background_color: '#FFFF00' },
    });
  });

  it('rejects empty style on update_text_style', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_style',
              target_element_id: 'textbox_18',
              style: {},
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/at least one property/i);
  });

  it('rejects unknown style property', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_style',
              target_element_id: 'textbox_18',
              style: { font_size: 20 },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/Unknown style property/i);
  });

  it('rejects invalid colour in style', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_style',
              target_element_id: 'textbox_18',
              style: { text_color: 'not-a-colour' },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/Unsupported colour|Invalid hex|invalid/i);
  });

  it('rejects invented target on update_text_style', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_style',
              target_element_id: 'invented_99',
              style: { bold: true },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/i);
  });

  it('parses valid move_text', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'move_text',
          target_element_id: 'textbox_18',
          placement: {
            mode: 'relative_to_element',
            anchor_element_id: 'textbox_42',
            relation: 'below',
          },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'move_text',
      target_element_id: 'textbox_18',
    });
  });

  it('parses valid resize_text', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'resize_text',
          target_element_id: 'textbox_18',
          width: 360,
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'resize_text',
      target_element_id: 'textbox_18',
      width: 360,
    });
  });

  it('parses valid delete_text', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'delete_text',
          target_element_id: 'textbox_18',
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'delete_text',
      target_element_id: 'textbox_18',
    });
  });

  it('rejects move_text self_anchor', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'move_text',
              target_element_id: 'textbox_18',
              placement: {
                mode: 'relative_to_element',
                anchor_element_id: 'textbox_18',
                relation: 'near',
              },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/own placement anchor/i);
  });

  it('rejects resize_text without width or height', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [{ type: 'resize_text', target_element_id: 'textbox_18' }],
        }),
        ctx,
      ),
    ).toThrow(/width and\/or height/i);
  });

  it('rejects resize_text with invalid size', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'resize_text', target_element_id: 'textbox_18', width: 10 },
          ],
        }),
        ctx,
      ),
    ).toThrow(/between/i);
  });

  it('rejects delete_text with invented target', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [{ type: 'delete_text', target_element_id: 'invented_99' }],
        }),
        ctx,
      ),
    ).toThrow(/not in the supplied canvas context/i);
  });

  it('rejects invalid JSON', () => {
    expect(() => parseCanvasAgentResponse('not json', ctx)).toThrow(/structured JSON|valid JSON/i);
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
    expect(parseCanvasAgentResponse(raw, ctx).response.operations).toHaveLength(1);
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
      {
        type: 'delete_text',
        target_element_id: 'textbox_12',
      },
      {
        type: 'update_text_style',
        target_element_id: 'textbox_18',
        style: { bold: true, text_color: '#0000FF' },
      },
    ]);
    expect(lines[0]).toContain('UPDATE TEXT');
    expect(lines[0]).toContain('textbox_18');
    expect(lines[1]).toContain('CREATE TEXT');
    expect(lines[1]).toContain('right_of textbox_42');
    expect(lines[2]).toContain('⚠ DELETE TEXTBOX');
    expect(lines[2]).toContain('textbox_12');
    expect(lines[3]).toContain('STYLE TEXTBOX');
    expect(lines[3]).toContain('Bold: yes');
    expect(lines[3]).toContain('#0000FF');
  });

  it('parses create_equation and sanitizes fences', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_equation',
          latex: '$E=mc^2$',
          placement: { mode: 'viewport_default' },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: 'E=mc^2',
    });
  });

  it('parses update_equation for equation targets', () => {
    const eqCtx = {
      allowedElementIds: new Set(['eq_1', 'textbox_18']),
      elementTypes: new Map([
        ['eq_1', 'equation'],
        ['textbox_18', 'text'],
      ]),
    };
    const raw = JSON.stringify({
      operations: [
        {
          type: 'update_equation',
          target_element_id: 'eq_1',
          latex: 'F=ma',
        },
      ],
    });
    expect(parseCanvasAgentResponse(raw, eqCtx).response.operations[0]).toMatchObject({
      type: 'update_equation',
      latex: 'F=ma',
    });
  });

  it('rejects invalid latex on create_equation', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_equation',
              latex: '\\frac{1{2}',
              placement: { mode: 'viewport_default' },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/invalid|KaTeX|LaTeX/i);
  });

  it('rejects equation op targeting a text element', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_equation',
              target_element_id: 'textbox_18',
              latex: 'E=mc^2',
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/not an EquationElement/i);
  });

  it('accepts same-plan anchor_operation_index', () => {
    const raw = JSON.stringify({
      operations: [
        {
          type: 'create_text',
          text: 'Gauss note',
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_equation',
          latex: 'E=mc^2',
          placement: {
            mode: 'relative_to_element',
            relation: 'below',
            anchor_operation_index: 0,
          },
        },
      ],
    });
    const res = parseCanvasAgentResponse(raw, ctx);
    expect(res.response.operations).toHaveLength(2);
    expect(res.response.operations[1]).toMatchObject({
      type: 'create_equation',
      placement: {
        mode: 'relative_to_element',
        relation: 'below',
        anchor_operation_index: 0,
      },
    });
  });

  it('rejects anchor_operation_index that is not earlier', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_equation',
              latex: 'E=mc^2',
              placement: {
                mode: 'relative_to_element',
                relation: 'below',
                anchor_operation_index: 0,
              },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/anchor_operation_index/i);
  });

  it('describeOperationPlan includes CREATE EQUATION', () => {
    const lines = describeOperationPlan([
      {
        type: 'create_equation',
        latex: 'E=mc^2',
        placement: { mode: 'viewport_default' },
      },
    ]);
    expect(lines[0]).toContain('CREATE EQUATION');
    expect(lines[0]).toContain('E=mc^2');
  });
});
