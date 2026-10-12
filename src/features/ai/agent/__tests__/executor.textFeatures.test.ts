import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  type TextElement,
} from '../../../../types/canvas';
import { useCanvasStore } from '../../../../store/canvasStore';
import { ragSync } from '../../../rag/ragSync';
import { executeCanvasOperations } from '../executor';
import { createLiveAgentExecutorTarget } from '../liveExecutor';
import { parseCanvasAgentResponse } from '../parser';
import { plainTextToRichText } from '../../../text/richText';
import { ensureBlockIds } from '../../../text/textFeatures';

function seedText(): TextElement {
  const text =
    'An electric field describes force per unit positive test charge.';
  return {
    id: 'text_12',
    type: 'text',
    text,
    richText: ensureBlockIds(plainTextToRichText(text)),
    x: 100,
    y: 100,
    width: 360,
    height: 140,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 18,
    fontFamily: 'Arial, Helvetica, sans-serif',
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

function resetCanvas() {
  useCanvasStore.setState({
    document: {
      ...createEmptyDocument(),
      elements: [seedText()],
    },
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

describe('executeCanvasOperations — text features → components', () => {
  beforeEach(() => {
    resetCanvas();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bridges legacy feature ops to sibling textbook components', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'set_text_title',
            target_element_id: 'text_12',
            text: 'Electric Fields',
          },
          {
            type: 'add_text_comment',
            target_element_id: 'text_12',
            anchor: { quote: 'positive test charge' },
            comment: 'Defines conventional direction.',
          },
          {
            type: 'add_text_note',
            target_element_id: 'text_12',
            text: 'Electric fields are vector quantities.',
          },
        ],
      }),
      {
        allowedElementIds: new Set(['text_12']),
        elementTypes: new Map([['text_12', 'text']]),
      },
    );

    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.createdIds.length).toBeGreaterThanOrEqual(3);
    const texts = useCanvasStore
      .getState()
      .document.elements.filter((e): e is TextElement => e.type === 'text');
    expect(texts.some((e) => e.componentType === 'title')).toBe(true);
    expect(texts.some((e) => e.componentType === 'linked_comment')).toBe(true);
    expect(texts.some((e) => e.componentType === 'example')).toBe(true);
    const main = texts.find((e) => e.id === 'text_12')!;
    expect(main.title).toBeUndefined();
    expect(main.comments).toBeUndefined();
    expect(main.notes).toBeUndefined();
    expect(ragSync.indexText).toHaveBeenCalled();
  });

  it('create_text with legacy features spawns sibling components', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text',
            title: 'Gauss',
            text: 'Flux through a closed surface relates to enclosed charge.',
            notes: [{ text: 'Use symmetry.' }],
            placement: { mode: 'viewport_default' },
          },
        ],
      }),
      {
        allowedElementIds: new Set(['text_12']),
        elementTypes: new Map([['text_12', 'text']]),
      },
    );
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    // main + title + example
    expect(result.createdIds.length).toBeGreaterThanOrEqual(3);
    const texts = useCanvasStore
      .getState()
      .document.elements.filter((e): e is TextElement =>
        result.createdIds.includes(e.id),
      );
    expect(texts.some((e) => e.componentType === 'title' && e.text === 'Gauss')).toBe(
      true,
    );
    expect(texts.some((e) => e.componentType === 'example')).toBe(true);
  });

  it('feature ops undo as one transaction', () => {
    executeCanvasOperations(
      [
        {
          type: 'set_text_title',
          target_element_id: 'text_12',
          text: 'T',
        },
        {
          type: 'add_text_note',
          target_element_id: 'text_12',
          text: 'N',
        },
      ],
      createLiveAgentExecutorTarget(),
    );
    expect(
      useCanvasStore.getState().document.elements.filter((e) => e.type === 'text'),
    ).toHaveLength(3);
    useCanvasStore.getState().undo();
    expect(
      useCanvasStore.getState().document.elements.filter((e) => e.type === 'text'),
    ).toHaveLength(1);
  });
});
