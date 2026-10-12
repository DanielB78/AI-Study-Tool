import { describe, expect, it } from 'vitest';
import {
  buildRagContext,
  type SemanticAnchorInput,
} from '../contextBuilder';
import {
  inspectCanvasRegion,
  isStructuredWithoutImage,
  isVisualUnstructuredContent,
  regionAttachmentId,
  STRUCTURED_WITHOUT_IMAGE,
} from '../regionContext';
import { computeRegionRenderSize } from '../regionRenderer';
import { buildLlmPrompt } from '../../ai/llm/promptBuilder';
import type {
  CanvasElement,
  DrawingElement,
  ImageElement,
  TextElement,
} from '../../../types/canvas';

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function base(id: string, x: number, y: number, w: number, h: number) {
  return {
    id,
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
  };
}

function textEl(
  id: string,
  x: number,
  y: number,
  text: string,
  w = 100,
  h = 40,
): TextElement {
  return {
    ...base(id, x, y, w, h),
    type: 'text',
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

function drawingEl(
  id: string,
  x: number,
  y: number,
  points: number[],
  w = 80,
  h = 40,
): DrawingElement {
  return {
    ...base(id, x, y, w, h),
    type: 'drawing',
    points,
    color: '#111',
    strokeWidth: 2,
    strokeStyle: 'solid',
  };
}

function imageEl(
  id: string,
  x: number,
  y: number,
  w = 80,
  h = 60,
): ImageElement {
  return {
    ...base(id, x, y, w, h),
    type: 'image',
    src: TINY_PNG,
    naturalWidth: w,
    naturalHeight: h,
  };
}

describe('structured-without-image extensibility', () => {
  it('treats only text as structured-without-image in v1', () => {
    expect(STRUCTURED_WITHOUT_IMAGE.has('text')).toBe(true);
    expect(isStructuredWithoutImage('text')).toBe(true);
    expect(isStructuredWithoutImage('equation')).toBe(false);
    expect(isStructuredWithoutImage('drawing')).toBe(false);
  });

  it('classifies drawings/images as visual unstructured', () => {
    expect(
      isVisualUnstructuredContent(
        drawingEl('d1', 0, 0, [0, 0, 10, 10]),
      ),
    ).toBe(true);
    expect(isVisualUnstructuredContent(imageEl('i1', 0, 0))).toBe(true);
    expect(isVisualUnstructuredContent(textEl('t1', 0, 0, 'hi'))).toBe(false);
  });
});

describe('inspectCanvasRegion', () => {
  it('CASE A — empty region produces no image', () => {
    const inspection = inspectCanvasRegion(
      [textEl('textbox_1', 500, 500, 'far')],
      { x: 0, y: 0, width: 50, height: 50 },
    );
    expect(inspection.kind).toBe('empty');
    expect(inspection.isEmpty).toBe(true);
    expect(inspection.shouldRenderImage).toBe(false);
    expect(inspection.hasVisualContent).toBe(false);
    expect(inspection.intersectingElementIds).toEqual([]);
  });

  it('CASE B — textbox-only region uses structured text, no image', () => {
    const els: CanvasElement[] = [
      textEl('textbox_1', 10, 10, "Newton's second law"),
      textEl('textbox_2', 10, 60, 'F = ma'),
    ];
    const inspection = inspectCanvasRegion(els, {
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    });
    expect(inspection.kind).toBe('structured_only');
    expect(inspection.shouldRenderImage).toBe(false);
    expect(inspection.hasVisualContent).toBe(false);
    expect(inspection.structuredElementIds).toEqual(['textbox_1', 'textbox_2']);
    expect(inspection.structuredSelections.map((s) => s.text)).toEqual([
      "Newton's second law",
      'F = ma',
    ]);
  });

  it('CASE B — multiple textboxes only, no screenshot', () => {
    const els = [
      textEl('textbox_1', 0, 0, 'a'),
      textEl('textbox_2', 0, 50, 'b'),
      textEl('textbox_3', 0, 100, 'c'),
    ];
    const inspection = inspectCanvasRegion(els, {
      x: -10,
      y: -10,
      width: 200,
      height: 200,
    });
    expect(inspection.kind).toBe('structured_only');
    expect(inspection.shouldRenderImage).toBe(false);
    expect(inspection.structuredElementIds).toHaveLength(3);
  });

  it('CASE C — handwriting-only triggers image', () => {
    const els = [
      drawingEl('pen_1', 20, 20, [0, 0, 30, 5, 60, 0], 60, 20),
    ];
    const inspection = inspectCanvasRegion(els, {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    });
    expect(inspection.kind).toBe('visual');
    expect(inspection.shouldRenderImage).toBe(true);
    expect(inspection.hasVisualContent).toBe(true);
    expect(inspection.visualElementIds).toEqual(['pen_1']);
    expect(inspection.structuredElementIds).toEqual([]);
  });

  it('CASE C — text + handwriting is mixed visual', () => {
    const els: CanvasElement[] = [
      textEl('textbox_1', 10, 10, "Newton's second law"),
      drawingEl('pen_1', 10, 80, [0, 0, 40, 40], 50, 50),
    ];
    const inspection = inspectCanvasRegion(els, {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(inspection.kind).toBe('visual');
    expect(inspection.shouldRenderImage).toBe(true);
    expect(inspection.structuredElementIds).toEqual(['textbox_1']);
    expect(inspection.visualElementIds).toEqual(['pen_1']);
  });

  it('partial stroke intersection still counts as visual', () => {
    // Drawing AABB overlaps selection; crop will clip (renderer responsibility).
    const els = [
      drawingEl('pen_partial', 80, 0, [0, 0, 100, 0], 100, 10),
    ];
    const inspection = inspectCanvasRegion(els, {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(inspection.hasVisualContent).toBe(true);
    expect(inspection.visualElementIds).toContain('pen_partial');
  });

  it('ImageElement in region is visual', () => {
    const inspection = inspectCanvasRegion(
      [imageEl('image_1', 10, 10)],
      { x: 0, y: 0, width: 200, height: 200 },
    );
    expect(inspection.kind).toBe('visual');
    expect(inspection.shouldRenderImage).toBe(true);
  });

  it('world bounds are independent of screen zoom (geometry only)', () => {
    const bounds = { x: 100, y: 200, width: 50, height: 40 };
    const inspection = inspectCanvasRegion(
      [drawingEl('pen_1', 110, 210, [0, 0, 10, 10], 20, 20)],
      bounds,
    );
    expect(inspection.bounds).toEqual(bounds);
  });
});

describe('computeRegionRenderSize', () => {
  it('applies base scale', () => {
    const size = computeRegionRenderSize(100, 50, { scale: 2, minDimension: 1, maxDimension: 4096 });
    expect(size.width).toBe(200);
    expect(size.height).toBe(100);
    expect(size.scale).toBe(2);
  });

  it('caps large regions while preserving aspect ratio', () => {
    const size = computeRegionRenderSize(4000, 2000, {
      scale: 2,
      maxDimension: 2048,
      minDimension: 1,
    });
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2048);
    expect(size.width / size.height).toBeCloseTo(2, 1);
  });

  it('upsales tiny handwriting regions to min dimension', () => {
    const size = computeRegionRenderSize(20, 10, {
      scale: 1,
      maxDimension: 2048,
      minDimension: 128,
    });
    expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(128);
    expect(size.width / size.height).toBeCloseTo(2, 1);
  });
});

describe('buildRagContext region image integration', () => {
  const regionBounds = { x: 0, y: 0, width: 120, height: 80 };

  it('empty / text-only: no region image attachment', () => {
    const empty = buildRagContext({
      query: 'Explain this.',
      explicitSelections: [],
      regionStructuredSelections: [],
      regionBounds,
      regionImage: null,
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(empty.imageAttachments).toHaveLength(0);
    expect(empty.regionImageContext).toBeNull();
    expect(empty.stats.region_image_attachment_count).toBe(0);

    const textOnly = buildRagContext({
      query: 'Explain this.',
      explicitSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: 'Hello',
          has_readable_content: true,
          geometry: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
      regionStructuredSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: 'Hello',
          has_readable_content: true,
          geometry: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
      regionBounds,
      regionImage: null,
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(textOnly.imageAttachments).toHaveLength(0);
    expect(textOnly.explicitlySelectedElements).toHaveLength(1);
    expect(textOnly.explicitlySelectedElements[0]?.text).toBe('Hello');
    expect(textOnly.serialized).not.toContain('SELECTED CANVAS REGION');
  });

  it('visual region attaches image with provenance + keeps structured text', () => {
    const ctx = buildRagContext({
      query: 'Explain this.',
      explicitSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: "Newton's second law",
          has_readable_content: true,
          geometry: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
      regionStructuredSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: "Newton's second law",
          has_readable_content: true,
          geometry: { x: 10, y: 10, width: 100, height: 40 },
        },
      ],
      regionBounds,
      regionImage: {
        worldBounds: regionBounds,
        asset_src: TINY_PNG,
        includedElementIds: ['textbox_1', 'pen_1'],
        containsUnstructuredVisuals: true,
      },
      semanticAnchors: [],
      spatialHits: [],
    });

    expect(ctx.stats.region_image_attachment_count).toBe(1);
    expect(ctx.imageAttachments[0]?.selection_reason).toBe(
      'explicit_region_selection',
    );
    expect(ctx.imageAttachments[0]?.element_type).toBe('region');
    expect(ctx.regionImageContext?.containsUnstructuredVisuals).toBe(true);
    expect(ctx.serialized).toContain('SELECTED CANVAS REGION');
    expect(ctx.serialized).toContain('explicit_region_selection');
    expect(ctx.serialized).toContain("Newton's second law");
    expect(ctx.serialized).not.toMatch(/\bOCR\b/);
  });

  it('region image outranks spatial images in budget', () => {
    const spatialHits = Array.from({ length: 4 }, (_, i) => ({
      element_id: `image_${i}`,
      element_type: 'image',
      anchor_element_id: 'textbox_1',
      distance: 10 + i,
      geometry: { x: 200 + i * 10, y: 0, width: 40, height: 40 },
      text: '',
      image_src: TINY_PNG,
    }));
    const anchor: SemanticAnchorInput = {
      element_id: 'textbox_1',
      element_type: 'text',
      similarity: 0.9,
      matched_chunks: [],
      geometry: { x: 0, y: 0, width: 40, height: 20 },
      text: 'anchor',
    };
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchor],
      spatialHits,
      regionBounds,
      regionImage: {
        worldBounds: regionBounds,
        asset_src: TINY_PNG,
        includedElementIds: ['pen_1'],
        containsUnstructuredVisuals: true,
      },
      maxImages: 2,
    });
    expect(ctx.imageAttachments[0]?.selection_reason).toBe(
      'explicit_region_selection',
    );
    // Region (required) + at most one more; spatial may be excluded.
    expect(
      ctx.imageAttachments.some(
        (a) => a.selection_reason === 'explicit_region_selection',
      ),
    ).toBe(true);
    expect(ctx.stats.truncated_by_image_budget).toBe(true);
  });

  it('dedupes structured textbox across explicit + region sources', () => {
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: 'once',
          has_readable_content: true,
          geometry: { x: 0, y: 0, width: 40, height: 20 },
        },
      ],
      regionStructuredSelections: [
        {
          element_id: 'textbox_1',
          element_type: 'text',
          text: 'once',
          has_readable_content: true,
          geometry: { x: 0, y: 0, width: 40, height: 20 },
        },
      ],
      regionBounds,
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(ctx.explicitlySelectedElements).toHaveLength(1);
    expect(
      ctx.explicitlySelectedElements[0]?.sources.some(
        (s) => s.type === 'explicit_selection',
      ),
    ).toBe(true);
    expect(
      ctx.explicitlySelectedElements[0]?.sources.some(
        (s) => s.type === 'explicit_region_selection',
      ),
    ).toBe(true);
  });
});

describe('LLM prompt region markers', () => {
  it('includes SELECTED CANVAS REGION and manual attachment marker', () => {
    const ctx = buildRagContext({
      query: 'Explain this.',
      semanticAnchors: [],
      spatialHits: [],
      regionBounds: { x: 1, y: 2, width: 30, height: 40 },
      regionImage: {
        worldBounds: { x: 1, y: 2, width: 30, height: 40 },
        asset_src: TINY_PNG,
        includedElementIds: ['pen_1'],
        containsUnstructuredVisuals: true,
      },
    });
    const built = buildLlmPrompt({
      userPrompt: 'Explain this.',
      ragContext: ctx,
    });
    expect(built.finalLlmPrompt).toContain('SELECTED CANVAS REGION');
    expect(built.finalLlmPrompt).toContain('SELECTED CANVAS REGION IMAGE');
    expect(built.finalLlmPrompt).toContain('Attachment required');
    expect(built.finalLlmPrompt).toContain('[MANUAL ATTACHMENT]');
    expect(built.finalLlmPrompt).toContain('Do NOT invent a machine transcription');
    expect(built.imageAttachments).toHaveLength(1);
    expect(built.imageAttachments[0]?.selection_reason).toBe(
      'explicit_region_selection',
    );
    expect(regionAttachmentId({ x: 1, y: 2, width: 30, height: 40 })).toContain(
      'region:',
    );
  });
});
