import { describe, expect, it } from 'vitest';
import { CanvasAgentParseError, parseCanvasAgentResponse } from '../parser';

const ctx = {
  allowedElementIds: new Set<string>(['textbox_1']),
  elementTypes: new Map([['textbox_1', 'text']]),
};

describe('parseCanvasAgentResponse — grid layout', () => {
  it('accepts a valid 2-column grid plan', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          { type: 'create_text', ref: 'title', text: 'Title' },
          { type: 'create_text', ref: 'body', text: 'Body text' },
        ],
        layout: {
          type: 'grid',
          columns: 2,
          placement: { mode: 'viewport_default' },
          items: [
            { ref: 'title', row: 0, column: 0, column_span: 2 },
            { ref: 'body', row: 1, column: 0 },
          ],
        },
      }),
      ctx,
    );
    expect(res.layout?.columns).toBe(2);
    expect(res.layout?.items).toHaveLength(2);
    expect(res.operations[0]).toMatchObject({ ref: 'title' });
  });

  it('Test H — rejects overlapping grid cells', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'create_text', ref: 'a', text: 'A' },
            { type: 'create_text', ref: 'b', text: 'B' },
          ],
          layout: {
            type: 'grid',
            columns: 2,
            placement: { mode: 'viewport_default' },
            items: [
              { ref: 'a', row: 0, column: 0, column_span: 2 },
              { ref: 'b', row: 0, column: 1 },
            ],
          },
        }),
        ctx,
      ),
    ).toThrow(/occupied/);
  });

  it('Test I — rejects unknown layout ref', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [{ type: 'create_text', ref: 'a', text: 'A' }],
          layout: {
            type: 'grid',
            columns: 1,
            placement: { mode: 'viewport_default' },
            items: [{ ref: 'missing', row: 0, column: 0 }],
          },
        }),
        ctx,
      ),
    ).toThrow(/unknown ref/);
  });

  it('rejects multi-create viewport_default without layout', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text',
              text: 'A',
              placement: { mode: 'viewport_default' },
            },
            {
              type: 'create_text',
              text: 'B',
              placement: { mode: 'viewport_default' },
            },
          ],
        }),
        ctx,
      ),
    ).toThrow(/grid "layout"/);
  });

  it('allows multi-create with explicit relative placements and no layout', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            text: 'A',
            placement: {
              mode: 'relative_to_element',
              anchor_element_id: 'textbox_1',
              relation: 'below',
            },
          },
          {
            type: 'create_text',
            text: 'B',
            placement: {
              mode: 'relative_to_element',
              anchor_element_id: 'textbox_1',
              relation: 'right_of',
            },
          },
        ],
      }),
      ctx,
    );
    expect(res.layout).toBeUndefined();
    expect(res.operations).toHaveLength(2);
  });

  it('parses create_equation', () => {
    const res = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_equation',
            latex: 'E=mc^2',
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      ctx,
    );
    expect(res.operations[0]).toMatchObject({
      type: 'create_equation',
      latex: 'E=mc^2',
    });
  });

  it('rejects column span past grid width', () => {
    expect(() =>
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [{ type: 'create_text', ref: 'a', text: 'A' }],
          layout: {
            type: 'grid',
            columns: 2,
            placement: { mode: 'viewport_default' },
            items: [{ ref: 'a', row: 0, column: 1, column_span: 2 }],
          },
        }),
        ctx,
      ),
    ).toThrow(CanvasAgentParseError);
  });
});
