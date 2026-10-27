import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { parseRichTextDocument } from '../../../text/richTextValidate';
import { isDisplayMathBlock, isInlineMathSpan } from '../../../text/richText';
import { listMathNodes } from '../../../text/textMath';
import { executeCanvasOperations } from '../executor';
import { parseCanvasAgentResponse } from '../parser';
import { createLiveAgentExecutorTarget } from '../liveExecutor';

function seedText(): TextElement {
  return {
    id: 'text_math_1',
    type: 'text',
    text: 'The restoring force is . Applying Newton gives:',
    richText: parseRichTextDocument({
      blocks: [
        {
          type: 'paragraph',
          id: 'blk1',
          spans: [
            { text: 'The restoring force is ' },
            { text: '. Applying Newton gives:' },
          ],
        },
      ],
    }),
    x: 40,
    y: 40,
    width: 400,
    height: 140,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    fontSize: 16,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.35,
    padding: 12,
    backgroundColor: null,
    cornerRadius: 0,
  };
}

function reset(els: TextElement[] = [seedText()]) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements: els },
    style: { ...DEFAULT_STYLE },
    selectedIds: [els[0]!.id],
    activeTool: 'select',
    editingTextId: null,
    editingShapeLabelId: null,
    past: [],
    future: [],
    historySuspended: false,
    marquee: null,
    draftPoints: null,
    draftShape: null,
    clipboard: [],
    snapGuides: [],
  });
}

function ctx(ids: string[]) {
  return {
    allowedElementIds: new Set(ids),
    elementTypes: new Map(ids.map((id) => [id, 'text' as const])),
  };
}

describe('text math agent operations', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
    reset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('parses create_text rich_text with inline and display math', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            ref: 'shm',
            rich_text: {
              blocks: [
                {
                  type: 'paragraph',
                  spans: [
                    { text: 'The restoring force is ' },
                    { type: 'inline_math', latex: 'F=-kx' },
                    { text: '.' },
                  ],
                },
                {
                  type: 'display_math',
                  latex: 'm\\frac{d^2x}{dt^2}=-kx',
                },
              ],
            },
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      { allowedElementIds: new Set() },
    );
    expect(plan.operations[0]!.type).toBe('create_text');
    const op = plan.operations[0] as {
      type: 'create_text';
      text: string;
      rich_text?: { blocks: unknown[] };
    };
    expect(op.text).toContain('[LaTeX: F=-kx]');
    expect(op.rich_text?.blocks).toHaveLength(2);
  });

  it('executes insert_inline_math and insert_display_math', () => {
    const id = 'text_math_1';
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'insert_inline_math',
            target_element_id: id,
            latex: 'F=-kx',
            after_text: 'The restoring force is ',
          },
          {
            type: 'insert_display_math',
            target_element_id: id,
            latex: 'm\\frac{d^2x}{dt^2}=-kx',
            after_block_id: 'blk1',
          },
        ],
      }),
      ctx([id]),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
    expect(el?.type).toBe('text');
    if (el?.type !== 'text') return;
    const nodes = listMathNodes(el.richText!);
    expect(nodes.some((n) => n.kind === 'inline' && n.latex === 'F=-kx')).toBe(true);
    expect(nodes.some((n) => n.kind === 'display')).toBe(true);
    expect(el.text).toContain('[LaTeX: F=-kx]');
    expect(el.richText!.blocks.some(isDisplayMathBlock)).toBe(true);
    const firstBlock = el.richText!.blocks[0]!;
    expect(firstBlock.type).toBe('paragraph');
    if (firstBlock.type === 'paragraph') {
      expect(firstBlock.spans.some((s) => isInlineMathSpan(s))).toBe(true);
    }
  });

  it('updates and removes math via agent ops', () => {
    const id = 'text_math_1';
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'insert_inline_math',
              target_element_id: id,
              latex: 'E=F/q',
              after_text: 'The restoring force is ',
            },
          ],
        }),
        ctx([id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    let el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
    expect(el?.type).toBe('text');
    if (el?.type !== 'text') return;
    const mathId = listMathNodes(el.richText!)[0]!.id;

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_math',
              target_element_id: id,
              math_id: mathId,
              latex: 'E=\\frac{F}{q}',
            },
          ],
        }),
        ctx([id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
    if (el?.type !== 'text') return;
    expect(listMathNodes(el.richText!)[0]!.latex).toBe('E=\\frac{F}{q}');

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'remove_text_math',
              target_element_id: id,
              math_id: mathId,
            },
          ],
        }),
        ctx([id]),
      ),
      createLiveAgentExecutorTarget(),
    );
    el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
    if (el?.type !== 'text') return;
    expect(listMathNodes(el.richText!)).toHaveLength(0);
  });
});
