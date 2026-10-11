import { describe, expect, it, vi } from 'vitest';
import { buildRagContext, type SemanticAnchorInput } from '../contextBuilder';
import { buildLlmPrompt } from '../../ai/llm/promptBuilder';
import {
  HandwritingRecognitionController,
  regionSourceContentHash,
  stableHandwritingRegionId,
} from '../handwritingSync';
import type { CanvasElement, DrawingElement, TextElement } from '../../../types/canvas';
import { canvasElementsAsSpatial, findElementsNearAnchors } from '../spatialContext';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function drawing(
  id: string,
  absPoints: number[],
  opts?: { strokeWidth?: number },
): DrawingElement {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < absPoints.length; i += 2) {
    minX = Math.min(minX, absPoints[i]!);
    minY = Math.min(minY, absPoints[i + 1]!);
    maxX = Math.max(maxX, absPoints[i]!);
    maxY = Math.max(maxY, absPoints[i + 1]!);
  }
  const pad = opts?.strokeWidth ?? 2;
  const x = minX - pad;
  const y = minY - pad;
  const points: number[] = [];
  for (let i = 0; i < absPoints.length; i += 2) {
    points.push(absPoints[i]! - x, absPoints[i + 1]! - y);
  }
  return {
    id,
    type: 'drawing',
    x,
    y,
    width: Math.max(maxX - minX + pad * 2, 1),
    height: Math.max(maxY - minY + pad * 2, 1),
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    points,
    color: '#111',
    strokeWidth: pad,
    strokeStyle: 'solid',
  };
}

function glyphStroke(
  id: string,
  x: number,
  y: number,
  w = 14,
  h = 18,
): DrawingElement {
  return drawing(id, [x, y + h, x + w * 0.3, y, x + w * 0.7, y + h * 0.4, x + w, y + h]);
}

function textEl(id: string, x: number, y: number, text: string): TextElement {
  return {
    id,
    type: 'text',
    x,
    y,
    width: 120,
    height: 40,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    text,
    fontSize: 16,
    fontFamily: 'sans',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left',
    lineHeight: 1.3,
    backgroundColor: null,
    padding: 8,
    cornerRadius: 0,
  };
}

describe('stableHandwritingRegionId', () => {
  it('is deterministic and order-independent', () => {
    expect(stableHandwritingRegionId(['a', 'b'])).toBe(
      stableHandwritingRegionId(['b', 'a']),
    );
    expect(stableHandwritingRegionId(['a', 'b'])).toMatch(/^hw_[0-9a-f]{8}$/);
  });

  it('changes when stroke membership changes', () => {
    expect(stableHandwritingRegionId(['a'])).not.toBe(
      stableHandwritingRegionId(['a', 'b']),
    );
  });
});

describe('regionSourceContentHash', () => {
  it('ignores pure translation (x/y) for OCR staleness', () => {
    const a = glyphStroke('d1', 0, 0);
    const b: DrawingElement = { ...a, x: a.x + 100, y: a.y + 50 };
    expect(regionSourceContentHash([a], ['d1'])).toBe(
      regionSourceContentHash([b], ['d1']),
    );
  });

  it('changes when stroke points change', () => {
    const a = glyphStroke('d1', 0, 0);
    const b = glyphStroke('d1', 0, 0, 40, 18);
    expect(regionSourceContentHash([a], ['d1'])).not.toBe(
      regionSourceContentHash([b], ['d1']),
    );
  });
});

describe('HandwritingRecognitionController', () => {
  it('runs TrOCR per line, combines text, and indexes once (TEST 56)', async () => {
    const recognizeFn = vi.fn(async () => ({
      region_id: 'hw_test',
      combined_text: 'Gauss law relates flux to enclosed charge',
      line_results: [
        {
          line_id: 'L1',
          recognized_text: 'Gauss law relates flux',
          status: 'ready' as const,
        },
        {
          line_id: 'L2',
          recognized_text: 'to enclosed charge',
          status: 'ready' as const,
        },
      ],
      recognizer_model: 'microsoft/trocr-base-handwritten',
      recognizer_provider: 'mock',
      status: 'ready' as const,
      usable_for_embedding: true,
    }));
    const indexFn = vi.fn(async () => ({
      element_id: 'hw_test',
      chunk_count: 1,
      content_changed: true,
    }));
    const deleteFn = vi.fn(async () => undefined);
    const renderFn = vi.fn(async () => ({
      dataUrl: TINY_PNG,
      width: 64,
      height: 32,
      worldBounds: { x: 0, y: 0, width: 100, height: 40 },
      mimeType: 'image/png' as const,
    }));

    const { useCanvasStore } = await import('../../../store/canvasStore');
    // Two horizontal lines of glyphs → one multi-line region
    const strokes = [
      glyphStroke('a1', 0, 0),
      glyphStroke('a2', 18, 0),
      glyphStroke('a3', 36, 0),
      glyphStroke('b1', 0, 28),
      glyphStroke('b2', 18, 28),
      glyphStroke('b3', 36, 28),
    ];
    useCanvasStore.setState((s) => ({
      ...s,
      document: {
        ...s.document,
        id: 'board-hw',
        elements: strokes,
      },
    }));

    const ctrl = new HandwritingRecognitionController({
      debounceMs: 1,
      recognizeFn,
      indexFn,
      deleteFn,
      renderFn,
    });

    await ctrl.refreshAll();

    expect(recognizeFn).toHaveBeenCalled();
    const recognizeCalls = recognizeFn.mock.calls as unknown as Array<
      [{ lines: unknown[] }]
    >;
    expect(recognizeCalls[0]?.[0]?.lines.length).toBeGreaterThanOrEqual(1);
    expect(indexFn).toHaveBeenCalledTimes(1);
    const indexCalls = indexFn.mock.calls as unknown as Array<
      [{ element_type: string; text: string }]
    >;
    expect(indexCalls[0]?.[0]?.element_type).toBe('handwriting_region');
    expect(indexCalls[0]?.[0]?.text).toContain('Gauss law');

    const records = ctrl.getRecords();
    expect(records.length).toBeGreaterThanOrEqual(1);
    const rec = records[0]!;
    expect(rec.status).toBe('ready');
    expect(rec.recognizedText).toContain('Gauss law');
    expect(rec.embeddingIndexed).toBe(true);
    expect(rec.regionImageDataUrl).toBe(TINY_PNG);
  });

  it('does not index empty OCR output (TEST 16)', async () => {
    const recognizeFn = vi.fn(async () => ({
      region_id: 'hw_empty',
      combined_text: '   ',
      line_results: [
        { line_id: 'L1', recognized_text: '', status: 'empty' as const },
      ],
      recognizer_model: 'mock',
      recognizer_provider: 'mock',
      status: 'empty' as const,
      usable_for_embedding: false,
    }));
    const indexFn = vi.fn(async () => ({
      element_id: 'x',
      chunk_count: 0,
      content_changed: true,
    }));
    const deleteFn = vi.fn(async () => undefined);
    const renderFn = vi.fn(async () => ({
      dataUrl: TINY_PNG,
      width: 64,
      height: 32,
      worldBounds: { x: 0, y: 0, width: 40, height: 20 },
      mimeType: 'image/png' as const,
    }));

    const { useCanvasStore } = await import('../../../store/canvasStore');
    useCanvasStore.setState((s) => ({
      ...s,
      document: {
        ...s.document,
        id: 'board-empty',
        elements: [
          glyphStroke('a1', 0, 0),
          glyphStroke('a2', 18, 0),
          glyphStroke('a3', 36, 0),
        ],
      },
    }));

    const ctrl = new HandwritingRecognitionController({
      recognizeFn,
      indexFn,
      deleteFn,
      renderFn,
    });
    await ctrl.refreshAll();
    expect(indexFn).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
  });
});

describe('handwriting semantic RAG + LLM image context', () => {
  const hwAnchor: SemanticAnchorInput = {
    element_id: 'hw_abcdef01',
    element_type: 'handwriting_region',
    similarity: 0.81,
    matched_chunks: [
      {
        chunk_id: 'c0',
        chunk_index: 0,
        text: 'electric potential is energy per unit charge',
        similarity: 0.81,
      },
    ],
    geometry: { x: 10, y: 20, width: 200, height: 50 },
    text: 'electric potential is energy per unit charge',
  };

  it('attaches original handwriting image for semantic anchors (TEST 59)', () => {
    const ctx = buildRagContext({
      query: 'what is electric potential?',
      explicitSelections: [],
      semanticAnchors: [hwAnchor],
      spatialHits: [],
      handwritingImages: [
        {
          region_id: 'hw_abcdef01',
          asset_src: TINY_PNG,
          geometry: hwAnchor.geometry,
          stroke_ids: ['d1', 'd2'],
          ocr_transcription: hwAnchor.text,
          reason: 'semantic_handwriting',
        },
      ],
    });

    expect(ctx.semanticAnchors).toHaveLength(1);
    expect(ctx.imageAttachments).toHaveLength(1);
    const att = ctx.imageAttachments[0]!;
    expect(att.element_type).toBe('handwriting_region');
    expect(att.selection_reason).toBe('semantic_handwriting');
    expect(att.asset_src).toBe(TINY_PNG);
    expect(att.ocr_transcription).toContain('electric potential');
  });

  it('OCR transcription is labeled non-authoritative in LLM prompt (TEST 60)', () => {
    const ctx = buildRagContext({
      query: 'explain',
      explicitSelections: [],
      semanticAnchors: [hwAnchor],
      spatialHits: [],
      handwritingImages: [
        {
          region_id: 'hw_abcdef01',
          asset_src: TINY_PNG,
          geometry: hwAnchor.geometry,
          stroke_ids: ['d1'],
          ocr_transcription: 'electric potentlal is energy per unit charge',
          reason: 'semantic_handwriting',
        },
      ],
    });
    const built = buildLlmPrompt({
      userPrompt: 'what is electric potential?',
      ragContext: ctx,
    });
    expect(built.finalLlmPrompt).toContain('DERIVED OCR TRANSCRIPTION');
    expect(built.finalLlmPrompt).toContain('MAY CONTAIN ERRORS');
    expect(built.finalLlmPrompt).toContain('ATTACHED HANDWRITING REGION IMAGE');
    expect(built.imageAttachments[0]?.asset_src).toBe(TINY_PNG);
    expect(built.finalLlmPrompt).toContain('Attachment required');
  });

  it('dedupes handwriting when same region is semantic + spatial (TEST 36)', () => {
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [],
      semanticAnchors: [hwAnchor],
      spatialHits: [
        {
          element_id: 'hw_abcdef01',
          element_type: 'handwriting_region',
          anchor_element_id: 'textbox_1',
          distance: 12,
          geometry: hwAnchor.geometry,
          text: hwAnchor.text,
        },
      ],
      handwritingImages: [
        {
          region_id: 'hw_abcdef01',
          asset_src: TINY_PNG,
          geometry: hwAnchor.geometry,
          stroke_ids: ['d1'],
          ocr_transcription: hwAnchor.text,
          reason: 'semantic_handwriting',
        },
        {
          region_id: 'hw_abcdef01',
          asset_src: TINY_PNG,
          geometry: hwAnchor.geometry,
          stroke_ids: ['d1'],
          ocr_transcription: hwAnchor.text,
          reason: 'spatial_neighbor',
        },
      ],
    });
    expect(ctx.imageAttachments.filter((a) => a.element_id === 'hw_abcdef01')).toHaveLength(
      1,
    );
  });

  it('includes handwriting + text in same semantic retrieval stage (TEST 67)', () => {
    const textAnchor: SemanticAnchorInput = {
      element_id: 'textbox_1',
      element_type: 'text',
      similarity: 0.84,
      matched_chunks: [
        {
          chunk_id: 'c1',
          chunk_index: 0,
          text: "Gauss's law",
          similarity: 0.84,
        },
      ],
      geometry: { x: 0, y: 0, width: 100, height: 40 },
      text: "Gauss's law relates flux to enclosed charge",
    };
    const ctx = buildRagContext({
      query: 'Gauss law',
      explicitSelections: [],
      semanticAnchors: [textAnchor, hwAnchor],
      spatialHits: [],
      handwritingImages: [
        {
          region_id: 'hw_abcdef01',
          asset_src: TINY_PNG,
          geometry: hwAnchor.geometry,
          stroke_ids: ['d1'],
          ocr_transcription: hwAnchor.text,
          reason: 'semantic_handwriting',
        },
      ],
    });
    expect(ctx.semanticAnchors.map((a) => a.element_type).sort()).toEqual([
      'handwriting_region',
      'text',
    ]);
    expect(ctx.imageAttachments.some((a) => a.element_type === 'handwriting_region')).toBe(
      true,
    );
  });

  it('handwriting regions participate in spatial expansion (TEST 27/28)', () => {
    const els: CanvasElement[] = [
      textEl('t1', 0, 0, 'anchor'),
      glyphStroke('d1', 500, 500),
    ];
    const spatial = canvasElementsAsSpatial(els, [
      {
        id: 'hw_near',
        type: 'handwriting_region',
        x: 30,
        y: 0,
        width: 80,
        height: 40,
        text: 'nearby note',
      },
    ]);
    const hits = findElementsNearAnchors(
      [{ id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'anchor' }],
      spatial,
      50,
    );
    expect(hits.some((h) => h.element_id === 'hw_near')).toBe(true);
    expect(hits.some((h) => h.element_type === 'handwriting_region')).toBe(true);
  });
});
