/**
 * RagContextBuilder — assembles LLM-ready canvas context from semantic anchors
 * + spatial expansion. Pure functions; no UI / no canvas renderer coupling.
 */

import type { MatchedChunk, RetrievedCandidate } from './ragRetrieval';
import type { SpatialHit } from './spatialContext';
import type { WorldRect } from './geometry';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
} from './config';

export type RetrievalSourceType = 'semantic' | 'spatial';

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

export type ElementProvenance = SemanticSource | SpatialSource;

export interface RagContextElement {
  element_id: string;
  element_type: string;
  text: string;
  geometry: WorldRect;
  sources: ElementProvenance[];
  /** Convenience: 'semantic' | 'spatial' | 'both' */
  inclusion: 'semantic' | 'spatial' | 'both';
  /** Best semantic similarity if any */
  similarity: number | null;
  /** Nearest distance to any selected anchor (spatial); null if semantic-only */
  nearest_distance: number | null;
}

export interface RagContextStats {
  semantic_anchor_count: number;
  spatial_addition_count: number;
  total_unique_elements: number;
  character_count: number;
  word_count: number;
  truncated_by_element_budget: boolean;
  truncated_by_character_budget: boolean;
}

export interface RagContext {
  query: string;
  semanticAnchors: RagContextElement[];
  spatialElements: RagContextElement[];
  allElements: RagContextElement[];
  stats: RagContextStats;
  /** Deterministic serialized payload for the LLM */
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

export interface BuildRagContextOptions {
  query: string;
  semanticAnchors: SemanticAnchorInput[];
  /** Raw spatial hits (may include duplicates across anchors / overlap with anchors) */
  spatialHits: SpatialHit[];
  maxElements?: number;
  maxCharacters?: number;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function inclusionOf(sources: ElementProvenance[]): 'semantic' | 'spatial' | 'both' {
  const hasSem = sources.some((s) => s.type === 'semantic');
  const hasSpat = sources.some((s) => s.type === 'spatial');
  if (hasSem && hasSpat) return 'both';
  if (hasSem) return 'semantic';
  return 'spatial';
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

function formatElementBlock(el: RagContextElement): string {
  const lines: string[] = [];
  lines.push('ELEMENT');
  lines.push(`ID: ${el.element_id}`);
  lines.push(`TYPE: ${el.element_type}`);
  lines.push(`SOURCE: ${el.inclusion}`);
  if (el.similarity !== null) {
    lines.push(`SIMILARITY: ${el.similarity.toFixed(4)}`);
  }
  const spatialSources = el.sources.filter((s): s is SpatialSource => s.type === 'spatial');
  for (const s of spatialSources) {
    lines.push(`NEAR: ${s.anchor_element_id}`);
    lines.push(`DISTANCE: ${s.distance.toFixed(2)}`);
  }
  lines.push(
    `POSITION: x=${el.geometry.x}, y=${el.geometry.y}, width=${el.geometry.width}, height=${el.geometry.height}`,
  );
  lines.push('TEXT:');
  lines.push(el.text || '(empty)');
  return lines.join('\n');
}

/** Deterministic serialization for LLM consumption. */
export function serializeRagContext(
  query: string,
  elements: readonly RagContextElement[],
): string {
  if (elements.length === 0) {
    return 'CANVAS CONTEXT\n\n(none selected)';
  }
  const blocks = elements.map(formatElementBlock);
  return [
    'CANVAS CONTEXT',
    `QUERY: ${query}`,
    `ELEMENTS: ${elements.length}`,
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

/**
 * Merge anchors + spatial hits, dedupe by element_id, enforce budgets.
 *
 * Budget rules:
 * 1. All semantic anchors are always retained (even if over character budget,
 *    anchors still win — we stop adding spatial first).
 * 2. Spatial additions are nearest-first until MAX_CONTEXT_ELEMENTS /
 *    MAX_CONTEXT_CHARACTERS.
 * 3. Radius 0 / no spatial hits → anchors only.
 */
export function buildRagContext(options: BuildRagContextOptions): RagContext {
  const maxElements = options.maxElements ?? RAG_MAX_CONTEXT_ELEMENTS;
  const maxCharacters = options.maxCharacters ?? RAG_MAX_CONTEXT_CHARACTERS;

  const byId = new Map<string, RagContextElement>();

  // 1. Semantic anchors first (stable order as provided).
  for (const anchor of options.semanticAnchors) {
    const sources: ElementProvenance[] = [
      {
        type: 'semantic',
        similarity: anchor.similarity,
        matched_chunks: anchor.matched_chunks,
      },
    ];
    byId.set(anchor.element_id, {
      element_id: anchor.element_id,
      element_type: anchor.element_type,
      text: anchor.text,
      geometry: anchor.geometry,
      sources,
      inclusion: 'semantic',
      similarity: anchor.similarity,
      nearest_distance: null,
    });
  }

  // 2. Collect spatial candidates (exclude pure duplicates of anchors until merge).
  type SpatialCandidate = {
    element_id: string;
    element_type: string;
    text: string;
    geometry: WorldRect;
    spatialSources: SpatialSource[];
    nearest: number;
  };
  const spatialMap = new Map<string, SpatialCandidate>();

  for (const hit of options.spatialHits) {
    if (byId.has(hit.element_id)) {
      // Already an anchor — attach spatial provenance, do not treat as "addition".
      const existing = byId.get(hit.element_id)!;
      existing.sources.push({
        type: 'spatial',
        anchor_element_id: hit.anchor_element_id,
        distance: hit.distance,
      });
      existing.inclusion = inclusionOf(existing.sources);
      existing.nearest_distance = nearestDistance(existing.sources);
      continue;
    }

    const prev = spatialMap.get(hit.element_id);
    const source: SpatialSource = {
      type: 'spatial',
      anchor_element_id: hit.anchor_element_id,
      distance: hit.distance,
    };
    if (!prev) {
      spatialMap.set(hit.element_id, {
        element_id: hit.element_id,
        element_type: hit.element_type,
        text: hit.text,
        geometry: hit.geometry,
        spatialSources: [source],
        nearest: hit.distance,
      });
    } else {
      prev.spatialSources.push(source);
      if (hit.distance < prev.nearest) prev.nearest = hit.distance;
      // Prefer longer text if one hit had empty (shouldn't happen).
      if (hit.text.length > prev.text.length) prev.text = hit.text;
    }
  }

  const spatialOrdered = Array.from(spatialMap.values()).sort(
    (a, b) => a.nearest - b.nearest || a.element_id.localeCompare(b.element_id),
  );

  // 3. Always keep anchors.
  const semanticAnchors: RagContextElement[] = options.semanticAnchors.map(
    (a) => byId.get(a.element_id)!,
  );

  let charUsed = semanticAnchors.reduce((n, el) => n + el.text.length, 0);
  let truncatedByElements = false;
  let truncatedByChars = false;
  const spatialElements: RagContextElement[] = [];

  for (const cand of spatialOrdered) {
    if (semanticAnchors.length + spatialElements.length >= maxElements) {
      truncatedByElements = true;
      break;
    }
    const nextChars = charUsed + cand.text.length;
    if (nextChars > maxCharacters && spatialElements.length + semanticAnchors.length > 0) {
      // Allow if we have zero total so far? Anchors already counted. Skip this spatial.
      truncatedByChars = true;
      // Keep scanning in case a smaller later item fits? Spec says nearest-first until
      // budget reached — stop rather than skip-over (greedy by distance).
      break;
    }

    const el: RagContextElement = {
      element_id: cand.element_id,
      element_type: cand.element_type,
      text: cand.text,
      geometry: cand.geometry,
      sources: cand.spatialSources,
      inclusion: 'spatial',
      similarity: null,
      nearest_distance: cand.nearest,
    };
    spatialElements.push(el);
    byId.set(el.element_id, el);
    charUsed = nextChars;
  }

  // If anchors alone already exceed character budget, flag it but keep them.
  const anchorChars = semanticAnchors.reduce((n, el) => n + el.text.length, 0);
  if (anchorChars > maxCharacters) {
    truncatedByChars = true;
  }
  if (semanticAnchors.length > maxElements) {
    // Anchors always retained — flag if somehow over (shouldn't with normal UI).
    truncatedByElements = true;
  }

  const allElements = [...semanticAnchors, ...spatialElements];
  const totalChars = allElements.reduce((n, el) => n + el.text.length, 0);
  const totalWords = allElements.reduce((n, el) => n + wordCount(el.text), 0);

  const stats: RagContextStats = {
    semantic_anchor_count: semanticAnchors.length,
    spatial_addition_count: spatialElements.length,
    total_unique_elements: allElements.length,
    character_count: totalChars,
    word_count: totalWords,
    truncated_by_element_budget: truncatedByElements,
    truncated_by_character_budget: truncatedByChars,
  };

  return {
    query: options.query,
    semanticAnchors,
    spatialElements,
    allElements,
    stats,
    serialized: serializeRagContext(options.query, allElements),
  };
}

/** Map retrieve candidates + selection → SemanticAnchorInput using live canvas text. */
export function anchorsFromCandidates(
  candidates: readonly RetrievedCandidate[],
  selectedIds: ReadonlySet<string>,
  resolveText: (elementId: string) => { text: string; type: string; geometry: WorldRect } | null,
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
