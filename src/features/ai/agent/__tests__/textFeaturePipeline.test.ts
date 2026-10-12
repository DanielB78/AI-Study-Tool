/**
 * Feature-operation pipeline tests: individual ops, mixed plans, ambiguity,
 * heading splits, overlapping decorations, atomic rollback, persistence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { plainTextToRichText, richTextToPlainText } from '../../../text/richText';
import {
  ensureBlockIds,
  blockPlainText,
} from '../../../text/textFeatures';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { parseCanvasAgentResponse, CanvasAgentParseError } from '../parser';
import { CanvasAgentExecuteError } from '../parseErrors';
import { parseTextFeatureOperation } from '../textFeatureOperations';

const BODY =
  'An electric field describes the force per unit positive test charge. The field direction uses a positive test charge.';

function seedElement(text = BODY): TextElement {
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText: ensureBlockIds(plainTextToRichText(text)),
    x: 100,
    y: 100,
    width: 400,
    height: 160,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 18,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.4,
    backgroundColor: '#ffffff',
    padding: 12,
    cornerRadius: 10,
  };
}

function reset(el: TextElement = seedElement()) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements: [el] },
    style: { ...DEFAULT_STYLE },
    selectedIds: ['text_12'],
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

function ctx() {
  return {
    allowedElementIds: new Set(['text_12']),
    elementTypes: new Map([['text_12', 'text']]),
  };
}

function getText(): TextElement {
  const el = useCanvasStore.getState().document.elements.find((e) => e.id === 'text_12');
  if (!el || el.type !== 'text') throw new Error('missing text_12');
  return el;
}

describe('text feature pipeline — individual operations', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('set_text_title', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          { type: 'set_text_title', target_element_id: 'text_12', text: 'Electric Fields' },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(getText().title?.text).toBe('Electric Fields');
  });

  it('insert_text_heading with before_quote splits paragraph', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'insert_text_heading',
            target_element_id: 'text_12',
            text: 'Direction',
            level: 1,
            before_quote: { quote: 'The field direction' },
          },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const blocks = getText().richText!.blocks;
    expect(blocks.some((b) => b.type === 'heading' && blockPlainText(b) === 'Direction')).toBe(
      true,
    );
    const headingIdx = blocks.findIndex((b) => b.type === 'heading');
    expect(headingIdx).toBeGreaterThan(0);
    expect(blockPlainText(blocks[headingIdx + 1]!)).toContain('The field direction');
  });

  it('rejects insert_text_heading without position at parse time', () => {
    expect(() =>
      parseTextFeatureOperation({
        type: 'insert_text_heading',
        target_element_id: 'text_12',
        text: 'Nope',
      }),
    ).toThrow(CanvasAgentParseError);
  });

  it('highlight_text applies ordinary highlight_color', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'highlight_text',
              target_element_id: 'text_12',
              anchor: { quote: 'electric field', occurrence: 0 },
              style: 'definition',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const spans = getText().richText!.blocks.flatMap((b) => b.spans);
    expect(spans.some((s) => s.style?.highlight_color === 'blue')).toBe(true);
  });

  it('add_text_comment uses linked_comment_id and rejects ambiguous quotes', () => {
    expect(() =>
      executeCanvasOperations(
        parseCanvasAgentResponse(
          JSON.stringify({
            operations: [
              {
                type: 'add_text_comment',
                target_element_id: 'text_12',
                anchor: { quote: 'positive test charge' },
                comment: 'Ambiguous without occurrence',
              },
            ],
          }),
          ctx(),
        ),
        createLiveAgentExecutorTarget(),
      ),
    ).toThrow(CanvasAgentExecuteError);

    // Document unchanged after failed transaction
    expect(getText().comments).toBeUndefined();
    expect(getText().title).toBeUndefined();

    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_text_comment',
              target_element_id: 'text_12',
              anchor: { quote: 'positive test charge', occurrence: 1 },
              comment: 'Second occurrence — conventional direction.',
              comment_type: 'explanation',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const el = getText();
    expect(el.comments).toHaveLength(1);
    expect(el.comments![0]!.anchor.occurrence ?? el.comments![0]!.anchor.start).toBeDefined();
    const spans = el.richText!.blocks.flatMap((b) => b.spans);
    expect(spans.some((s) => s.style?.linked_comment_id)).toBe(true);
  });

  it('add_text_note', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'add_text_note',
              target_element_id: 'text_12',
              text: 'Fields are vectors.',
              note_type: 'extra_information',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    expect(getText().notes?.[0]?.text).toBe('Fields are vectors.');
  });
});

describe('text feature pipeline — mixed ops & atomicity', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies a selective mixed plan with positioned heading + disambiguated comment', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          { type: 'set_text_title', target_element_id: 'text_12', text: 'Electric Fields' },
          {
            type: 'insert_text_heading',
            target_element_id: 'text_12',
            text: 'Definition',
            level: 1,
            before_quote: { quote: 'An electric field' },
          },
          {
            type: 'highlight_text',
            target_element_id: 'text_12',
            anchor: { quote: 'electric field', occurrence: 0 },
            style: 'definition',
          },
          {
            type: 'add_text_comment',
            target_element_id: 'text_12',
            anchor: { quote: 'positive test charge', occurrence: 0 },
            comment: 'Defines conventional direction.',
            comment_type: 'explanation',
          },
          {
            type: 'add_text_note',
            target_element_id: 'text_12',
            text: 'Vector quantity.',
          },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const el = getText();
    expect(el.title?.text).toBe('Electric Fields');
    expect(el.notes).toHaveLength(1);
    expect(el.comments).toHaveLength(1);
    expect(el.richText!.blocks.some((b) => b.type === 'heading')).toBe(true);
    const spans = el.richText!.blocks.flatMap((b) => b.spans);
    // Overlap coexistence: ordinary highlight and comment marks both present
    expect(spans.some((s) => s.style?.highlight_color === 'blue')).toBe(true);
    expect(spans.some((s) => s.style?.linked_comment_id)).toBe(true);
  });

  it('overlapping highlight then comment preserves both decorations', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'highlight_text',
              target_element_id: 'text_12',
              anchor: { quote: 'positive test charge', occurrence: 0 },
              style: 'important',
            },
            {
              type: 'add_text_comment',
              target_element_id: 'text_12',
              anchor: { quote: 'positive test charge', occurrence: 0 },
              comment: 'Correction note on the phrase.',
              comment_type: 'correction',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const marked = getText()
      .richText!.blocks.flatMap((b) => b.spans)
      .filter((s) => s.text.includes('positive') || s.style?.linked_comment_id);
    const withBoth = getText()
      .richText!.blocks.flatMap((b) => b.spans)
      .find((s) => s.style?.highlight_color && s.style?.linked_comment_id);
    expect(withBoth).toBeTruthy();
    expect(withBoth!.style!.highlight_color).toBe('default');
    void marked;
  });

  it('failed op rolls back earlier feature mutations (atomic)', () => {
    const before = structuredClone(getText());
    expect(() =>
      executeCanvasOperations(
        parseCanvasAgentResponse(
          JSON.stringify({
            operations: [
              {
                type: 'set_text_title',
                target_element_id: 'text_12',
                text: 'Should Not Stick',
              },
              {
                type: 'add_text_note',
                target_element_id: 'text_12',
                text: 'Also should not stick',
              },
              {
                type: 'add_text_comment',
                target_element_id: 'text_12',
                anchor: { quote: 'positive test charge' },
                comment: 'Ambiguous — fail here',
              },
            ],
          }),
          ctx(),
        ),
        createLiveAgentExecutorTarget(),
      ),
    ).toThrow(/Operation 3 \(add_text_comment\)/);

    const after = getText();
    expect(after.title).toEqual(before.title);
    expect(after.notes).toEqual(before.notes);
    expect(after.comments).toEqual(before.comments);
    expect(after.text).toBe(before.text);
  });

  it('execute error includes op index, type, target, and stage', () => {
    try {
      executeCanvasOperations(
        parseCanvasAgentResponse(
          JSON.stringify({
            operations: [
              {
                type: 'add_text_comment',
                target_element_id: 'text_12',
                anchor: { quote: 'this phrase is not present' },
                comment: 'x',
              },
            ],
          }),
          ctx(),
        ),
        createLiveAgentExecutorTarget(),
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CanvasAgentExecuteError);
      const e = err as CanvasAgentExecuteError;
      expect(e.opIndex).toBe(0);
      expect(e.opType).toBe('add_text_comment');
      expect(e.targetId).toBe('text_12');
      expect(e.stage).toBe('text_feature');
      expect(e.message).toContain('Operation 1');
      expect(e.causeMessage).toMatch(/Could not find quote/);
    }
  });

  it('successful mixed plan is one undo transaction', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'set_text_title', target_element_id: 'text_12', text: 'T' },
            {
              type: 'add_text_note',
              target_element_id: 'text_12',
              text: 'N',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    expect(getText().title).toBeTruthy();
    useCanvasStore.getState().undo();
    expect(getText().title).toBeUndefined();
    expect(getText().notes).toBeUndefined();
    useCanvasStore.getState().redo();
    expect(getText().title?.text).toBe('T');
    expect(getText().notes?.[0]?.text).toBe('N');
  });

  it('heading insertion then comment on later phrase still resolves', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'insert_text_heading',
              target_element_id: 'text_12',
              text: 'Intro',
              before_quote: { quote: 'An electric field' },
            },
            {
              type: 'add_text_comment',
              target_element_id: 'text_12',
              anchor: { quote: 'positive test charge', occurrence: 1 },
              comment: 'Second mention.',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    expect(getText().comments).toHaveLength(1);
    expect(richTextToPlainText(getText().richText!)).toContain('Intro');
  });

  it('persists features through document snapshot clone', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            { type: 'set_text_title', target_element_id: 'text_12', text: 'Persist Me' },
            {
              type: 'add_text_note',
              target_element_id: 'text_12',
              text: 'Note persists',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const snap = structuredClone(useCanvasStore.getState().document);
    const el = snap.elements.find((e) => e.id === 'text_12');
    expect(el?.type).toBe('text');
    if (el?.type === 'text') {
      expect(el.title?.text).toBe('Persist Me');
      expect(el.notes?.[0]?.text).toBe('Note persists');
    }
  });
});
