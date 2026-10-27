import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../../types/canvas';
import { DEFAULT_STYLE } from '../../../types/canvas';
import { plainTextToRichText, richTextToPlainText } from '../richText';
import { measureTextElementWithFeatures } from '../textAutoSizer';
import {
  addCommentToElement,
  addNoteToElement,
  composeTextElementIndexText,
  ensureBlockIds,
  findQuoteOffsets,
  highlightQuoteInElement,
  insertHeadingInElement,
  removeCommentFromElement,
  removeNoteFromElement,
  removeTitleFromElement,
  resolveQuoteAnchor,
  setTitleOnElement,
  updateCommentOnElement,
  updateNoteOnElement,
} from '../textFeatures';
import {
  applyTextFeatureOperation,
  parseTextFeatureOperation,
} from '../../ai/agent/textFeatureOperations';

function baseText(text: string, overrides: Partial<TextElement> = {}): TextElement {
  const richText = ensureBlockIds(plainTextToRichText(text));
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText,
    x: 0,
    y: 0,
    width: 320,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 0,
    updatedAt: 0,
    metadata: {},
    fontSize: DEFAULT_STYLE.fontSize,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: DEFAULT_STYLE.textColor,
    alignment: 'left',
    lineHeight: DEFAULT_STYLE.lineHeight,
    backgroundColor: '#ffffff',
    padding: 12,
    cornerRadius: 10,
    ...overrides,
  };
}

describe('textFeatures — title / notes / headings / highlights', () => {
  it('plain textbox without features stays valid', () => {
    const el = baseText('Hello world');
    expect(el.title).toBeUndefined();
    expect(el.notes).toBeUndefined();
    expect(el.comments).toBeUndefined();
    expect(composeTextElementIndexText(el)).toBe('Hello world');
  });

  it('set / remove title', () => {
    let el = setTitleOnElement(baseText('Body'), 'Electric Fields');
    expect(el.title?.text).toBe('Electric Fields');
    expect(el.title?.id).toMatch(/^title_/);
    el = removeTitleFromElement(el);
    expect(el.title).toBeUndefined();
  });

  it('add / update / remove notes', () => {
    let el = baseText('Body');
    const { element, noteId } = addNoteToElement(el, 'Vector quantity.', 'extra_information');
    el = element;
    expect(el.notes).toHaveLength(1);
    expect(el.notes![0]!.id).toBe(noteId);
    el = updateNoteOnElement(el, noteId, { text: 'Updated note.' });
    expect(el.notes![0]!.text).toBe('Updated note.');
    el = removeNoteFromElement(el, noteId);
    expect(el.notes).toBeUndefined();
  });

  it('insert heading into rich text flow requires position', () => {
    const el = baseText('An electric field describes force.');
    expect(() =>
      insertHeadingInElement(el, { text: 'Definition', level: 1 }),
    ).toThrow(/requires a position/);
    const { element, blockId } = insertHeadingInElement(el, {
      text: 'Definition',
      level: 1,
      beforeQuote: { quote: 'An electric field' },
    });
    expect(blockId).toMatch(/^heading_/);
    expect(element.richText!.blocks[0]!.type).toBe('heading');
    expect(richTextToPlainText(element.richText!)).toContain('Definition');
  });

  it('highlight quote applies highlight_color', () => {
    const el = highlightQuoteInElement(baseText('The field is a vector quantity.'), {
      quote: 'vector quantity',
      style: 'definition',
    });
    const spans = el.richText!.blocks.flatMap((b) =>
      'spans' in b && Array.isArray(b.spans) ? b.spans : [],
    );
    expect(spans.some((s) => 'style' in s && s.style?.highlight_color === 'blue')).toBe(true);
  });

  it('measure includes title and notes height', () => {
    let el = setTitleOnElement(baseText('Short body.'), 'A Longer Title For Sizing');
    el = addNoteToElement(el, 'A supplementary note that should grow the box.').element;
    const bodyOnly = measureTextElementWithFeatures(
      { ...el, title: undefined, notes: undefined },
      { availableWidth: el.width },
    );
    const withFeatures = measureTextElementWithFeatures(el, {
      availableWidth: el.width,
    });
    expect(withFeatures.height).toBeGreaterThan(bodyOnly.height);
  });
});

describe('textFeatures — linked comments', () => {
  it('A: basic comment anchors and highlights', () => {
    const el = baseText(
      'The field direction is defined using a positive test charge.',
    );
    const { element, commentId } = addCommentToElement(el, {
      anchor: { quote: 'positive test charge' },
      text: 'Defines conventional direction.',
      commentType: 'explanation',
    });
    expect(commentId).toMatch(/^comment_/);
    expect(element.comments).toHaveLength(1);
    expect(element.comments![0]!.anchor.status).toBe('resolved');
    expect(element.comments![0]!.displayState).toBe('collapsed');
    const spans = element.richText!.blocks.flatMap((b) =>
      'spans' in b && Array.isArray(b.spans) ? b.spans : [],
    );
    expect(
      spans.some((s) => 'style' in s && s.style?.linked_comment_id === commentId),
    ).toBe(true);
  });

  it('B: multiple comments on separate phrases', () => {
    let el = baseText('Alpha one. Beta two. Gamma three.');
    el = addCommentToElement(el, {
      anchor: { quote: 'Alpha one' },
      text: 'Comment A',
    }).element;
    el = addCommentToElement(el, {
      anchor: { quote: 'Gamma three' },
      text: 'Comment C',
    }).element;
    expect(el.comments).toHaveLength(2);
    expect(el.comments!.map((c) => c.anchor.quote)).toEqual([
      'Alpha one',
      'Gamma three',
    ]);
  });

  it('C: repeated phrases require disambiguation', () => {
    const doc = ensureBlockIds(
      plainTextToRichText('The field is zero when...\n\nThe field is zero because...'),
    );
    // Multi-paragraph: plainTextToRichText may be one block — force two blocks.
    const twoBlocks = ensureBlockIds({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'The field is zero when...' }] },
        { type: 'paragraph', spans: [{ text: 'The field is zero because...' }] },
      ],
    });
    expect(() =>
      resolveQuoteAnchor(twoBlocks, { quote: 'The field is zero' }),
    ).toThrow(/Ambiguous/);
    const a0 = resolveQuoteAnchor(twoBlocks, {
      quote: 'The field is zero',
      occurrence: 0,
    });
    const a1 = resolveQuoteAnchor(twoBlocks, {
      quote: 'The field is zero',
      occurrence: 1,
    });
    expect(a0.blockId).not.toBe(a1.blockId);
    void doc;
  });

  it('C2: block_id pins the intended occurrence', () => {
    const twoBlocks = ensureBlockIds({
      blocks: [
        { id: 'p1', type: 'paragraph', spans: [{ text: 'The field is zero when...' }] },
        { id: 'p2', type: 'paragraph', spans: [{ text: 'The field is zero because...' }] },
      ],
    });
    const a = resolveQuoteAnchor(twoBlocks, {
      quote: 'The field is zero',
      block_id: 'p2',
    });
    expect(a.blockId).toBe('p2');
  });

  it('findQuoteOffsets finds all matches', () => {
    expect(findQuoteOffsets('aa x aa x aa', 'aa')).toHaveLength(3);
  });

  it('F: remove comment preserves content until deleted', () => {
    let el = baseText('Keep the source text intact.');
    const { element, commentId } = addCommentToElement(el, {
      anchor: { quote: 'source text' },
      text: 'A note',
    });
    el = element;
    const before = el.text;
    el = removeCommentFromElement(el, commentId);
    expect(el.comments).toBeUndefined();
    expect(el.text).toBe(before);
  });

  it('update comment text', () => {
    let el = baseText('Phrase here for comment.');
    const { element, commentId } = addCommentToElement(el, {
      anchor: { quote: 'Phrase here' },
      text: 'Old',
    });
    el = updateCommentOnElement(element, commentId, { text: 'New comment' });
    expect(el.comments![0]!.text).toBe('New comment');
  });
});

describe('text feature AI parse + apply', () => {
  it('parses and applies set_text_title / add_text_note / add_text_comment', () => {
    let el = baseText(
      'An electric field describes force per unit positive test charge.',
    );
    const titleOp = parseTextFeatureOperation({
      type: 'set_text_title',
      target_id: 'text_12',
      text: 'Electric Fields',
    });
    el = applyTextFeatureOperation(el, titleOp);
    expect(el.title?.text).toBe('Electric Fields');

    const noteOp = parseTextFeatureOperation({
      type: 'add_text_note',
      target_element_id: 'text_12',
      text: 'Electric fields are vector quantities.',
      note_type: 'extra_information',
    });
    el = applyTextFeatureOperation(el, noteOp);
    expect(el.notes).toHaveLength(1);

    const commentOp = parseTextFeatureOperation({
      type: 'add_text_comment',
      target_element_id: 'text_12',
      anchor: { quote: 'positive test charge' },
      comment: 'Defines conventional direction.',
      comment_type: 'explanation',
    });
    el = applyTextFeatureOperation(el, commentOp);
    expect(el.comments).toHaveLength(1);

    const indexed = composeTextElementIndexText(el);
    expect(indexed).toContain('Electric Fields');
    expect(indexed).toContain('vector quantities');
    expect(indexed).toContain('conventional direction');
  });

  it('rejects ambiguous comment anchors without occurrence', () => {
    const el = baseText('same same');
    // Force two identical phrases in one block — still ambiguous by occurrence.
    const rich = ensureBlockIds({
      blocks: [
        { type: 'paragraph', spans: [{ text: 'same phrase here' }] },
        { type: 'paragraph', spans: [{ text: 'same phrase there' }] },
      ],
    });
    const withRich = { ...el, richText: rich, text: richTextToPlainText(rich) };
    expect(() =>
      applyTextFeatureOperation(withRich, {
        type: 'add_text_comment',
        target_element_id: 'text_12',
        anchor: { quote: 'same phrase' },
        comment: 'Ambiguous',
      }),
    ).toThrow(/Ambiguous/);
  });
});
