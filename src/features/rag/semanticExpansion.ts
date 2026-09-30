/**
 * Semantic knowledge expansion client + tree helpers.
 * Anchor element → related canvas elements (backend). Distinct from prompt retrieve.
 */

import { RAG_API_BASE_URL } from './config';

export interface SemanticExpandRequest {
  board_id: string;
  root_anchor_ids: string[];
  depth: number;
  max_neighbours: number;
}

export interface SemanticExpansionEdge {
  parent_element_id: string;
  child_element_id: string;
  root_anchor_element_id: string;
  depth: number;
  similarity: number;
}

export interface SemanticExpansionElement {
  element_id: string;
  element_type: string;
  preview: string;
  geometry: { x: number; y: number; width: number; height: number };
}

export interface SemanticExpandResponse {
  board_id: string;
  root_anchor_ids: string[];
  depth: number;
  max_neighbours: number;
  embedding_model: string;
  supported_element_types: string[];
  edges: SemanticExpansionEdge[];
  elements: SemanticExpansionElement[];
  unique_element_ids: string[];
}

/** Flattened hit used by context builder (one per unique child, with all paths). */
export interface SemanticNeighborHit {
  element_id: string;
  element_type: string;
  text: string;
  geometry: { x: number; y: number; width: number; height: number };
  parent_element_id: string;
  root_anchor_element_id: string;
  depth: number;
  similarity: number;
}

export interface SemanticTreeNode {
  element_id: string;
  parent_element_id: string | null;
  root_anchor_element_id: string;
  depth: number;
  similarity: number | null;
  preview: string;
  element_type: string;
  children: SemanticTreeNode[];
  /** Adjacent score drop vs previous sibling (debug). */
  gap_from_previous: number | null;
}

export interface SemanticExpansionService {
  expand(request: SemanticExpandRequest): Promise<SemanticExpandResponse>;
}

export function createSemanticExpansionService(
  baseUrl: string = RAG_API_BASE_URL,
): SemanticExpansionService {
  return {
    async expand(request) {
      const res = await fetch(`${baseUrl}/api/rag/expand/semantic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board_id: request.board_id,
          root_anchor_ids: request.root_anchor_ids,
          depth: request.depth,
          max_neighbours: request.max_neighbours,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Semantic expand failed (${res.status}): ${body}`);
      }
      return (await res.json()) as SemanticExpandResponse;
    },
  };
}

export const semanticExpansionService: SemanticExpansionService =
  createSemanticExpansionService();

/**
 * Build per-root trees from expansion edges. Same child may appear under
 * multiple roots (display); final context dedupes separately.
 */
export function buildSemanticTrees(
  response: SemanticExpandResponse,
): SemanticTreeNode[] {
  const byId = new Map(response.elements.map((e) => [e.element_id, e]));
  const childrenOf = new Map<string, SemanticExpansionEdge[]>();
  for (const edge of response.edges) {
    const key = `${edge.root_anchor_element_id}:${edge.parent_element_id}`;
    const list = childrenOf.get(key) ?? [];
    list.push(edge);
    childrenOf.set(key, list);
  }

  function buildNode(
    elementId: string,
    parentId: string | null,
    rootId: string,
    depth: number,
    similarity: number | null,
  ): SemanticTreeNode {
    const meta = byId.get(elementId);
    const childEdges = (childrenOf.get(`${rootId}:${elementId}`) ?? [])
      .slice()
      .sort(
        (a, b) =>
          b.similarity - a.similarity ||
          a.child_element_id.localeCompare(b.child_element_id),
      );

    const children: SemanticTreeNode[] = [];
    let prevSim: number | null = null;
    for (const edge of childEdges) {
      const gap =
        prevSim === null ? null : Number((prevSim - edge.similarity).toFixed(4));
      prevSim = edge.similarity;
      const child = buildNode(
        edge.child_element_id,
        elementId,
        rootId,
        edge.depth,
        edge.similarity,
      );
      child.gap_from_previous = gap;
      children.push(child);
    }

    return {
      element_id: elementId,
      parent_element_id: parentId,
      root_anchor_element_id: rootId,
      depth,
      similarity,
      preview: meta?.preview ?? elementId,
      element_type: meta?.element_type ?? 'text',
      children,
      gap_from_previous: null,
    };
  }

  return response.root_anchor_ids
    .filter((id) => byId.has(id) || response.edges.some((e) => e.root_anchor_element_id === id))
    .map((rootId) => buildNode(rootId, null, rootId, 0, null));
}

/**
 * Convert expansion response → neighbor hits for context merge.
 * Only includes edges whose parent is a root OR parent is in `includedIds`
 * (depth-2 only expands through selected depth-1 nodes). Child must also
 * be in `includedIds` to enter the hit list for final context.
 */
export function semanticHitsForContext(
  response: SemanticExpandResponse,
  includedIds: ReadonlySet<string>,
  resolveLiveText: (
    elementId: string,
  ) => { text: string; type: string; geometry: SemanticExpansionElement['geometry'] } | null,
): SemanticNeighborHit[] {
  const byId = new Map(response.elements.map((e) => [e.element_id, e]));
  const rootSet = new Set(response.root_anchor_ids);
  const hits: SemanticNeighborHit[] = [];

  for (const edge of response.edges) {
    const parentOk =
      rootSet.has(edge.parent_element_id) || includedIds.has(edge.parent_element_id);
    if (!parentOk) continue;
    if (!includedIds.has(edge.child_element_id)) continue;

    const meta = byId.get(edge.child_element_id);
    const live = resolveLiveText(edge.child_element_id);
    hits.push({
      element_id: edge.child_element_id,
      element_type: live?.type ?? meta?.element_type ?? 'text',
      text: live?.text ?? meta?.preview ?? '',
      geometry: live?.geometry ?? meta?.geometry ?? { x: 0, y: 0, width: 0, height: 0 },
      parent_element_id: edge.parent_element_id,
      root_anchor_element_id: edge.root_anchor_element_id,
      depth: edge.depth,
      similarity: edge.similarity,
    });
  }
  return hits;
}

/** All expandable child ids from the graph (for default select-all). */
export function allExpansionChildIds(response: SemanticExpandResponse): string[] {
  return Array.from(new Set(response.edges.map((e) => e.child_element_id)));
}

/** Top-N child ids by best similarity across any parent (global convenience). */
export function topExpansionChildIds(
  response: SemanticExpandResponse,
  n: number,
): string[] {
  const best = new Map<string, number>();
  for (const edge of response.edges) {
    const prev = best.get(edge.child_element_id);
    if (prev === undefined || edge.similarity > prev) {
      best.set(edge.child_element_id, edge.similarity);
    }
  }
  return Array.from(best.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, n))
    .map(([id]) => id);
}
