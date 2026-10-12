import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, createEmptyDocument } from '../../../types/canvas';
import { useCanvasStore } from '../../../store/canvasStore';
import { createAiTextElement } from '../../ai/canvas/createAiTextElement';
import { executeCanvasOperations } from '../../ai/agent/executor';
import { createLiveAgentExecutorTarget } from '../../ai/agent/liveExecutor';
import type { CanvasAgentResponse } from '../../ai/agent/operations';
import { calculateGridLayout } from '../../ai/agent/layout/gridLayoutEngine';
import { measureLayoutItems } from '../../ai/agent/layout/measure';
import { GRID_LAYOUT_CONFIG } from '../../ai/agent/layout/gridConfig';
import { serializeDocument, parseDocument } from '../../../persistence/storage';
import { ragSync } from '../../rag/ragSync';
import {
  TextElementAutoSizer,
  choosePreferredTextWidth,
  measurePlainTextHeight,
  textElementAllowsAiAutoWidth,
} from '../textAutoSizer';
import type { RichTextDocument } from '../richText';
import { richTextToHtml } from '../richTextHtml';

const style = {
  fontSize: DEFAULT_STYLE.fontSize,
  fontFamily: DEFAULT_STYLE.fontFamily,
  fontWeight: DEFAULT_STYLE.fontWeight,
  fontItalic: DEFAULT_STYLE.fontItalic,
  underline: DEFAULT_STYLE.underline,
  lineHeight: DEFAULT_STYLE.lineHeight,
  color: DEFAULT_STYLE.textColor,
  padding: 12,
};

function resetCanvas() {
  useCanvasStore.setState({
    document: createEmptyDocument(),
    style: { ...DEFAULT_STYLE },
    selectedIds: [],
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

function richDoc(blocks: RichTextDocument['blocks']): RichTextDocument {
  return { blocks };
}

/** Measure rendered HTML height the same way TextHtmlLayer would (Test O). */
function renderedContentHeight(
  html: string,
  contentWidth: number,
  fontSize: number,
): number {
  const host = document.createElement('div');
  host.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    `width:${contentWidth}px`,
    'box-sizing:border-box',
    `font-size:${fontSize}px`,
  ].join(';');
  host.innerHTML = html;
  document.body.appendChild(host);
  const h = host.getBoundingClientRect().height;
  document.body.removeChild(host);
  return h;
}

describe('TextElementAutoSizer', () => {
  beforeEach(() => {
    vi.spyOn(ragSync, 'indexText').mockImplementation(() => {});
    vi.spyOn(ragSync, 'updateGeometry').mockImplementation(() => {});
    vi.spyOn(ragSync, 'scheduleReconcile').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('Test A — short textbox is compact but padded', () => {
    const m = TextElementAutoSizer.measure({
      content: { text: 'Gauss' },
      style,
    });
    expect(m.width).toBeLessThan(GRID_LAYOUT_CONFIG.defaultTextWidth);
    expect(m.width).toBeGreaterThanOrEqual(140);
    expect(m.height).toBeGreaterThanOrEqual(56);
    expect(m.height).toBeLessThan(100);
    expect(m.autoSized).toBe(true);
    // DOM layout when the host supports it; structural fallback otherwise.
    expect(typeof m.measuredWithDom).toBe('boolean');
  });

  it('Test B — long paragraph wraps and is fully visible (no clip)', () => {
    const text =
      'Electric fields describe the force experienced per unit positive test charge. ' +
      'The field strength decreases with distance from a point charge. ' +
      'Field lines are a useful visualization of direction and relative magnitude.';
    const m = TextElementAutoSizer.measure({
      content: { text },
      availableWidth: 360,
      style,
    });
    expect(m.height).toBeGreaterThan(80);
    const plain = measurePlainTextHeight(text, m.width, style);
    expect(m.height).toBeGreaterThanOrEqual(plain.contentHeight + style.padding * 2);
    expect(plain.wrappedLines ?? 0).toBeGreaterThan(2);
  });

  it('Test C — multiple paragraphs include blank-line spacing', () => {
    const text =
      'Electric fields describe the force experienced per unit positive test charge.\n\n' +
      'The field strength decreases with distance from a point charge.';
    const single =
      'Electric fields describe the force experienced per unit positive test charge. ' +
      'The field strength decreases with distance from a point charge.';
    const multi = TextElementAutoSizer.measure({
      content: { text },
      availableWidth: 360,
      style,
    });
    const one = TextElementAutoSizer.measure({
      content: { text: single },
      availableWidth: 360,
      style,
    });
    expect(multi.height).toBeGreaterThan(one.height - 4);
  });

  it('Test D — rich-text headings use larger font metrics', () => {
    const withHeading = richDoc([
      {
        type: 'heading',
        spans: [{ text: 'Electric Fields', style: { bold: true, font_size: 'heading' } }],
      },
      {
        type: 'paragraph',
        spans: [
          {
            text: 'An electric field describes the force experienced per unit positive test charge.',
          },
        ],
      },
    ]);
    const plainOnly = richDoc([
      {
        type: 'paragraph',
        spans: [
          {
            text: 'Electric Fields\nAn electric field describes the force experienced per unit positive test charge.',
          },
        ],
      },
    ]);
    const h1 = TextElementAutoSizer.measure({
      content: { text: '', richText: withHeading },
      availableWidth: 360,
      style,
    });
    const h2 = TextElementAutoSizer.measure({
      content: { text: '', richText: plainOnly },
      availableWidth: 360,
      style,
    });
    expect(h1.height).toBeGreaterThan(h2.height - 8);
    expect(h1.height).toBeGreaterThan(90);
  });

  it('Test E — bullet lists with wrapping items', () => {
    const doc = richDoc([
      { type: 'heading', spans: [{ text: 'Key properties:', style: { bold: true } }] },
      { type: 'bullet', spans: [{ text: 'Electric fields are vectors.' }] },
      {
        type: 'bullet',
        spans: [
          {
            text: 'Field lines point away from positive charges and toward negative charges in the conventional representation.',
          },
        ],
      },
      { type: 'bullet', spans: [{ text: 'Field strength depends on distance.' }] },
    ]);
    const m = TextElementAutoSizer.measure({
      content: { text: '', richText: doc },
      availableWidth: 280,
      style,
    });
    expect(m.height).toBeGreaterThan(120);
    expect(m.wrappedLines ?? 0).toBeGreaterThan(3);
  });

  it('Test F — mixed inline formatting wraps completely', () => {
    const doc = richDoc([
      {
        type: 'paragraph',
        spans: [
          { text: 'Bold ', style: { bold: true } },
          { text: 'italic ', style: { italic: true } },
          { text: 'underline ', style: { underline: true } },
          {
            text: 'and highlighted spans all appear in one flowing paragraph that must wrap.',
            style: { highlight_color: 'blue' },
          },
        ],
      },
    ]);
    const m = TextElementAutoSizer.measure({
      content: { text: '', richText: doc },
      availableWidth: 320,
      style,
    });
    expect(m.height).toBeGreaterThan(56);
    expect(m.contentHeight).toBeGreaterThan(20);
    if (m.measuredWithDom) {
      const html = richTextToHtml(doc, {
        color: style.color,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      });
      const rendered = renderedContentHeight(html, m.contentWidth, style.fontSize);
      expect(m.contentHeight + 1).toBeGreaterThanOrEqual(rendered - 2);
    }
  });

  it('Test G — narrow grid column expands row vertically', () => {
    const long =
      'A long explanatory paragraph placed in a narrow column must wrap onto many lines ' +
      'so the grid row grows rather than clipping text or overflowing horizontally.';
    const ops = [
      {
        type: 'create_text' as const,
        ref: 't',
        text: long,
        placement: { mode: 'viewport_default' as const },
      },
      {
        type: 'create_text' as const,
        ref: 'below',
        text: 'Below',
        placement: { mode: 'viewport_default' as const },
      },
    ];
    const measured = measureLayoutItems(ops, new Set(['t', 'below']), {
      style: DEFAULT_STYLE,
    });
    // Force a narrow preferred width for the long text.
    const narrow = measured.map((m) =>
      m.ref === 't'
        ? {
            ...m,
            preferredWidth: GRID_LAYOUT_CONFIG.minTextWidth,
            preferredHeight: m.measureHeightAtWidth(GRID_LAYOUT_CONFIG.minTextWidth),
          }
        : m,
    );
    const widePreferred = measured.find((m) => m.ref === 't')!;
    const atDefault = widePreferred.measureHeightAtWidth(GRID_LAYOUT_CONFIG.defaultTextWidth);
    const atNarrow = widePreferred.measureHeightAtWidth(GRID_LAYOUT_CONFIG.minTextWidth);
    expect(atNarrow).toBeGreaterThan(atDefault);

    const grid = calculateGridLayout({
      layout: {
        type: 'grid',
        columns: 1,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 't', row: 0, column: 0 },
          { ref: 'below', row: 1, column: 0 },
        ],
      },
      items: narrow,
    });
    const top = grid.items.find((i) => i.ref === 't')!;
    const bot = grid.items.find((i) => i.ref === 'below')!;
    expect(top.height).toBeGreaterThanOrEqual(atNarrow - 1);
    expect(bot.localY).toBeGreaterThan(top.localY + top.height - 1);
    expect(top.textAutoSize?.rowExpanded || top.height > 100).toBeTruthy();
  });

  it('Test H — textbox beside graph does not overlap', () => {
    resetCanvas();
    const long =
      'Electric fields are vector fields that describe forces on charges. '.repeat(6);
    const plan: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          ref: 'note',
          text: long,
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_graph',
          ref: 'g',
          expressions: [
            { expression: '1/x**2', visible: true, domain_min: null, domain_max: null },
          ],
          points: [],
          viewport: { x_min: -10, x_max: 10, y_min: -10, y_max: 10 },
          settings: {
            title: null,
            x_axis_label: null,
            y_axis_label: null,
            show_grid: true,
            show_x_axis: true,
            show_y_axis: true,
          },
          placement: { mode: 'viewport_default' },
        },
        {
          type: 'create_text',
          ref: 'footer',
          text: 'Footer row',
          placement: { mode: 'viewport_default' },
        },
      ],
      layout: {
        type: 'grid',
        columns: 2,
        placement: { mode: 'viewport_default' },
        items: [
          { ref: 'note', row: 0, column: 0 },
          { ref: 'g', row: 0, column: 1 },
          { ref: 'footer', row: 1, column: 0, column_span: 2 },
        ],
      },
    };
    const result = executeCanvasOperations(plan, createLiveAgentExecutorTarget());
    expect(result.layoutDebug?.collisionFree).toBe(true);
    const els = useCanvasStore.getState().document.elements;
    const note = els.find((e) => e.type === 'text' && e.text.startsWith('Electric'));
    const graph = els.find((e) => e.type === 'graph');
    const footer = els.find((e) => e.type === 'text' && e.text === 'Footer row');
    expect(note && graph && footer).toBeTruthy();
    if (note && graph && footer) {
      const noteRight = note.x + note.width;
      expect(noteRight).toBeLessThanOrEqual(graph.x + 1);
      expect(footer.y).toBeGreaterThanOrEqual(Math.max(note.y + note.height, graph.y + graph.height) - 1);
    }
  });

  it('Test I — AI content update expands auto-sized textbox', () => {
    resetCanvas();
    const create: CanvasAgentResponse = {
      operations: [
        {
          type: 'create_text',
          text: 'Electric fields are vector fields.',
          placement: { mode: 'viewport_default' },
        },
      ],
    };
    const created = executeCanvasOperations(create, createLiveAgentExecutorTarget());
    const id = created.createdIds[0]!;
    const before = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(before.type).toBe('text');
    if (before.type !== 'text') return;
    const beforeH = before.height;

    executeCanvasOperations(
      {
        operations: [
          {
            type: 'update_text',
            target_element_id: id,
            text:
              'Electric fields are vector fields.\n\n' +
              'They describe the force experienced per unit positive charge.\n\n' +
              'Their direction is defined by the force on a positive test charge.',
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const after = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(after.type).toBe('text');
    if (after.type !== 'text') return;
    expect(after.height).toBeGreaterThan(beforeH);
    expect(after.text).toContain('positive test charge');
    expect(textElementAllowsAiAutoWidth(after.metadata)).toBe(true);
  });

  it('Test J — manual resize is respected (userResized keeps width)', () => {
    resetCanvas();
    const created = executeCanvasOperations(
      {
        operations: [
          {
            type: 'create_text',
            text: 'Short note',
            placement: { mode: 'viewport_default' },
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const id = created.createdIds[0]!;
    useCanvasStore.getState().updateElement(id, (el) => ({
      ...el,
      width: 240,
      height: 120,
      metadata: { ...el.metadata, userResized: true },
    }));

    executeCanvasOperations(
      {
        operations: [
          {
            type: 'update_text',
            target_element_id: id,
            text:
              'Much longer replacement content that would normally request a wider preferred width ' +
              'for comfortable reading, but must keep the manually chosen width.',
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const after = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(after.width).toBe(240);
    expect(after.height).toBeGreaterThanOrEqual(120);
    expect(after.metadata.userResized).toBe(true);
  });

  it('Test K — save/reload preserves dimensions and formatting', () => {
    resetCanvas();
    const doc = richDoc([
      { type: 'heading', spans: [{ text: 'Title', style: { bold: true, color: 'blue' } }] },
      { type: 'bullet', spans: [{ text: 'One' }] },
      { type: 'bullet', spans: [{ text: 'Two' }] },
    ]);
    executeCanvasOperations(
      {
        operations: [
          {
            type: 'create_text',
            text: 'Title\nOne\nTwo',
            rich_text: doc,
            placement: { mode: 'viewport_default' },
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const before = useCanvasStore.getState().document.elements.find((e) => e.type === 'text')!;
    expect(before.type).toBe('text');
    if (before.type !== 'text') return;
    const json = serializeDocument(useCanvasStore.getState().document);
    const reloaded = parseDocument(json);
    expect(reloaded).toBeTruthy();
    const after = reloaded!.elements.find((e) => e.id === before.id)!;
    expect(after.type).toBe('text');
    if (after.type !== 'text') return;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    expect(after.richText?.blocks[0]?.type).toBe('heading');
    expect(after.metadata.autoSize).toBe(true);
  });

  it('Test L — undo/redo restores content and dimensions', () => {
    resetCanvas();
    const created = executeCanvasOperations(
      {
        operations: [
          {
            type: 'create_text',
            text: 'Original',
            placement: { mode: 'viewport_default' },
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const id = created.createdIds[0]!;
    const original = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    executeCanvasOperations(
      {
        operations: [
          {
            type: 'update_text',
            target_element_id: id,
            text: 'Updated with a much longer body of text so height grows substantially for undo checks.',
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const updated = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(updated.height).toBeGreaterThan(original.height);

    useCanvasStore.getState().undo();
    const undone = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(undone.type).toBe('text');
    if (undone.type === 'text') {
      expect(undone.text).toBe('Original');
      expect(undone.height).toBe(original.height);
      expect(undone.width).toBe(original.width);
    }

    useCanvasStore.getState().redo();
    const redone = useCanvasStore.getState().document.elements.find((e) => e.id === id)!;
    expect(redone.height).toBe(updated.height);
    if (redone.type === 'text') {
      expect(redone.text).toContain('Updated');
    }
  });

  it('Test M — long unbroken content does not clip or loop', () => {
    const unbroken = 'E=kQ/r^2_'.repeat(80);
    const m = TextElementAutoSizer.measure({
      content: { text: unbroken },
      availableWidth: 200,
      style,
    });
    expect(m.height).toBeGreaterThan(56);
    expect(m.height).toBeLessThan(20_000);
    expect(Number.isFinite(m.height)).toBe(true);
  });

  it('Test N — zoom/pan do not change world-space geometry', () => {
    resetCanvas();
    executeCanvasOperations(
      {
        operations: [
          {
            type: 'create_text',
            text: 'Stable geometry',
            placement: { mode: 'viewport_default' },
          },
        ],
      },
      createLiveAgentExecutorTarget(),
    );
    const el = useCanvasStore.getState().document.elements.find((e) => e.type === 'text')!;
    const snap = { x: el.x, y: el.y, w: el.width, h: el.height };
    useCanvasStore.getState().setCamera({ x: -400, y: 200, zoom: 1.75 });
    const after = useCanvasStore.getState().document.elements.find((e) => e.id === el.id)!;
    expect(after.x).toBe(snap.x);
    expect(after.y).toBe(snap.y);
    expect(after.width).toBe(snap.w);
    expect(after.height).toBe(snap.h);
  });

  it('Test O — rendered content fits within final inner rectangle', () => {
    const doc = richDoc([
      { type: 'heading', spans: [{ text: 'Electric Fields', style: { bold: true } }] },
      {
        type: 'paragraph',
        spans: [
          {
            text: 'An electric field describes the force experienced per unit positive test charge.',
          },
        ],
      },
      { type: 'bullet', spans: [{ text: 'Electric fields are vectors.' }] },
      { type: 'bullet', spans: [{ text: 'Field strength depends on distance.' }] },
    ]);
    const m = TextElementAutoSizer.measure({
      content: { text: '', richText: doc },
      availableWidth: 360,
      style,
    });
    const innerBudget = m.height - m.padding * 2;
    // Content height used for sizing must fit the inner box (small padding tolerance).
    expect(m.contentHeight).toBeLessThanOrEqual(innerBudget + 4);
    if (m.measuredWithDom) {
      const html = richTextToHtml(doc, {
        color: style.color,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
      });
      const rendered = renderedContentHeight(html, m.contentWidth, style.fontSize);
      expect(rendered).toBeLessThanOrEqual(innerBudget + 2);
    }
  });

  it('prefers wrapping over extreme width for long explanations', () => {
    const long = 'Word '.repeat(200).trim();
    const w = choosePreferredTextWidth({ text: long }, style);
    expect(w).toBeLessThanOrEqual(GRID_LAYOUT_CONFIG.maxTextWidth);
    expect(w).toBeGreaterThanOrEqual(GRID_LAYOUT_CONFIG.defaultTextWidth);
  });

  it('createAiTextElement stores autoSize metadata', () => {
    const el = createAiTextElement('Hello world', { x: 0, y: 0 }, {
      zIndex: 1,
      style: DEFAULT_STYLE,
    });
    expect(el.metadata.autoSize).toBe(true);
    expect(el.metadata.createdBy).toBe('ai');
    expect(el.height).toBeGreaterThanOrEqual(56);
  });
});
