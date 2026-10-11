/**
 * RagContextBuilder — assembles LLM-ready canvas context from:
 * explicit editor selection + semantic anchors + spatial + semantic expansion.
 * Pure functions; no UI / no canvas renderer coupling.
 *
 * Textual context and multimodal image attachments are budgeted separately.
 */

import type { MatchedChunk, RetrievedCandidate } from './ragRetrieval';
import type { SpatialHit } from './spatialContext';
import type { SemanticNeighborHit } from './semanticExpansion';
import type { ExplicitSelectionInput } from './explicitSelection';
import type { WorldRect } from './geometry';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_MAX_CONTEXT_IMAGES,
} from './config';

export type RetrievalSourceType =
  | 'explicit_selection'
  | 'explicit_region_selection'
  | 'semantic'
  | 'spatial'
  | 'semantic_neighbor';

export interface ExplicitSelectionSource {
  type: 'explicit_selection';
}

/** Provenance for content included because it intersects an explicit marquee region. */
export interface ExplicitRegionSelectionSource {
  type: 'explicit_region_selection';
  world_bounds: WorldRect;
}

export interface SemanticSource {
  type: 'semantic';
  similarity: number;
  matched_chunks: MatchedChunk[];
}

export interface SpatialSource {
  type: 'spatial';
  anchor_element_id: string;
  distance: number;
}

export interface SemanticNeighborSource {
  type: 'semantic_neighbor';
  parent_element_id: string;
  root_anchor_element_id: string;
  depth: number;
  similarity: number;
}

export type ElementProvenance =
  | ExplicitSelectionSource
  | ExplicitRegionSelectionSource
  | SemanticSource
  | SpatialSource
  | SemanticNeighborSource;

export type ElementInclusion =
  | 'explicit_selection'
  | 'explicit_region_selection'
  | 'semantic'
  | 'spatial'
  | 'semantic_neighbor'
  | 'both';

export interface RagContextElement {
  element_id: string;
  element_type: string;
  text: string;
  geometry: WorldRect;
  sources: ElementProvenance[];
  /** Convenience label; 'both' when multiple source kinds. */
  inclusion: ElementInclusion;
  /** Best prompt-semantic similarity if any */
  similarity: number | null;
  /** Nearest distance to any selected anchor (spatial); null if none */
  nearest_distance: number | null;
  /** Best semantic-neighbor similarity if any */
  semantic_neighbor_similarity: number | null;
  /** Image asset reference when element_type === 'image'. Not a caption. */
  image_src?: string | null;
}

/** Multimodal attachment — binary/image data stays out of text context strings. */
export interface RagContextImageAttachment {
  element_id: string;
  element_type: 'image' | 'region' | 'handwriting_region';
  /** Asset reference (data URL / storage URL) resolved from CanvasDocument or region render. */
  asset_src: string;
  geometry: WorldRect;
  sources: ElementProvenance[];
  /** Nearest spatial distance if any; null for explicit-only / region. */
  nearest_distance: number | null;
  /**
   * Why this image was selected into the attachment budget.
   * Priority: explicit_region_selection > explicit_selection >
   *           semantic_handwriting > spatial_neighbor.
   */
  selection_reason:
    | 'explicit_region_selection'
    | 'explicit_selection'
    | 'semantic_handwriting'
    | 'spatial_neighbor';
  /** Present when element_type === 'region' | 'handwriting_region'. */
  region?: {
    included_element_ids: string[];
    contains_unstructured_visuals: boolean;
  };
  /** Derived OCR preview for debug only — never authoritative for the LLM. */
  ocr_transcription?: string | null;
}

/** Selected-region visual context (transient — not stored in CanvasDocument). */
export interface CanvasRegionImageContext {
  worldBounds: WorldRect;
  imageAttachment: RagContextImageAttachment;
  provenance: ExplicitRegionSelectionSource;
  includedElementIds: string[];
  containsUnstructuredVisuals: boolean;
}

export interface RagContextStats {
  explicit_selection_count: number;
  semantic_anchor_count: number;
  spatial_addition_count: number;
  spatial_text_addition_count: number;
  spatial_equation_addition_count: number;
  spatial_image_addition_count: number;
  spatial_graph_addition_count: number;
  semantic_depth1_addition_count: number;
  semantic_depth2_addition_count: number;
  unique_semantic_addition_count: number;
  image_attachment_count: number;
  image_budget_excluded_count: number;
  region_image_attachment_count: number;
  total_unique_elements: number;
  character_count: number;
  word_count: number;
  truncated_by_element_budget: boolean;
  truncated_by_character_budget: boolean;
  truncated_by_image_budget: boolean;
  /** True when required (explicit) context alone exceeds configured budgets. */
  required_context_exceeds_budget: boolean;
  /** Element IDs dropped solely because MAX_CONTEXT_IMAGES was hit. */
  image_budget_excluded_ids: string[];
}

export interface RagContext {
  query: string;
  explicitlySelectedElements: RagContextElement[];
  semanticAnchors: RagContextElement[];
  spatialElements: RagContextElement[];
  semanticNeighborElements: RagContextElement[];
  allElements: RagContextElement[];
  /** Deduplicated multimodal attachments (actual images for the LLM). */
  imageAttachments: RagContextImageAttachment[];
  /** Transient selected-region visual context (null when no region image). */
  regionImageContext: CanvasRegionImageContext | null;
  stats: RagContextStats;
  /** Deterministic serialized payload for the LLM (text only — no raw bytes). */
  serialized: string;
}

export interface SemanticAnchorInput {
  element_id: string;
  element_type: string;
  similarity: number;
  matched_chunks: MatchedChunk[];
  geometry: WorldRect;
  /** Full TextElement text from CanvasDocument */
  text: string;
}

/** Pre-rendered selected-region image (from CanvasRegionRenderer). */
export interface RegionImageInput {
  worldBounds: WorldRect;
  asset_src: string;
  includedElementIds: string[];
  containsUnstructuredVisuals: boolean;
}

/** Pre-rendered handwriting-region crop (strokes only) for multimodal LLM context. */
export interface HandwritingImageInput {
  region_id: string;
  asset_src: string;
  geometry: WorldRect;
  stroke_ids: string[];
  ocr_transcription?: string | null;
  /** How this handwriting item entered context. */
  reason: 'semantic_handwriting' | 'spatial_neighbor';
  sources?: ElementProvenance[];
  nearest_distance?: number | null;
}

export interface BuildRagContextOptions {
  query: string;
  /** Editor selection snapshot — highest priority, always retained. */
  explicitSelections?: ExplicitSelectionInput[];
  /**
   * Structured elements intersecting an explicit marquee region.
   * Merged with explicitSelections (deduped by element_id); provenance tagged.
   */
  regionStructuredSelections?: ExplicitSelectionInput[];
  /** World bounds of the snapshotted marquee (for provenance). */
  regionBounds?: WorldRect | null;
  /** When visual content was detected and rendered — attach as required multimodal input. */
  regionImage?: RegionImageInput | null;
  /** Recognized handwriting regions that should attach original stroke crops. */
  handwritingImages?: HandwritingImageInput[];
  semanticAnchors: SemanticAnchorInput[];
  /** Raw spatial hits (may include duplicates across anchors / overlap with anchors) */
  spatialHits: SpatialHit[];
  /** Semantic knowledge expansion hits (debug-selected) */
  semanticNeighborHits?: SemanticNeighborHit[];
  maxElements?: number;
  maxCharacters?: number;
  maxImages?: number;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function sourceKind(s: ElementProvenance): RetrievalSourceType {
  return s.type;
}

function inclusionOf(sources: ElementProvenance[]): ElementInclusion {
  const kinds = new Set(sources.map(sourceKind));
  if (kinds.size === 1) {
    return [...kinds][0]!;
  }
  return 'both';
}

function nearestDistance(sources: ElementProvenance[]): number | null {
  let best: number | null = null;
  for (const s of sources) {
    if (s.type === 'spatial') {
      if (best === null || s.distance < best) best = s.distance;
    }
  }
  return best;
}

function bestSemanticNeighborSim(sources: ElementProvenance[]): number | null {
  let best: number | null = null;
  for (const s of sources) {
    if (s.type === 'semantic_neighbor') {
      if (best === null || s.similarity > best) best = s.similarity;
    }
  }
  return best;
}

function bestPromptSimilarity(sources: ElementProvenance[]): number | null {
  for (const s of sources) {
    if (s.type === 'semantic') return s.similarity;
  }
  return null;
}

function refreshDerived(el: RagContextElement): void {
  el.inclusion = inclusionOf(el.sources);
  el.similarity = bestPromptSimilarity(el.sources);
  el.nearest_distance = nearestDistance(el.sources);
  el.semantic_neighbor_similarity = bestSemanticNeighborSim(el.sources);
}

function isImageElement(el: { element_type: string }): boolean {
  return el.element_type === 'image';
}

function isGraphElement(el: { element_type: string }): boolean {
  return el.element_type === 'graph';
}

function isHandwritingRegion(el: { element_type: string }): boolean {
  return el.element_type === 'handwriting_region';
}

function formatElementBlock(el: RagContextElement): string {
  const lines: string[] = [];
  lines.push('ELEMENT');
  lines.push(`ID: ${el.element_id}`);
  lines.push(`TYPE: ${el.element_type}`);
  lines.push(`SOURCE: ${el.inclusion}`);
  if (el.sources.some((s) => s.type === 'explicit_selection')) {
    lines.push('EXPLICIT_SELECTION: yes');
  }
  if (el.sources.some((s) => s.type === 'explicit_region_selection')) {
    lines.push('EXPLICIT_REGION_SELECTION: yes');
  }
  if (el.similarity !== null) {
    lines.push(`SIMILARITY: ${el.similarity.toFixed(4)}`);
  }
  const spatialSources = el.sources.filter(
    (s): s is SpatialSource => s.type === 'spatial',
  );
  for (const s of spatialSources) {
    lines.push(`NEAR: ${s.anchor_element_id}`);
    lines.push(`DISTANCE: ${s.distance.toFixed(2)}`);
  }
  const semNeigh = el.sources.filter(
    (s): s is SemanticNeighborSource => s.type === 'semantic_neighbor',
  );
  for (const s of semNeigh) {
    lines.push(`SEMANTIC_NEIGHBOR_OF: ${s.parent_element_id}`);
    lines.push(`ROOT_ANCHOR: ${s.root_anchor_element_id}`);
    lines.push(`SEMANTIC_DEPTH: ${s.depth}`);
    lines.push(`SEMANTIC_SIMILARITY: ${s.similarity.toFixed(4)}`);
  }
  lines.push(
    `POSITION: x=${el.geometry.x}, y=${el.geometry.y}, width=${el.geometry.width}, height=${el.geometry.height}`,
  );
  if (isImageElement(el)) {
    lines.push('ATTACHED CANVAS IMAGE:');
    lines.push(el.element_id);
    lines.push('(image bytes are supplied as a multimodal attachment — not described here)');
  } else if (isGraphElement(el)) {
    // Structured GraphContext body (already includes GRAPH ELEMENT header).
    lines.push(el.text || '(empty graph)');
  } else if (isHandwritingRegion(el)) {
    lines.push('HANDWRITTEN CANVAS CONTEXT');
    lines.push(`Element/Region ID: ${el.element_id}`);
    lines.push(
      'This region was retrieved because its local OCR transcription was semantically related to the request.',
    );
    lines.push(
      'The ORIGINAL handwritten region is attached as an image. Interpret the attached handwriting directly.',
    );
    if (el.text.trim()) {
      lines.push('DERIVED OCR TRANSCRIPTION — MAY CONTAIN ERRORS (retrieval aid only):');
      lines.push(el.text);
    }
    lines.push('ATTACHED HANDWRITING REGION IMAGE:');
    lines.push(el.element_id);
  } else {
    lines.push('TEXT:');
    lines.push(el.text || '(empty)');
  }
  return lines.join('\n');
}

function formatImageAttachmentBlock(att: RagContextImageAttachment): string {
  if (att.element_type === 'region' || att.selection_reason === 'explicit_region_selection') {
    const lines: string[] = [
      'SELECTED CANVAS REGION IMAGE',
      `REGION ID: ${att.element_id}`,
      'SOURCE: explicit_region_selection',
      `BOUNDS: x=${att.geometry.x}, y=${att.geometry.y}, width=${att.geometry.width}, height=${att.geometry.height}`,
    ];
    if (att.region?.included_element_ids.length) {
      lines.push(`INCLUDED ELEMENTS: ${att.region.included_element_ids.join(', ')}`);
    }
    lines.push('ATTACHED CANVAS REGION IMAGE:');
    lines.push(att.element_id);
    lines.push('(image bytes are supplied as a multimodal attachment — not OCR’d here)');
    return lines.join('\n');
  }

  if (
    att.element_type === 'handwriting_region' ||
    att.selection_reason === 'semantic_handwriting'
  ) {
    const lines: string[] = [
      'HANDWRITTEN REGION IMAGE',
      `REGION ID: ${att.element_id}`,
      `SOURCE: ${att.selection_reason}`,
      `BOUNDS: x=${att.geometry.x}, y=${att.geometry.y}, width=${att.geometry.width}, height=${att.geometry.height}`,
    ];
    if (att.ocr_transcription) {
      lines.push('DERIVED OCR TRANSCRIPTION — MAY CONTAIN ERRORS (retrieval aid only):');
      lines.push(att.ocr_transcription);
    }
    lines.push('ATTACHED HANDWRITING REGION IMAGE:');
    lines.push(att.element_id);
    lines.push(
      '(original strokes as multimodal attachment — interpret the image, not the OCR text)',
    );
    return lines.join('\n');
  }

  const lines: string[] = [
    'IMAGE',
    `IMAGE ELEMENT ID: ${att.element_id}`,
    `SOURCE: ${att.selection_reason}`,
  ];
  for (const s of att.sources) {
    if (s.type === 'explicit_selection') {
      lines.push('EXPLICIT_SELECTION: yes');
    }
    if (s.type === 'spatial') {
      lines.push(`SPATIAL ANCHOR: ${s.anchor_element_id}`);
      lines.push(`DISTANCE: ${s.distance.toFixed(1)}`);
    }
  }
  lines.push(
    `BOUNDS: x=${att.geometry.x}, y=${att.geometry.y}, width=${att.geometry.width}, height=${att.geometry.height}`,
  );
  lines.push('ATTACHED CANVAS IMAGE:');
  lines.push(att.element_id);
  return lines.join('\n');
}

function formatSelectedRegionSection(
  region: CanvasRegionImageContext | null,
): string {
  if (!region) return '';
  const g = region.worldBounds;
  return [
    'SELECTED CANVAS REGION',
    '',
    'The user explicitly selected the following region of the canvas.',
    'The corresponding image is attached.',
    'The region may contain handwritten text, mathematics, sketches, diagrams, or relationships between canvas elements.',
    'Use the visual content when interpreting references such as "this", "these", "what I wrote", or "this diagram".',
    'Do NOT invent a machine transcription.',
    '',
    'SOURCE: explicit_region_selection',
    `BOUNDS: x=${g.x}, y=${g.y}, width=${g.width}, height=${g.height}`,
    `INCLUDED ELEMENTS: ${region.includedElementIds.join(', ') || '(none)'}`,
    'ATTACHED CANVAS REGION IMAGE:',
    region.imageAttachment.element_id,
  ].join('\n');
}

/** Deterministic serialization for LLM consumption (text + image markers only). */
export function serializeRagContext(
  query: string,
  elements: readonly RagContextElement[],
  explicitlySelected: readonly RagContextElement[] = [],
  imageAttachments: readonly RagContextImageAttachment[] = [],
  regionImageContext: CanvasRegionImageContext | null = null,
): string {
  if (
    elements.length === 0 &&
    imageAttachments.length === 0 &&
    !regionImageContext
  ) {
    return 'CANVAS CONTEXT\n\n(none selected)';
  }

  const sections: string[] = [
    'CANVAS CONTEXT',
    `QUERY: ${query}`,
    `ELEMENTS: ${elements.length}`,
  ];

  const regionSection = formatSelectedRegionSection(regionImageContext);
  if (regionSection) {
    sections.push('');
    sections.push(regionSection);
  }

  if (explicitlySelected.length > 0) {
    sections.push('');
    sections.push('EXPLICITLY SELECTED CANVAS ELEMENTS');
    sections.push(
      'These elements were selected by the user. Strong contextual signal.',
    );
    sections.push('');
    sections.push(explicitlySelected.map(formatElementBlock).join('\n\n'));
  }

  const supporting = elements.filter(
    (el) =>
      !el.sources.some(
        (s) =>
          s.type === 'explicit_selection' || s.type === 'explicit_region_selection',
      ),
  );
  if (supporting.length > 0) {
    sections.push('');
    sections.push('RETRIEVED SUPPORTING CONTEXT');
    sections.push('');
    sections.push(supporting.map(formatElementBlock).join('\n\n'));
  } else if (explicitlySelected.length === 0 && elements.length > 0 && !regionImageContext) {
    sections.push('');
    sections.push(elements.map(formatElementBlock).join('\n\n'));
  }

  const nonRegionImages = imageAttachments.filter(
    (a) => a.selection_reason !== 'explicit_region_selection',
  );
  if (nonRegionImages.length > 0) {
    sections.push('');
    sections.push('CANVAS IMAGE CONTEXT');
    sections.push(
      'The following images are attached as multimodal input. Inspect the images directly; do not invent descriptions.',
    );
    sections.push('');
    sections.push(nonRegionImages.map(formatImageAttachmentBlock).join('\n\n'));
  }

  return sections.join('\n');
}

function attachSemanticNeighborSources(
  existing: RagContextElement,
  hits: SemanticNeighborHit[],
): void {
  for (const hit of hits) {
    existing.sources.push({
      type: 'semantic_neighbor',
      parent_element_id: hit.parent_element_id,
      root_anchor_element_id: hit.root_anchor_element_id,
      depth: hit.depth,
      similarity: hit.similarity,
    });
  }
  refreshDerived(existing);
}

function makeElement(
  partial: Omit<
    RagContextElement,
    'inclusion' | 'similarity' | 'nearest_distance' | 'semantic_neighbor_similarity'
  > &
    Partial<
      Pick<
        RagContextElement,
        'inclusion' | 'similarity' | 'nearest_distance' | 'semantic_neighbor_similarity'
      >
    >,
): RagContextElement {
  const el: RagContextElement = {
    element_id: partial.element_id,
    element_type: partial.element_type,
    text: partial.text,
    geometry: partial.geometry,
    sources: partial.sources,
    inclusion: partial.inclusion ?? 'semantic',
    similarity: partial.similarity ?? null,
    nearest_distance: partial.nearest_distance ?? null,
    semantic_neighbor_similarity: partial.semantic_neighbor_similarity ?? null,
    image_src: partial.image_src ?? null,
  };
  refreshDerived(el);
  return el;
}

/**
 * Merge explicit selection + region + anchors + spatial + semantic-neighbor hits.
 * Dedupes by element_id. Explicit / region selections always survive budgeting.
 *
 * Text budget priority (trim first → last):
 * 1. semantic-neighbor additions
 * 2. spatial text/equation additions
 * Required (never trimmed for text budget):
 * - explicitly selected elements
 * - region-structured elements
 * - semantic anchors
 *
 * Image budget (separate), priority high → low:
 * 1. explicit region selection image (required)
 * 2. explicitly selected images (required; may exceed budget → flag)
 * 3. nearest spatial images (dropped first under budget pressure)
 */
export function buildRagContext(options: BuildRagContextOptions): RagContext {
  const maxElements = options.maxElements ?? RAG_MAX_CONTEXT_ELEMENTS;
  const maxCharacters = options.maxCharacters ?? RAG_MAX_CONTEXT_CHARACTERS;
  const maxImages = options.maxImages ?? RAG_MAX_CONTEXT_IMAGES;
  const explicitSelections = options.explicitSelections ?? [];
  const regionStructuredSelections = options.regionStructuredSelections ?? [];
  const regionBounds = options.regionBounds ?? null;
  const regionImage = options.regionImage ?? null;
  const semanticNeighborHits = options.semanticNeighborHits ?? [];

  const byId = new Map<string, RagContextElement>();

  const regionProvenance = (): ExplicitRegionSelectionSource | null =>
    regionBounds
      ? { type: 'explicit_region_selection', world_bounds: { ...regionBounds } }
      : null;

  // 1. Explicit editor selection — highest priority, always retained.
  for (const sel of explicitSelections) {
    byId.set(
      sel.element_id,
      makeElement({
        element_id: sel.element_id,
        element_type: sel.element_type,
        text: sel.text,
        geometry: sel.geometry,
        sources: [{ type: 'explicit_selection' }],
        image_src: sel.image_src ?? null,
      }),
    );
  }

  // 1b. Region-structured elements (e.g. textboxes inside marquee) — merge / add.
  for (const sel of regionStructuredSelections) {
    const regionSource = regionProvenance();
    const existing = byId.get(sel.element_id);
    if (existing) {
      if (
        regionSource &&
        !existing.sources.some((s) => s.type === 'explicit_region_selection')
      ) {
        existing.sources.push(regionSource);
      }
      if (sel.text.length > existing.text.length) existing.text = sel.text;
      refreshDerived(existing);
      continue;
    }
    byId.set(
      sel.element_id,
      makeElement({
        element_id: sel.element_id,
        element_type: sel.element_type,
        text: sel.text,
        geometry: sel.geometry,
        sources: regionSource
          ? [regionSource]
          : [{ type: 'explicit_selection' }],
        image_src: sel.image_src ?? null,
      }),
    );
  }

  // 2. Semantic anchors (merge into existing if also explicitly selected).
  for (const anchor of options.semanticAnchors) {
    const existing = byId.get(anchor.element_id);
    if (existing) {
      existing.sources.push({
        type: 'semantic',
        similarity: anchor.similarity,
        matched_chunks: anchor.matched_chunks,
      });
      if (anchor.text.length > existing.text.length) existing.text = anchor.text;
      refreshDerived(existing);
      continue;
    }
    byId.set(
      anchor.element_id,
      makeElement({
        element_id: anchor.element_id,
        element_type: anchor.element_type,
        text: anchor.text,
        geometry: anchor.geometry,
        sources: [
          {
            type: 'semantic',
            similarity: anchor.similarity,
            matched_chunks: anchor.matched_chunks,
          },
        ],
        similarity: anchor.similarity,
      }),
    );
  }

  // 3. Collect spatial candidates — split images vs textual.
  type SpatialCandidate = {
    element_id: string;
    element_type: string;
    text: string;
    geometry: WorldRect;
    spatialSources: SpatialSource[];
    nearest: number;
    image_src?: string;
  };
  const spatialTextMap = new Map<string, SpatialCandidate>();
  const spatialImageMap = new Map<string, SpatialCandidate>();

  for (const hit of options.spatialHits) {
    const source: SpatialSource = {
      type: 'spatial',
      anchor_element_id: hit.anchor_element_id,
      distance: hit.distance,
    };

    if (byId.has(hit.element_id)) {
      const existing = byId.get(hit.element_id)!;
      existing.sources.push(source);
      if (hit.image_src && !existing.image_src) {
        existing.image_src = hit.image_src;
      }
      refreshDerived(existing);
      continue;
    }

    const targetMap = hit.element_type === 'image' ? spatialImageMap : spatialTextMap;
    const prev = targetMap.get(hit.element_id);
    if (!prev) {
      targetMap.set(hit.element_id, {
        element_id: hit.element_id,
        element_type: hit.element_type,
        text: hit.text,
        geometry: hit.geometry,
        spatialSources: [source],
        nearest: hit.distance,
        image_src: hit.image_src,
      });
    } else {
      prev.spatialSources.push(source);
      if (hit.distance < prev.nearest) prev.nearest = hit.distance;
      if (hit.text.length > prev.text.length) prev.text = hit.text;
      if (hit.image_src && !prev.image_src) prev.image_src = hit.image_src;
    }
  }

  const spatialTextOrdered = Array.from(spatialTextMap.values()).sort(
    (a, b) => a.nearest - b.nearest || a.element_id.localeCompare(b.element_id),
  );
  const spatialImageOrdered = Array.from(spatialImageMap.values()).sort(
    (a, b) => a.nearest - b.nearest || a.element_id.localeCompare(b.element_id),
  );

  const explicitlySelectedElements: RagContextElement[] = [];
  const seenExplicit = new Set<string>();
  for (const sel of [...explicitSelections, ...regionStructuredSelections]) {
    if (seenExplicit.has(sel.element_id)) continue;
    const el = byId.get(sel.element_id);
    if (!el) continue;
    seenExplicit.add(sel.element_id);
    explicitlySelectedElements.push(el);
  }
  const semanticAnchors: RagContextElement[] = options.semanticAnchors.map(
    (a) => byId.get(a.element_id)!,
  );

  // Required elements for text budget baseline (unique). Images still listed
  // in allElements but do not consume character budget.
  const requiredElements: RagContextElement[] = [];
  const seenRequired = new Set<string>();
  for (const el of [...explicitlySelectedElements, ...semanticAnchors]) {
    if (seenRequired.has(el.element_id)) continue;
    seenRequired.add(el.element_id);
    requiredElements.push(el);
  }

  const requiredTextForBudget = requiredElements.filter((el) => !isImageElement(el));
  let charUsed = requiredTextForBudget.reduce((n, el) => n + el.text.length, 0);
  let truncatedByElements = false;
  let truncatedByChars = false;
  const requiredExceedsBudget =
    requiredTextForBudget.length > maxElements || charUsed > maxCharacters;

  if (requiredExceedsBudget) {
    truncatedByElements = requiredTextForBudget.length > maxElements;
    truncatedByChars = charUsed > maxCharacters;
  }

  // Spatial textual additions (text / equation / labeled shape).
  const spatialElements: RagContextElement[] = [];
  for (const cand of spatialTextOrdered) {
    const acceptedCount =
      requiredTextForBudget.length +
      spatialElements.filter((e) => !isImageElement(e)).length;
    if (acceptedCount >= maxElements) {
      truncatedByElements = true;
      break;
    }
    const nextChars = charUsed + cand.text.length;
    if (nextChars > maxCharacters && acceptedCount > 0) {
      truncatedByChars = true;
      break;
    }

    const el = makeElement({
      element_id: cand.element_id,
      element_type: cand.element_type,
      text: cand.text,
      geometry: cand.geometry,
      sources: [...cand.spatialSources],
      nearest_distance: cand.nearest,
      image_src: cand.image_src ?? null,
    });
    spatialElements.push(el);
    byId.set(el.element_id, el);
    charUsed = nextChars;
  }

  // 4. Semantic neighbor hits (textual only path).
  type SemCand = {
    element_id: string;
    element_type: string;
    text: string;
    geometry: WorldRect;
    hits: SemanticNeighborHit[];
    bestSim: number;
  };
  const semMap = new Map<string, SemCand>();
  const hitsByElement = new Map<string, SemanticNeighborHit[]>();
  for (const hit of semanticNeighborHits) {
    const list = hitsByElement.get(hit.element_id) ?? [];
    list.push(hit);
    hitsByElement.set(hit.element_id, list);
  }

  for (const [elementId, hits] of hitsByElement) {
    if (byId.has(elementId)) {
      attachSemanticNeighborSources(byId.get(elementId)!, hits);
      continue;
    }
    const first = hits[0]!;
    const bestSim = Math.max(...hits.map((h) => h.similarity));
    semMap.set(elementId, {
      element_id: elementId,
      element_type: first.element_type,
      text: first.text,
      geometry: first.geometry,
      hits,
      bestSim,
    });
  }

  const semOrdered = Array.from(semMap.values()).sort(
    (a, b) => b.bestSim - a.bestSim || a.element_id.localeCompare(b.element_id),
  );

  const semanticNeighborElements: RagContextElement[] = [];
  charUsed = [
    ...requiredTextForBudget,
    ...spatialElements.filter((e) => !isImageElement(e)),
  ].reduce((n, el) => n + el.text.length, 0);

  for (const cand of semOrdered) {
    const acceptedCount =
      requiredTextForBudget.length +
      spatialElements.filter((e) => !isImageElement(e)).length +
      semanticNeighborElements.length;
    if (acceptedCount >= maxElements) {
      truncatedByElements = true;
      break;
    }
    const nextChars = charUsed + cand.text.length;
    if (nextChars > maxCharacters && acceptedCount > 0) {
      truncatedByChars = true;
      break;
    }

    const sources: ElementProvenance[] = cand.hits.map((hit) => ({
      type: 'semantic_neighbor' as const,
      parent_element_id: hit.parent_element_id,
      root_anchor_element_id: hit.root_anchor_element_id,
      depth: hit.depth,
      similarity: hit.similarity,
    }));
    const el = makeElement({
      element_id: cand.element_id,
      element_type: cand.element_type,
      text: cand.text,
      geometry: cand.geometry,
      sources,
      semantic_neighbor_similarity: cand.bestSim,
    });
    semanticNeighborElements.push(el);
    byId.set(el.element_id, el);
    charUsed = nextChars;
  }

  // 5. Image attachment budget —
  //    region → explicit images → semantic handwriting → spatial images/handwriting.
  type ImageCand = {
    element_id: string;
    element_type: 'image' | 'region' | 'handwriting_region';
    geometry: WorldRect;
    sources: ElementProvenance[];
    nearest: number | null;
    asset_src: string;
    selection_reason:
      | 'explicit_region_selection'
      | 'explicit_selection'
      | 'semantic_handwriting'
      | 'spatial_neighbor';
    explicitOrder: number;
    region?: {
      included_element_ids: string[];
      contains_unstructured_visuals: boolean;
    };
    ocr_transcription?: string | null;
  };

  const imageCandMap = new Map<string, ImageCand>();
  const handwritingImages = options.handwritingImages ?? [];

  // Priority 1: explicit selected-region image.
  let regionImageContext: CanvasRegionImageContext | null = null;
  if (regionImage && regionImage.asset_src) {
    const bounds = regionImage.worldBounds;
    const id = `region:${Math.round(bounds.x * 100) / 100},${Math.round(bounds.y * 100) / 100},${Math.round(bounds.width * 100) / 100},${Math.round(bounds.height * 100) / 100}`;
    const provenance: ExplicitRegionSelectionSource = {
      type: 'explicit_region_selection',
      world_bounds: { ...bounds },
    };
    const attachment: RagContextImageAttachment = {
      element_id: id,
      element_type: 'region',
      asset_src: regionImage.asset_src,
      geometry: { ...bounds },
      sources: [provenance],
      nearest_distance: null,
      selection_reason: 'explicit_region_selection',
      region: {
        included_element_ids: [...regionImage.includedElementIds],
        contains_unstructured_visuals: regionImage.containsUnstructuredVisuals,
      },
    };
    imageCandMap.set(id, {
      element_id: id,
      element_type: 'region',
      geometry: { ...bounds },
      sources: [provenance],
      nearest: null,
      asset_src: regionImage.asset_src,
      selection_reason: 'explicit_region_selection',
      explicitOrder: -1,
      region: attachment.region,
    });
    regionImageContext = {
      worldBounds: { ...bounds },
      imageAttachment: attachment,
      provenance,
      includedElementIds: [...regionImage.includedElementIds],
      containsUnstructuredVisuals: regionImage.containsUnstructuredVisuals,
    };
  }

  explicitSelections.forEach((sel, index) => {
    if (sel.element_type !== 'image') return;
    const existing = byId.get(sel.element_id);
    const src = sel.image_src ?? existing?.image_src;
    if (!src) return;
    imageCandMap.set(sel.element_id, {
      element_id: sel.element_id,
      element_type: 'image',
      geometry: sel.geometry,
      sources: existing?.sources ? [...existing.sources] : [{ type: 'explicit_selection' }],
      nearest: existing?.nearest_distance ?? null,
      asset_src: src,
      selection_reason: 'explicit_selection',
      explicitOrder: index,
    });
  });

  // Priority 3: semantic handwriting region crops (required-ish; drop spatial first).
  for (const hw of handwritingImages) {
    if (!hw.asset_src) continue;
    const existing = imageCandMap.get(hw.region_id);
    if (existing) {
      // Exact same id already attached (e.g. duplicate sources) — merge provenance.
      if (hw.sources) {
        for (const s of hw.sources) {
          if (!existing.sources.some((x) => JSON.stringify(x) === JSON.stringify(s))) {
            existing.sources.push(s);
          }
        }
      }
      if (!existing.ocr_transcription && hw.ocr_transcription) {
        existing.ocr_transcription = hw.ocr_transcription;
      }
      continue;
    }
    const sources = hw.sources?.length
      ? [...hw.sources]
      : hw.reason === 'semantic_handwriting'
        ? [{ type: 'explicit_selection' as const }]
        : [];
    // Prefer semantic provenance marker via selection_reason; keep sources honest.
    const el = byId.get(hw.region_id);
    imageCandMap.set(hw.region_id, {
      element_id: hw.region_id,
      element_type: 'handwriting_region',
      geometry: hw.geometry,
      sources: sources.length
        ? sources
        : el?.sources
          ? [...el.sources]
          : [{ type: 'explicit_selection' }],
      nearest: hw.nearest_distance ?? el?.nearest_distance ?? null,
      asset_src: hw.asset_src,
      selection_reason: hw.reason,
      explicitOrder:
        hw.reason === 'semantic_handwriting' ? 10_000 : Number.POSITIVE_INFINITY,
      region: {
        included_element_ids: [...hw.stroke_ids],
        contains_unstructured_visuals: true,
      },
      ocr_transcription: hw.ocr_transcription ?? null,
    });
  }

  // Spatial image candidates (and merge provenance onto explicit images).
  for (const cand of spatialImageOrdered) {
    const src = cand.image_src;
    if (!src) continue;
    const existing = imageCandMap.get(cand.element_id);
    if (existing) {
      for (const s of cand.spatialSources) {
        if (
          !existing.sources.some(
            (x) =>
              x.type === 'spatial' &&
              x.anchor_element_id === s.anchor_element_id &&
              x.distance === s.distance,
          )
        ) {
          existing.sources.push(s);
        }
      }
      if (existing.nearest === null || cand.nearest < existing.nearest) {
        existing.nearest = cand.nearest;
      }
      continue;
    }
    imageCandMap.set(cand.element_id, {
      element_id: cand.element_id,
      element_type: 'image',
      geometry: cand.geometry,
      sources: [...cand.spatialSources],
      nearest: cand.nearest,
      asset_src: src,
      selection_reason: 'spatial_neighbor',
      explicitOrder: Number.POSITIVE_INFINITY,
    });
  }

  // Also attach images that were only reached via byId merge (e.g. explicit+spatial).
  for (const el of byId.values()) {
    if (!isImageElement(el) || !el.image_src) continue;
    if (imageCandMap.has(el.element_id)) continue;
    const isExplicit = el.sources.some(
      (s) =>
        s.type === 'explicit_selection' || s.type === 'explicit_region_selection',
    );
    imageCandMap.set(el.element_id, {
      element_id: el.element_id,
      element_type: 'image',
      geometry: el.geometry,
      sources: [...el.sources],
      nearest: el.nearest_distance,
      asset_src: el.image_src,
      selection_reason: isExplicit ? 'explicit_selection' : 'spatial_neighbor',
      explicitOrder: isExplicit
        ? explicitSelections.findIndex((s) => s.element_id === el.element_id)
        : Number.POSITIVE_INFINITY,
    });
  }

  const reasonRank = (r: ImageCand['selection_reason']): number => {
    if (r === 'explicit_region_selection') return 0;
    if (r === 'explicit_selection') return 1;
    if (r === 'semantic_handwriting') return 2;
    return 3;
  };

  const imageOrdered = Array.from(imageCandMap.values()).sort((a, b) => {
    const ra = reasonRank(a.selection_reason);
    const rb = reasonRank(b.selection_reason);
    if (ra !== rb) return ra - rb;
    if (a.explicitOrder !== b.explicitOrder) return a.explicitOrder - b.explicitOrder;
    const aDist = a.nearest ?? Number.POSITIVE_INFINITY;
    const bDist = b.nearest ?? Number.POSITIVE_INFINITY;
    if (aDist !== bDist) return aDist - bDist;
    return a.element_id.localeCompare(b.element_id);
  });

  const imageAttachments: RagContextImageAttachment[] = [];
  const imageBudgetExcludedIds: string[] = [];
  let truncatedByImageBudget = false;

  for (const cand of imageOrdered) {
    const isRequired =
      cand.selection_reason === 'explicit_region_selection' ||
      cand.selection_reason === 'explicit_selection' ||
      cand.selection_reason === 'semantic_handwriting';
    if (!isRequired && imageAttachments.length >= maxImages) {
      truncatedByImageBudget = true;
      imageBudgetExcludedIds.push(cand.element_id);
      continue;
    }
    if (isRequired && imageAttachments.length >= maxImages) {
      // Still include required explicit / region / semantic handwriting; flag overrun.
      truncatedByImageBudget = true;
    }
    imageAttachments.push({
      element_id: cand.element_id,
      element_type: cand.element_type,
      asset_src: cand.asset_src,
      geometry: cand.geometry,
      sources: cand.sources,
      nearest_distance: cand.nearest,
      selection_reason: cand.selection_reason,
      region: cand.region,
      ocr_transcription: cand.ocr_transcription ?? null,
    });

    // Ensure spatial image elements appear in spatialElements / byId for UI.
    if (cand.element_type === 'image' && !byId.has(cand.element_id)) {
      const el = makeElement({
        element_id: cand.element_id,
        element_type: 'image',
        text: '',
        geometry: cand.geometry,
        sources: [...cand.sources],
        nearest_distance: cand.nearest,
        image_src: cand.asset_src,
      });
      spatialElements.push(el);
      byId.set(el.element_id, el);
    } else if (cand.element_type === 'image') {
      const existing = byId.get(cand.element_id)!;
      if (!existing.image_src) existing.image_src = cand.asset_src;
    } else if (
      cand.element_type === 'handwriting_region' &&
      !byId.has(cand.element_id)
    ) {
      const el = makeElement({
        element_id: cand.element_id,
        element_type: 'handwriting_region',
        text: cand.ocr_transcription ?? '',
        geometry: cand.geometry,
        sources: [...cand.sources],
        nearest_distance: cand.nearest,
      });
      spatialElements.push(el);
      byId.set(el.element_id, el);
    }
  }

  // Keep regionImageContext.attachment in sync with budgeted list.
  if (regionImageContext) {
    const attached = imageAttachments.find(
      (a) => a.selection_reason === 'explicit_region_selection',
    );
    if (attached) {
      regionImageContext = {
        ...regionImageContext,
        imageAttachment: attached,
      };
    }
  }

  // allElements: explicit first, then anchors, then spatial (incl. images), then neighbors.
  const allElements: RagContextElement[] = [];
  const inAll = new Set<string>();
  for (const el of explicitlySelectedElements) {
    if (inAll.has(el.element_id)) continue;
    allElements.push(el);
    inAll.add(el.element_id);
  }
  for (const el of semanticAnchors) {
    if (inAll.has(el.element_id)) continue;
    allElements.push(el);
    inAll.add(el.element_id);
  }
  for (const el of spatialElements) {
    if (inAll.has(el.element_id)) continue;
    // Skip spatial images that were budget-excluded.
    if (
      isImageElement(el) &&
      imageBudgetExcludedIds.includes(el.element_id) &&
      !imageAttachments.some((a) => a.element_id === el.element_id)
    ) {
      continue;
    }
    allElements.push(el);
    inAll.add(el.element_id);
  }
  for (const el of semanticNeighborElements) {
    if (inAll.has(el.element_id)) continue;
    allElements.push(el);
    inAll.add(el.element_id);
  }

  // Spatial elements list should only include those that made it into context.
  const spatialElementsFinal = spatialElements.filter((el) => inAll.has(el.element_id));

  const totalChars = allElements
    .filter((el) => !isImageElement(el))
    .reduce((n, el) => n + el.text.length, 0);
  const totalWords = allElements
    .filter((el) => !isImageElement(el))
    .reduce((n, el) => n + wordCount(el.text), 0);

  const additionIds = new Set<string>();
  let depth1 = 0;
  let depth2 = 0;
  const explicitIdSet = new Set(
    [...explicitSelections, ...regionStructuredSelections].map((s) => s.element_id),
  );
  const anchorIdSet = new Set(options.semanticAnchors.map((a) => a.element_id));
  for (const el of allElements) {
    if (explicitIdSet.has(el.element_id) || anchorIdSet.has(el.element_id)) {
      continue;
    }
    const neigh = el.sources.filter(
      (s): s is SemanticNeighborSource => s.type === 'semantic_neighbor',
    );
    if (neigh.length === 0) continue;
    additionIds.add(el.element_id);
    const minDepth = Math.min(...neigh.map((s) => s.depth));
    if (minDepth === 1) depth1 += 1;
    else if (minDepth >= 2) depth2 += 1;
  }

  let spatialTextCount = 0;
  let spatialEquationCount = 0;
  let spatialImageCount = 0;
  let spatialGraphCount = 0;
  for (const el of spatialElementsFinal) {
    if (el.element_type === 'image') spatialImageCount += 1;
    else if (el.element_type === 'equation') spatialEquationCount += 1;
    else if (el.element_type === 'graph') spatialGraphCount += 1;
    else spatialTextCount += 1;
  }

  const regionImageCount = imageAttachments.filter(
    (a) => a.selection_reason === 'explicit_region_selection',
  ).length;

  const stats: RagContextStats = {
    explicit_selection_count: explicitlySelectedElements.length,
    semantic_anchor_count: new Set(options.semanticAnchors.map((a) => a.element_id))
      .size,
    spatial_addition_count: spatialElementsFinal.length,
    spatial_text_addition_count: spatialTextCount,
    spatial_equation_addition_count: spatialEquationCount,
    spatial_image_addition_count: spatialImageCount,
    spatial_graph_addition_count: spatialGraphCount,
    semantic_depth1_addition_count: depth1,
    semantic_depth2_addition_count: depth2,
    unique_semantic_addition_count: additionIds.size,
    image_attachment_count: imageAttachments.length,
    image_budget_excluded_count: imageBudgetExcludedIds.length,
    region_image_attachment_count: regionImageCount,
    total_unique_elements: allElements.length,
    character_count: totalChars,
    word_count: totalWords,
    truncated_by_element_budget: truncatedByElements,
    truncated_by_character_budget: truncatedByChars,
    truncated_by_image_budget: truncatedByImageBudget,
    required_context_exceeds_budget: requiredExceedsBudget,
    image_budget_excluded_ids: imageBudgetExcludedIds,
  };

  return {
    query: options.query,
    explicitlySelectedElements,
    semanticAnchors,
    spatialElements: spatialElementsFinal,
    semanticNeighborElements,
    allElements,
    imageAttachments,
    regionImageContext,
    stats,
    serialized: serializeRagContext(
      options.query,
      allElements,
      explicitlySelectedElements,
      imageAttachments,
      regionImageContext,
    ),
  };
}

/** Map retrieve candidates + selection → SemanticAnchorInput using live canvas text. */
export function anchorsFromCandidates(
  candidates: readonly RetrievedCandidate[],
  selectedIds: ReadonlySet<string>,
  resolveText: (
    elementId: string,
  ) => { text: string; type: string; geometry: WorldRect } | null,
): SemanticAnchorInput[] {
  const out: SemanticAnchorInput[] = [];
  for (const c of candidates) {
    if (!selectedIds.has(c.element_id)) continue;
    const live = resolveText(c.element_id);
    out.push({
      element_id: c.element_id,
      element_type: live?.type ?? c.element_type,
      similarity: c.score,
      matched_chunks: c.matched_chunks,
      geometry: live?.geometry ?? c.geometry,
      text: live?.text ?? c.matched_chunks[0]?.text ?? '',
    });
  }
  return out;
}

export const DEFAULT_RAG_SYSTEM_INSTRUCTION = [
  'You are an AI assistant inside a study canvas application.',
  'Use the supplied canvas context when it is relevant.',
  'Do not assume the context is exhaustive.',
].join('\n');
