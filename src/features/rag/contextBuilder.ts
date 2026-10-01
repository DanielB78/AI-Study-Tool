/**
 * RagContextBuilder — assembles LLM-ready canvas context from:
 * explicit editor selection + semantic anchors + spatial + semantic expansion.
 * Pure functions; no UI / no canvas renderer coupling.
 */

import type { MatchedChunk, RetrievedCandidate } from './ragRetrieval';
import type { SpatialHit } from './spatialContext';
import type { SemanticNeighborHit } from './semanticExpansion';
import type { ExplicitSelectionInput } from './explicitSelection';
import type { WorldRect } from './geometry';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
} from './config';

export type RetrievalSourceType =
  | 'explicit_selection'
  | 'semantic'
  | 'spatial'
  | 'semantic_neighbor';

export interface ExplicitSelectionSource {
  type: 'explicit_selection';
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
  | SemanticSource
  | SpatialSource
  | SemanticNeighborSource;

export type ElementInclusion =
  | 'explicit_selection'
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
}

export interface RagContextStats {
  explicit_selection_count: number;
  semantic_anchor_count: number;
  spatial_addition_count: number;
  semantic_depth1_addition_count: number;
  semantic_depth2_addition_count: number;
  unique_semantic_addition_count: number;
  total_unique_elements: number;
  character_count: number;
  word_count: number;
  truncated_by_element_budget: boolean;
  truncated_by_character_budget: boolean;
  /** True when required (explicit) context alone exceeds configured budgets. */
  required_context_exceeds_budget: boolean;
}

export interface RagContext {
  query: string;
  explicitlySelectedElements: RagContextElement[];
  semanticAnchors: RagContextElement[];
  spatialElements: RagContextElement[];
  semanticNeighborElements: RagContextElement[];
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
  /** Editor selection snapshot — highest priority, always retained. */
  explicitSelections?: ExplicitSelectionInput[];
  semanticAnchors: SemanticAnchorInput[];
  /** Raw spatial hits (may include duplicates across anchors / overlap with anchors) */
  spatialHits: SpatialHit[];
  /** Semantic knowledge expansion hits (debug-selected) */
  semanticNeighborHits?: SemanticNeighborHit[];
  maxElements?: number;
  maxCharacters?: number;
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

function formatElementBlock(el: RagContextElement): string {
  const lines: string[] = [];
  lines.push('ELEMENT');
  lines.push(`ID: ${el.element_id}`);
  lines.push(`TYPE: ${el.element_type}`);
  lines.push(`SOURCE: ${el.inclusion}`);
  if (el.sources.some((s) => s.type === 'explicit_selection')) {
    lines.push('EXPLICIT_SELECTION: yes');
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
  lines.push('TEXT:');
  lines.push(el.text || '(empty)');
  return lines.join('\n');
}

/** Deterministic serialization for LLM consumption. */
export function serializeRagContext(
  query: string,
  elements: readonly RagContextElement[],
  explicitlySelected: readonly RagContextElement[] = [],
): string {
  if (elements.length === 0) {
    return 'CANVAS CONTEXT\n\n(none selected)';
  }

  const sections: string[] = [
    'CANVAS CONTEXT',
    `QUERY: ${query}`,
    `ELEMENTS: ${elements.length}`,
  ];

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
    (el) => !el.sources.some((s) => s.type === 'explicit_selection'),
  );
  if (supporting.length > 0) {
    sections.push('');
    sections.push('RETRIEVED SUPPORTING CONTEXT');
    sections.push('');
    sections.push(supporting.map(formatElementBlock).join('\n\n'));
  } else if (explicitlySelected.length === 0) {
    sections.push('');
    sections.push(elements.map(formatElementBlock).join('\n\n'));
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

/**
 * Merge explicit selection + anchors + spatial + semantic-neighbor hits.
 * Dedupes by element_id. Explicit selections always survive budgeting.
 *
 * Budget priority (trim first → last):
 * 1. semantic-neighbor additions
 * 2. spatial additions
 * Required (never trimmed for budget):
 * - explicitly selected elements
 * - semantic anchors
 */
export function buildRagContext(options: BuildRagContextOptions): RagContext {
  const maxElements = options.maxElements ?? RAG_MAX_CONTEXT_ELEMENTS;
  const maxCharacters = options.maxCharacters ?? RAG_MAX_CONTEXT_CHARACTERS;
  const explicitSelections = options.explicitSelections ?? [];
  const semanticNeighborHits = options.semanticNeighborHits ?? [];

  const byId = new Map<string, RagContextElement>();

  // 1. Explicit editor selection — highest priority, always retained.
  for (const sel of explicitSelections) {
    byId.set(sel.element_id, {
      element_id: sel.element_id,
      element_type: sel.element_type,
      text: sel.text,
      geometry: sel.geometry,
      sources: [{ type: 'explicit_selection' }],
      inclusion: 'explicit_selection',
      similarity: null,
      nearest_distance: null,
      semantic_neighbor_similarity: null,
    });
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
      // Prefer live canvas text already on explicit selection; keep longer if needed.
      if (anchor.text.length > existing.text.length) existing.text = anchor.text;
      refreshDerived(existing);
      continue;
    }
    byId.set(anchor.element_id, {
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
      inclusion: 'semantic',
      similarity: anchor.similarity,
      nearest_distance: null,
      semantic_neighbor_similarity: null,
    });
  }

  // 3. Collect spatial candidates.
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
      const existing = byId.get(hit.element_id)!;
      existing.sources.push({
        type: 'spatial',
        anchor_element_id: hit.anchor_element_id,
        distance: hit.distance,
      });
      refreshDerived(existing);
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
      if (hit.text.length > prev.text.length) prev.text = hit.text;
    }
  }

  const spatialOrdered = Array.from(spatialMap.values()).sort(
    (a, b) => a.nearest - b.nearest || a.element_id.localeCompare(b.element_id),
  );

  const explicitlySelectedElements: RagContextElement[] = explicitSelections.map(
    (s) => byId.get(s.element_id)!,
  );
  const semanticAnchors: RagContextElement[] = options.semanticAnchors.map(
    (a) => byId.get(a.element_id)!,
  );

  // Required elements for budget baseline (unique).
  const requiredElements: RagContextElement[] = [];
  const seenRequired = new Set<string>();
  for (const el of [...explicitlySelectedElements, ...semanticAnchors]) {
    if (seenRequired.has(el.element_id)) continue;
    seenRequired.add(el.element_id);
    requiredElements.push(el);
  }

  let charUsed = requiredElements.reduce((n, el) => n + el.text.length, 0);
  let truncatedByElements = false;
  let truncatedByChars = false;
  const requiredExceedsBudget =
    requiredElements.length > maxElements || charUsed > maxCharacters;

  if (requiredExceedsBudget) {
    truncatedByElements = requiredElements.length > maxElements;
    truncatedByChars = charUsed > maxCharacters;
  }

  const spatialElements: RagContextElement[] = [];
  for (const cand of spatialOrdered) {
    const acceptedCount = requiredElements.length + spatialElements.length;
    if (acceptedCount >= maxElements) {
      truncatedByElements = true;
      break;
    }
    const nextChars = charUsed + cand.text.length;
    if (nextChars > maxCharacters && acceptedCount > 0) {
      truncatedByChars = true;
      break;
    }

    const el: RagContextElement = {
      element_id: cand.element_id,
      element_type: cand.element_type,
      text: cand.text,
      geometry: cand.geometry,
      sources: [...cand.spatialSources],
      inclusion: 'spatial',
      similarity: null,
      nearest_distance: cand.nearest,
      semantic_neighbor_similarity: null,
    };
    spatialElements.push(el);
    byId.set(el.element_id, el);
    charUsed = nextChars;
  }

  // 4. Semantic neighbor hits.
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
  charUsed = [...requiredElements, ...spatialElements].reduce(
    (n, el) => n + el.text.length,
    0,
  );

  for (const cand of semOrdered) {
    const acceptedCount =
      requiredElements.length +
      spatialElements.length +
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
    const el: RagContextElement = {
      element_id: cand.element_id,
      element_type: cand.element_type,
      text: cand.text,
      geometry: cand.geometry,
      sources,
      inclusion: 'semantic_neighbor',
      similarity: null,
      nearest_distance: null,
      semantic_neighbor_similarity: cand.bestSim,
    };
    semanticNeighborElements.push(el);
    byId.set(el.element_id, el);
    charUsed = nextChars;
  }

  // allElements: explicit first, then anchors not already listed, then additions.
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
    allElements.push(el);
    inAll.add(el.element_id);
  }
  for (const el of semanticNeighborElements) {
    if (inAll.has(el.element_id)) continue;
    allElements.push(el);
    inAll.add(el.element_id);
  }

  const totalChars = allElements.reduce((n, el) => n + el.text.length, 0);
  const totalWords = allElements.reduce((n, el) => n + wordCount(el.text), 0);

  const additionIds = new Set<string>();
  let depth1 = 0;
  let depth2 = 0;
  const explicitIdSet = new Set(explicitSelections.map((s) => s.element_id));
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

  // Spatial additions = elements in spatialElements array (not required-only merges).
  const spatialAdditionCount = spatialElements.length;

  const stats: RagContextStats = {
    explicit_selection_count: explicitlySelectedElements.length,
    semantic_anchor_count: new Set(options.semanticAnchors.map((a) => a.element_id))
      .size,
    spatial_addition_count: spatialAdditionCount,
    semantic_depth1_addition_count: depth1,
    semantic_depth2_addition_count: depth2,
    unique_semantic_addition_count: additionIds.size,
    total_unique_elements: allElements.length,
    character_count: totalChars,
    word_count: totalWords,
    truncated_by_element_budget: truncatedByElements,
    truncated_by_character_budget: truncatedByChars,
    required_context_exceeds_budget: requiredExceedsBudget,
  };

  return {
    query: options.query,
    explicitlySelectedElements,
    semanticAnchors,
    spatialElements,
    semanticNeighborElements,
    allElements,
    stats,
    serialized: serializeRagContext(
      options.query,
      allElements,
      explicitlySelectedElements,
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
