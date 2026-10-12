/**
 * Textbook component library — styles, placement, migration, agent ops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyDocument,
  DEFAULT_STYLE,
  DOCUMENT_VERSION,
  type TextElement,
} from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { migrateDocument } from '../../../persistence/migrate';
import { ragSync } from '../../rag/ragSync';
import { executeCanvasOperations } from '../../ai/agent/executor';
import { createLiveAgentExecutorTarget } from '../../ai/agent/liveExecutor';
import { parseCanvasAgentResponse } from '../../ai/agent/parser';
import { plainTextToRichText } from '../richText';
import { ensureBlockIds } from '../textFeatures';
import {
  TEXT_COMPONENT_STYLES,
  applyComponentStyleToElement,
  getComponentType,
  labelForComponent,
  measureTextComponent,
} from '../textComponents';
import {
  componentRectOverlaps,
  markManualPlacement,
  resolveComponentPlacement,
} from '../componentPlacement';
import { getElementBounds } from '../../../utils/coordinates';

const BODY =
  'An electric field describes the force per unit positive test charge.';

function seedMain(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'text_12',
    type: 'text',
    text: BODY,
    richText: ensureBlockIds(plainTextToRichText(BODY)),
    componentType: 'main_text',
    componentMeta: { placementMode: 'auto' },
    x: 100,
    y: 200,
    width: 360,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    zIndex: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 15,
    fontFamily: DEFAULT_STYLE.fontFamily,
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#1a1a1a',
    alignment: 'left',
    lineHeight: 1.45,
    backgroundColor: null,
    padding: 12,
    cornerRadius: 0,
    ...overrides,
  };
}

function reset(els: TextElement[] = [seedMain()]) {
  useCanvasStore.setState({
    document: { ...createEmptyDocument(), elements: els },
    style: { ...DEFAULT_STYLE },
    selectedIds: els[0] ? [els[0].id] : [],
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

function ctx(ids = ['text_12']) {
  return {
    allowedElementIds: new Set(ids),
    elementTypes: new Map(ids.map((id) => [id, 'text'] as const)),
  };
}

function texts(): TextElement[] {
  return useCanvasStore
    .getState()
    .document.elements.filter((e): e is TextElement => e.type === 'text');
}

describe('text component styles', () => {
  it('exposes presets for every textbook component', () => {
    for (const key of [
      'main_text',
      'title',
      'definition',
      'example',
      'warning',
      'linked_comment',
      'exercise',
    ] as const) {
      expect(TEXT_COMPONENT_STYLES[key].fontSize).toBeGreaterThan(0);
      expect(TEXT_COMPONENT_STYLES[key].defaultWidth).toBeGreaterThan(0);
    }
  });

  it('labels warning variants correctly', () => {
    expect(labelForComponent('warning', { placementMode: 'auto', variant: 'common_mistake' })).toBe(
      'Common Mistake',
    );
    expect(labelForComponent('definition', { placementMode: 'auto' })).toBe('Definition');
  });

  it('measures with label chrome height', () => {
    const bare = measureTextComponent({
      componentType: 'main_text',
      text: 'Hello',
    });
    const def = measureTextComponent({
      componentType: 'definition',
      text: 'Hello',
    });
    expect(def.height).toBeGreaterThan(bare.height);
  });
});

describe('component placement', () => {
  const camera = { x: 0, y: 0, zoom: 1 };
  const viewport = { width: 1200, height: 800 };

  it('places title above associated main text', () => {
    const main = seedMain();
    const decision = resolveComponentPlacement({
      componentType: 'title',
      text: 'Electric Fields',
      associatedElement: main,
      elements: [main],
      camera,
      viewport,
    });
    expect(decision.reason).toBe('title_above_associated');
    expect(decision.y + decision.height).toBeLessThanOrEqual(main.y);
    expect(decision.x).toBe(main.x);
  });

  it('stacks definition below main without overlap', () => {
    const main = seedMain();
    const decision = resolveComponentPlacement({
      componentType: 'definition',
      text: 'E is force per unit charge.',
      associatedElement: main,
      elements: [main],
      camera,
      viewport,
      meta: { placementMode: 'auto', associatedElementId: main.id },
    });
    expect(decision.y).toBeGreaterThanOrEqual(main.y + main.height);
    expect(
      componentRectOverlaps(decision, [main]),
    ).toBe(false);
  });

  it('prefers comment to the right of source', () => {
    const main = seedMain();
    const decision = resolveComponentPlacement({
      componentType: 'linked_comment',
      text: 'Useful clarification.',
      associatedElement: main,
      elements: [main],
      camera,
      viewport,
    });
    expect(decision.reason).toBe('comment_right_of_source');
    expect(decision.x).toBeGreaterThanOrEqual(main.x + main.width);
  });

  it('markManualPlacement switches mode', () => {
    const el = applyComponentStyleToElement(seedMain(), 'definition', {
      placementMode: 'auto',
    });
    expect(markManualPlacement(el).componentMeta?.placementMode).toBe('manual');
  });
});

describe('create_text_component / add_linked_comment pipeline', () => {
  beforeEach(() => {
    reset();
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('creates definition without layout parameters', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text_component',
            component: 'definition',
            content: 'Electric field strength is force per unit positive charge.',
            associated_element_id: 'text_12',
          },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const def = texts().find((e) => e.componentType === 'definition')!;
    expect(def).toBeTruthy();
    expect(def.componentMeta?.associatedElementId).toBe('text_12');
    expect(def.componentMeta?.placementMode).toBe('auto');
    expect(def.y).toBeGreaterThanOrEqual(200);
    expect(def.metadata?.borderColor).toBeTruthy();
  });

  it('creates a multi-component topic without coordinates', () => {
    reset([]);
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'create_text_component',
            component: 'main_text',
            ref: 'm',
            content: BODY,
          },
          {
            type: 'create_text_component',
            component: 'title',
            ref: 't',
            content: 'Electric Fields',
            associated_element_id: 'm',
          },
          {
            type: 'create_text_component',
            component: 'definition',
            ref: 'd',
            content: 'E = F/q',
            associated_element_id: 'm',
          },
          {
            type: 'create_text_component',
            component: 'example',
            content: 'Doubling distance quarters the field.',
            associated_element_id: 'm',
          },
          {
            type: 'create_text_component',
            component: 'warning',
            variant: 'common_mistake',
            content: 'Distance does not halve the field.',
            associated_element_id: 'm',
          },
          {
            type: 'create_text_component',
            component: 'exercise',
            content: 'Calculate E at 3 m from +2 μC.',
            associated_element_id: 'm',
          },
        ],
      }),
      { allowedElementIds: new Set(), elementTypes: new Map() },
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const all = texts();
    expect(all.map((e) => getComponentType(e)).sort()).toEqual(
      [
        'definition',
        'example',
        'exercise',
        'main_text',
        'title',
        'warning',
      ].sort(),
    );
    // No overlaps between auto-placed components
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(
          componentRectOverlaps(getElementBounds(all[i]!), [all[j]!]),
        ).toBe(false);
      }
    }
  });

  it('add_linked_comment anchors, highlights, and places a comment box', () => {
    const plan = parseCanvasAgentResponse(
      JSON.stringify({
        operations: [
          {
            type: 'add_linked_comment',
            target_element_id: 'text_12',
            anchor: { quote: 'positive test charge' },
            comment: 'Defines conventional field direction.',
          },
        ],
      }),
      ctx(),
    );
    executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    const comment = texts().find((e) => e.componentType === 'linked_comment')!;
    expect(comment).toBeTruthy();
    expect(comment.componentMeta?.anchor?.quote).toBe('positive test charge');
    const main = texts().find((e) => e.id === 'text_12')!;
    const spans = main.richText!.blocks.flatMap((b) => b.spans);
    expect(spans.some((s) => s.style?.linked_comment_id === comment.id)).toBe(true);
  });

  it('rejects ambiguous linked comment anchors', () => {
    const dup =
      'positive test charge appears twice: positive test charge again.';
    reset([seedMain({ text: dup, richText: ensureBlockIds(plainTextToRichText(dup)) })]);
    expect(() =>
      executeCanvasOperations(
        parseCanvasAgentResponse(
          JSON.stringify({
            operations: [
              {
                type: 'add_linked_comment',
                target_element_id: 'text_12',
                anchor: { quote: 'positive test charge' },
                comment: 'Ambiguous',
              },
            ],
          }),
          ctx(),
        ),
        createLiveAgentExecutorTarget(),
      ),
    ).toThrow();
    expect(texts()).toHaveLength(1);
  });

  it('update_text_component edits existing content', () => {
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'create_text_component',
              component: 'example',
              content: 'Old example',
              associated_element_id: 'text_12',
            },
          ],
        }),
        ctx(),
      ),
      createLiveAgentExecutorTarget(),
    );
    const ex = texts().find((e) => e.componentType === 'example')!;
    executeCanvasOperations(
      parseCanvasAgentResponse(
        JSON.stringify({
          operations: [
            {
              type: 'update_text_component',
              target_element_id: ex.id,
              content: 'Clearer example text',
            },
          ],
        }),
        ctx([ex.id, 'text_12']),
      ),
      createLiveAgentExecutorTarget(),
    );
    expect(texts().find((e) => e.id === ex.id)!.text).toBe('Clearer example text');
  });

  it('title upsert does not duplicate', () => {
    executeCanvasOperations(
      [
        {
          type: 'create_text_component',
          component: 'title',
          content: 'First',
          associated_element_id: 'text_12',
        },
        {
          type: 'create_text_component',
          component: 'title',
          content: 'Updated Title',
          associated_element_id: 'text_12',
        },
      ],
      createLiveAgentExecutorTarget(),
    );
    expect(texts().filter((e) => e.componentType === 'title')).toHaveLength(1);
    expect(texts().find((e) => e.componentType === 'title')!.text).toBe(
      'Updated Title',
    );
  });
});

describe('legacy migration to textbook components', () => {
  it('flattens nested title/notes/comments into sibling elements', () => {
    const legacy = {
      version: 5,
      id: 'board_legacy',
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [
        {
          id: 'text_legacy',
          type: 'text',
          text: BODY,
          x: 50,
          y: 80,
          width: 300,
          height: 100,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
          fontSize: 16,
          fontFamily: 'Georgia',
          fontWeight: 'normal',
          fontItalic: false,
          underline: false,
          strikethrough: false,
          color: '#111',
          alignment: 'left',
          lineHeight: 1.4,
          backgroundColor: null,
          padding: 12,
          cornerRadius: 0,
          title: { id: 'title_1', text: 'Legacy Title' },
          notes: [
            {
              id: 'note_1',
              text: 'A caution note',
              noteType: 'caution',
              order: 0,
              layoutMode: 'auto',
            },
          ],
          comments: [
            {
              id: 'comment_1',
              text: 'Legacy comment',
              commentType: 'explanation',
              displayState: 'collapsed',
              anchor: {
                blockId: 'block_x',
                start: 0,
                end: 5,
                quote: 'An el',
                status: 'resolved',
              },
            },
          ],
        },
      ],
    };
    const doc = migrateDocument(legacy);
    expect(doc).toBeTruthy();
    expect(doc!.version).toBe(DOCUMENT_VERSION);
    const migrated = doc!.elements.filter(
      (e): e is TextElement => e.type === 'text',
    );
    expect(migrated.some((e) => e.componentType === 'title')).toBe(true);
    expect(migrated.some((e) => e.componentType === 'warning')).toBe(true);
    expect(migrated.some((e) => e.componentType === 'linked_comment')).toBe(true);
    const main = migrated.find((e) => e.id === 'text_legacy')!;
    expect(main.title).toBeUndefined();
    expect(main.notes).toBeUndefined();
    expect(main.comments).toBeUndefined();
    expect(main.componentType).toBe('main_text');
  });
});
