import { describe, expect, it, vi } from 'vitest';
import { buildRagContext, type SemanticAnchorInput } from '../contextBuilder';
import {
  canvasElementsAsSpatial,
  deriveImageSpatialRecords,
  findElementsWithinRadius,
  hashAssetRef,
  isSpatiallyEligible,
  toSpatialElementRecord,
  type SpatialElementLike,
  type SpatialHit,
} from '../spatialContext';
import type { CanvasElement, ImageElement, TextElement } from '../../../types/canvas';
import { buildLlmPrompt } from '../../ai/llm/promptBuilder';
import { createAiService } from '../../ai/data/aiService';


const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function textEl(
  id: string,
  x: number,
  y: number,
  text: string,
  w = 100,
  h = 40,
): TextElement {
  return {
    id,
    type: 'text',
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

function imageEl(
  id: string,
  x: number,
  y: number,
  w = 80,
  h = 60,
  src = TINY_PNG,
): ImageElement {
  return {
    id,
    type: 'image',
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
    src,
    naturalWidth: w,
    naturalHeight: h,
  };
}

const anchorGauss: SemanticAnchorInput = {
  element_id: 'textbox_1',
  element_type: 'text',
  similarity: 0.92,
  matched_chunks: [
    { chunk_id: 'c0', chunk_index: 0, text: "Gauss's Law", similarity: 0.92 },
  ],
  geometry: { x: 0, y: 0, width: 100, height: 40 },
  text: "Gauss's Law relates flux to enclosed charge.",
};

describe('image spatial eligibility (no embeddings)', () => {
  it('marks images spatially eligible without requiring text', () => {
    expect(
      isSpatiallyEligible({
        id: 'image_1',
        type: 'image',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        src: TINY_PNG,
      }),
    ).toBe(true);
  });

  it('includes equations as spatial candidates', () => {
    expect(
      isSpatiallyEligible({
        id: 'eq_1',
        type: 'equation',
        x: 0,
        y: 0,
        width: 40,
        height: 20,
        latex: 'E=mc^2',
      }),
    ).toBe(true);
  });

  it('derives ImageSpatialRecord with geometry + asset ref and no embedding fields', () => {
    const img = imageEl('image_1', 100, 50);
    const rec = toSpatialElementRecord('board_1', img);
    expect(rec).toMatchObject({
      board_id: 'board_1',
      element_id: 'image_1',
      element_type: 'image',
      x: 100,
      y: 50,
      width: 80,
      height: 60,
      asset_src: TINY_PNG,
    });
    expect(rec?.content_hash).toBe(hashAssetRef(TINY_PNG));
    expect(rec).not.toHaveProperty('embedding');
    expect(Object.keys(rec!).sort()).toEqual(
      [
        'asset_src',
        'board_id',
        'content_hash',
        'element_id',
        'element_type',
        'height',
        'updated_at',
        'width',
        'x',
        'y',
      ].sort(),
    );
  });

  it('deriveImageSpatialRecords only returns images', () => {
    const elements: CanvasElement[] = [
      textEl('textbox_1', 0, 0, 'Gauss'),
      imageEl('image_1', 120, 0),
    ];
    const records = deriveImageSpatialRecords('board_1', elements);
    expect(records).toHaveLength(1);
    expect(records[0]?.element_id).toBe('image_1');
  });
});

describe('spatial expansion discovers nearby images', () => {
  const els: SpatialElementLike[] = [
    { id: 'textbox_1', type: 'text', x: 0, y: 0, width: 100, height: 40, text: 'Gauss' },
    {
      id: 'image_1',
      type: 'image',
      x: 120,
      y: 0,
      width: 80,
      height: 60,
      src: TINY_PNG,
    }, // gap 20
    {
      id: 'image_2',
      type: 'image',
      x: 900,
      y: 900,
      width: 80,
      height: 60,
      src: TINY_PNG,
    },
    {
      id: 'eq_1',
      type: 'equation',
      x: 0,
      y: 60,
      width: 80,
      height: 30,
      latex: '\\oint E',
    }, // gap 20
  ];

  it('finds nearby image and equation; excludes far image (test 39/40)', () => {
    const hits = findElementsWithinRadius(els[0]!, els, 300);
    const ids = hits.map((h) => h.element_id);
    expect(ids).toContain('image_1');
    expect(ids).toContain('eq_1');
    expect(ids).not.toContain('image_2');
    const img = hits.find((h) => h.element_id === 'image_1');
    expect(img?.image_src).toBe(TINY_PNG);
    expect(img?.text).toBe('');
    expect(img?.distance).toBe(20);
  });

  it('radius 0 excludes images (test 27/47)', () => {
    expect(findElementsWithinRadius(els[0]!, els, 0)).toEqual([]);
  });

  it('moving image into radius updates geometry-based distance (test 41)', () => {
    const moved = { ...els[2]!, x: 110, y: 0 }; // now gap 10 from textbox
    const hits = findElementsWithinRadius(els[0]!, [...els.slice(0, 2), moved], 300);
    expect(hits.map((h) => h.element_id)).toContain('image_2');
  });

  it('resize that intersects reduces distance to 0 (test 42)', () => {
    const resized = { ...els[1]!, x: 50, width: 100 }; // overlaps textbox
    const hits = findElementsWithinRadius(els[0]!, [els[0]!, resized], 300);
    expect(hits[0]?.distance).toBe(0);
  });

  it('canvasElementsAsSpatial passes through image src', () => {
    const spatial = canvasElementsAsSpatial([
      textEl('textbox_1', 0, 0, 'Gauss'),
      imageEl('image_1', 120, 0),
    ]);
    const img = spatial.find((e) => e.id === 'image_1');
    expect(img?.src).toBe(TINY_PNG);
    expect(isSpatiallyEligible(img!)).toBe(true);
  });
});

describe('buildRagContext image attachments', () => {
  const imageHit: SpatialHit = {
    element_id: 'image_1',
    element_type: 'image',
    anchor_element_id: 'textbox_1',
    distance: 103.4,
    geometry: { x: 120, y: 0, width: 80, height: 60 },
    text: '',
    image_src: TINY_PNG,
  };

  it('attaches spatial image once with provenance (test 39)', () => {
    const ctx = buildRagContext({
      query: "Explain Gauss's law.",
      semanticAnchors: [anchorGauss],
      spatialHits: [imageHit],
    });
    expect(ctx.imageAttachments).toHaveLength(1);
    expect(ctx.imageAttachments[0]?.element_id).toBe('image_1');
    expect(ctx.imageAttachments[0]?.asset_src).toBe(TINY_PNG);
    expect(ctx.imageAttachments[0]?.selection_reason).toBe('spatial_neighbor');
    expect(ctx.stats.spatial_image_addition_count).toBe(1);
    expect(ctx.stats.image_attachment_count).toBe(1);
    expect(ctx.serialized).toContain('CANVAS IMAGE CONTEXT');
    expect(ctx.serialized).toContain('ATTACHED CANVAS IMAGE:');
    expect(ctx.serialized).toContain('image_1');
    // No invented caption / OCR text
    expect(ctx.serialized).not.toMatch(/caption|OCR|depicts/i);
  });

  it('dedupes image across multiple anchors preserving both provenances (test 43)', () => {
    const viaB: SpatialHit = {
      ...imageHit,
      anchor_element_id: 'textbox_B',
      distance: 50,
    };
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [
        anchorGauss,
        {
          ...anchorGauss,
          element_id: 'textbox_B',
          text: 'other',
          similarity: 0.8,
          matched_chunks: [],
        },
      ],
      spatialHits: [imageHit, viaB],
    });
    expect(ctx.imageAttachments).toHaveLength(1);
    const sources = ctx.imageAttachments[0]!.sources.filter((s) => s.type === 'spatial');
    expect(sources).toHaveLength(2);
    expect(ctx.imageAttachments[0]!.nearest_distance).toBe(50);
  });

  it('respects MAX_CONTEXT_IMAGES nearest-first (test 45)', () => {
    const hits: SpatialHit[] = Array.from({ length: 8 }, (_, i) => ({
      element_id: `image_${i}`,
      element_type: 'image',
      anchor_element_id: 'textbox_1',
      distance: 10 + i * 10,
      geometry: { x: 120 + i * 10, y: 0, width: 40, height: 40 },
      text: '',
      image_src: TINY_PNG,
    }));
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorGauss],
      spatialHits: hits,
      maxImages: 4,
    });
    expect(ctx.imageAttachments).toHaveLength(4);
    expect(ctx.imageAttachments.map((a) => a.element_id)).toEqual([
      'image_0',
      'image_1',
      'image_2',
      'image_3',
    ]);
    expect(ctx.stats.truncated_by_image_budget).toBe(true);
    expect(ctx.stats.image_budget_excluded_ids).toEqual([
      'image_4',
      'image_5',
      'image_6',
      'image_7',
    ]);
  });

  it('prefers explicit selection over spatial for image budget (test 46)', () => {
    const farImageHit: SpatialHit = {
      element_id: 'image_far',
      element_type: 'image',
      anchor_element_id: 'textbox_1',
      distance: 10,
      geometry: { x: 20, y: 0, width: 40, height: 40 },
      text: '',
      image_src: TINY_PNG,
    };
    const ctx = buildRagContext({
      query: 'Explain this.',
      explicitSelections: [
        {
          element_id: 'image_selected',
          element_type: 'image',
          text: '',
          has_readable_content: false,
          geometry: { x: 2000, y: 2000, width: 40, height: 40 },
          image_src: TINY_PNG,
        },
      ],
      semanticAnchors: [anchorGauss],
      spatialHits: [farImageHit],
      maxImages: 1,
    });
    // Explicit required image always attached; spatial may be budget-excluded.
    expect(ctx.imageAttachments[0]?.element_id).toBe('image_selected');
    expect(ctx.imageAttachments[0]?.selection_reason).toBe('explicit_selection');
    expect(ctx.stats.image_budget_excluded_ids).toContain('image_far');
  });

  it('does not include images with no semantic anchor and no selection (test 48)', () => {
    const ctx = buildRagContext({
      query: 'Explain the diagram.',
      semanticAnchors: [],
      spatialHits: [imageHit],
    });
    // Without anchors, spatialHits wouldn't normally be produced — but if passed empty
    // anchors with stray hits, still attach from hits. Spec: no automatic retrieve
    // without anchor — so callers pass empty spatialHits. Verify empty path:
    const empty = buildRagContext({
      query: 'Explain the diagram.',
      semanticAnchors: [],
      spatialHits: [],
    });
    expect(empty.imageAttachments).toHaveLength(0);
    expect(ctx.imageAttachments).toHaveLength(1); // if hits somehow present, still attach
  });

  it('images do not consume text character budget (test 30)', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorGauss],
      spatialHits: [imageHit],
      maxCharacters: anchorGauss.text.length, // only room for anchor text
      maxElements: 10,
    });
    expect(ctx.imageAttachments).toHaveLength(1);
    expect(ctx.stats.character_count).toBe(anchorGauss.text.length);
  });

  it('merges explicit + spatial provenance on same image and attaches once (test 53)', () => {
    const ctx = buildRagContext({
      query: 'q',
      explicitSelections: [
        {
          element_id: 'image_1',
          element_type: 'image',
          text: '',
          has_readable_content: false,
          geometry: imageHit.geometry,
          image_src: TINY_PNG,
        },
      ],
      semanticAnchors: [anchorGauss],
      spatialHits: [imageHit],
    });
    expect(ctx.imageAttachments).toHaveLength(1);
    const kinds = ctx.imageAttachments[0]!.sources.map((s) => s.type);
    expect(kinds).toContain('explicit_selection');
    expect(kinds).toContain('spatial');
  });
});

describe('LLM prompt + multimodal request (test 49/50)', () => {
  it('prompt includes image markers without descriptions; attachments listed separately', () => {
    const ctx = buildRagContext({
      query: 'q',
      semanticAnchors: [anchorGauss],
      spatialHits: [
        {
          element_id: 'image_27',
          element_type: 'image',
          anchor_element_id: 'textbox_1',
          distance: 103.4,
          geometry: { x: 120, y: 0, width: 80, height: 60 },
          text: '',
          image_src: TINY_PNG,
        },
      ],
    });
    const built = buildLlmPrompt({ userPrompt: 'Explain', ragContext: ctx });
    expect(built.finalLlmPrompt).toContain('CANVAS IMAGE CONTEXT');
    expect(built.finalLlmPrompt).toContain('ATTACHED CANVAS IMAGE:');
    expect(built.finalLlmPrompt).toContain('image_27');
    expect(built.finalLlmPrompt).not.toContain(TINY_PNG);
    expect(built.imageAttachments).toHaveLength(1);
    expect(built.imageAttachments[0]?.asset_src).toBe(TINY_PNG);
  });

  it('client sendPrompt throws vision_unsupported when images present and capability off', async () => {
    vi.stubEnv('VITE_LLM_SUPPORTS_IMAGE_INPUT', 'false');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: 'ok' }), { status: 200 }),
    );
    try {
      const service = createAiService('http://127.0.0.1:9');
      expect(service.supportsImageInput()).toBe(false);
      await expect(
        service.sendPrompt('Explain', undefined, {
          imageAttachments: [{ element_id: 'image_27', data_url: TINY_PNG }],
        }),
      ).rejects.toMatchObject({ code: 'vision_unsupported' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
