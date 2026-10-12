/**
 * Relationship-aware grid optimiser for High-mode relationship_grid layouts.
 * Works on grid cells only; geometry/measurement stays in GridLayoutEngine.
 */

import type {
  GridLayoutItemSpec,
  GridLayoutSpec,
  RelationshipGridItemSpec,
  RelationshipGridLayoutSpec,
  TopicSectionSpec,
} from '../operations';
import { maxColumnsForObjectCount } from './gridReflow';

export const RELATIONSHIP_OPTIMISER_CONFIG = {
  /** Weight for semantic distance cost. */
  alpha: 1.0,
  /** Weight for preferred-order deviation. */
  beta: 0.35,
  /** Weight for compactness (spread) cost. */
  gamma: 0.15,
  maxIterations: 80,
  maxCandidatesPerIter: 48,
} as const;

export type RelationshipOptimiserConfig = typeof RELATIONSHIP_OPTIMISER_CONFIG;

export type UndirectedEdge = {
  a: string;
  b: string;
  strength: number;
};

export type RelationshipOptimiserResult = {
  /** Explicit grid ready for measure → place. */
  grid: GridLayoutSpec;
  undirectedEdges: UndirectedEdge[];
  sectionOrder: TopicSectionSpec[];
  initialCost: number;
  finalCost: number;
  semanticCostInitial: number;
  semanticCostFinal: number;
  orderingCostInitial: number;
  orderingCostFinal: number;
  compactnessCostInitial: number;
  compactnessCostFinal: number;
  iterations: number;
  acceptedMoves: number;
  diagnostics: string[];
};

type Placed = {
  ref: string;
  section: string;
  preferredOrder: number;
  requires: string[];
  span: number;
  row: number;
  column: number;
};

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Merge directed relations into undirected edges (max strength). */
export function normalizeUndirectedRelations(
  items: readonly RelationshipGridItemSpec[],
): UndirectedEdge[] {
  const map = new Map<string, UndirectedEdge>();
  const refs = new Set(items.map((i) => i.ref));
  for (const item of items) {
    for (const rel of item.relations ?? []) {
      if (!refs.has(rel.ref) || rel.ref === item.ref) continue;
      const key = edgeKey(item.ref, rel.ref);
      const prev = map.get(key);
      const strength = Math.max(prev?.strength ?? 0, rel.strength);
      map.set(key, {
        a: item.ref < rel.ref ? item.ref : rel.ref,
        b: item.ref < rel.ref ? rel.ref : item.ref,
        strength,
      });
    }
  }
  return [...map.values()].sort((e1, e2) => e1.a.localeCompare(e2.a) || e1.b.localeCompare(e2.b));
}

/** Kahn topological sort; throws on cycles. */
export function topologicalOrder(
  refs: readonly string[],
  requires: ReadonlyMap<string, readonly string[]>,
): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const r of refs) {
    indeg.set(r, 0);
    adj.set(r, []);
  }
  for (const r of refs) {
    for (const pre of requires.get(r) ?? []) {
      if (!indeg.has(pre)) continue;
      adj.get(pre)!.push(r);
      indeg.set(r, (indeg.get(r) ?? 0) + 1);
    }
  }
  const queue = refs
    .filter((r) => (indeg.get(r) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const m of adj.get(n) ?? []) {
      const next = (indeg.get(m) ?? 1) - 1;
      indeg.set(m, next);
      if (next === 0) {
        queue.push(m);
        queue.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  if (out.length !== refs.length) {
    const leftover = refs.filter((r) => !out.includes(r));
    throw new Error(
      `Prerequisite cycle involving: ${leftover.join(', ')}.`,
    );
  }
  return out;
}

function readingIndex(row: number, column: number, columns: number): number {
  return row * columns + column;
}

/** Representative column for spanning cells (cell-range centre). */
function centreColumn(column: number, span: number): number {
  return column + (span - 1) / 2;
}

function gridDistance(
  a: Placed,
  b: Placed,
): number {
  return (
    Math.abs(a.row - b.row) +
    Math.abs(centreColumn(a.column, a.span) - centreColumn(b.column, b.span))
  );
}

function occupiedCells(items: readonly Placed[]): Set<string> {
  const set = new Set<string>();
  for (const it of items) {
    for (let c = it.column; c < it.column + it.span; c++) {
      set.add(`${it.row}:${c}`);
    }
  }
  return set;
}

function prerequisitesSatisfied(
  items: readonly Placed[],
  columns: number,
): boolean {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  for (const it of items) {
    const idx = readingIndex(it.row, it.column, columns);
    for (const pre of it.requires) {
      const p = byRef.get(pre);
      if (!p) continue;
      if (readingIndex(p.row, p.column, columns) >= idx) return false;
    }
  }
  return true;
}

function computeCosts(
  items: readonly Placed[],
  edges: readonly UndirectedEdge[],
  columns: number,
  config: RelationshipOptimiserConfig,
): {
  total: number;
  semantic: number;
  ordering: number;
  compactness: number;
} {
  const byRef = new Map(items.map((i) => [i.ref, i]));
  let semantic = 0;
  let weightSum = 0;
  for (const e of edges) {
    const a = byRef.get(e.a);
    const b = byRef.get(e.b);
    if (!a || !b) continue;
    // Same-section edges only in primary semantic term (cross-section soft).
    const sameSection = a.section === b.section;
    const dist = gridDistance(a, b);
    const w = e.strength * (sameSection ? 1 : 0.25);
    semantic += w * dist;
    weightSum += w;
  }
  if (weightSum > 0) semantic /= weightSum;

  // Ordering: pairwise inversions of preferred_order in reading order (same section).
  let ordering = 0;
  let pairs = 0;
  const sorted = [...items].sort(
    (a, b) =>
      readingIndex(a.row, a.column, columns) -
      readingIndex(b.row, b.column, columns),
  );
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.section !== b.section) continue;
      pairs += 1;
      if (a.preferredOrder > b.preferredOrder) ordering += 1;
    }
  }
  if (pairs > 0) ordering /= pairs;

  const maxRow = Math.max(0, ...items.map((i) => i.row));
  const usedCells = occupiedCells(items).size;
  const capacity = (maxRow + 1) * columns;
  const compactness = capacity > 0 ? 1 - usedCells / capacity : 0;

  const total =
    config.alpha * semantic + config.beta * ordering + config.gamma * compactness;
  return { total, semantic, ordering, compactness };
}

function packSection(
  sectionItems: RelationshipGridItemSpec[],
  columns: number,
  startRow: number,
  topo: string[],
): Placed[] {
  const byRef = new Map(sectionItems.map((i) => [i.ref, i]));
  const ordered = topo.filter((r) => byRef.has(r));
  // Stable secondary sort by preferred_order then ref.
  ordered.sort((a, b) => {
    const ia = byRef.get(a)!;
    const ib = byRef.get(b)!;
    const pa = ia.preferred_order ?? 0;
    const pb = ib.preferred_order ?? 0;
    if (pa !== pb) return pa - pb;
    // Preserve topo relative order when preferred_order ties.
    return topo.indexOf(a) - topo.indexOf(b);
  });

  const placed: Placed[] = [];
  let row = startRow;
  let col = 0;
  for (const ref of ordered) {
    const item = byRef.get(ref)!;
    const span = Math.min(item.column_span ?? 1, columns);
    if (col + span > columns) {
      row += 1;
      col = 0;
    }
    if (span === columns && col !== 0) {
      row += 1;
      col = 0;
    }
    placed.push({
      ref,
      section: item.section,
      preferredOrder: item.preferred_order ?? 0,
      requires: [...(item.requires ?? [])],
      span,
      row,
      column: col,
    });
    col += span;
    if (col >= columns) {
      row += 1;
      col = 0;
    }
  }
  return placed;
}

function trySwap(items: Placed[], i: number, j: number, columns: number): Placed[] | null {
  if (i === j) return null;
  const next = items.map((p) => ({ ...p }));
  const a = next[i]!;
  const b = next[j]!;
  if (a.section !== b.section) return null;
  if (a.span !== b.span) return null; // keep occupancy simple
  const tmpRow = a.row;
  const tmpCol = a.column;
  a.row = b.row;
  a.column = b.column;
  b.row = tmpRow;
  b.column = tmpCol;
  // Re-check occupancy
  const cells = new Set<string>();
  for (const it of next) {
    for (let c = it.column; c < it.column + it.span; c++) {
      const key = `${it.row}:${c}`;
      if (cells.has(key)) return null;
      cells.add(key);
    }
  }
  if (!prerequisitesSatisfied(next, columns)) return null;
  return next;
}

/**
 * Build an initial valid grid from relationship metadata, then locally optimise
 * within topic sections under hard prerequisite / section-order constraints.
 */
export function optimiseRelationshipGrid(
  layout: RelationshipGridLayoutSpec,
  config: RelationshipOptimiserConfig = RELATIONSHIP_OPTIMISER_CONFIG,
): RelationshipOptimiserResult {
  const diagnostics: string[] = [];
  const n = layout.items.length;
  const maxColumns = maxColumnsForObjectCount(n);
  const columns = Math.min(
    Math.max(1, layout.columns ?? maxColumns),
    maxColumns,
  );
  diagnostics.push(
    `Relationship grid: N=${n}, maxColumns=${maxColumns}, using columns=${columns}.`,
  );

  const sectionOrder = [...layout.sections].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  const sectionIds = new Set(sectionOrder.map((s) => s.id));
  for (const item of layout.items) {
    if (!sectionIds.has(item.section)) {
      throw new Error(
        `Item "${item.ref}" references unknown section "${item.section}".`,
      );
    }
  }

  const requires = new Map<string, string[]>();
  for (const item of layout.items) {
    requires.set(item.ref, [...(item.requires ?? [])]);
  }
  const allRefs = layout.items.map((i) => i.ref);
  const topo = topologicalOrder(allRefs, requires);
  diagnostics.push(`Topological order: ${topo.join(' → ')}`);

  const edges = normalizeUndirectedRelations(layout.items);

  // Pack sections into contiguous row bands.
  let nextRow = 0;
  let placed: Placed[] = [];
  for (const section of sectionOrder) {
    const sectionItems = layout.items.filter((i) => i.section === section.id);
    if (sectionItems.length === 0) continue;
    const band = packSection(sectionItems, columns, nextRow, topo);
    placed = placed.concat(band);
    const maxR = Math.max(...band.map((p) => p.row));
    nextRow = maxR + 1;
  }

  if (!prerequisitesSatisfied(placed, columns)) {
    // Fallback: global topo pack ignoring preferred_order within sections.
    diagnostics.push('Initial pack violated prerequisites — rebuilding from topology.');
    placed = [];
    nextRow = 0;
    for (const section of sectionOrder) {
      const sectionItems = layout.items.filter((i) => i.section === section.id);
      const band = packSection(
        sectionItems.map((i) => ({ ...i, preferred_order: topo.indexOf(i.ref) })),
        columns,
        nextRow,
        topo,
      );
      placed = placed.concat(band);
      nextRow = Math.max(...band.map((p) => p.row)) + 1;
    }
  }

  const initialCosts = computeCosts(placed, edges, columns, config);
  let best = placed;
  let bestCost = initialCosts.total;
  let acceptedMoves = 0;
  let iterations = 0;

  for (let iter = 0; iter < config.maxIterations; iter++) {
    iterations = iter + 1;
    let improved = false;
    let tried = 0;
    for (let i = 0; i < best.length && tried < config.maxCandidatesPerIter; i++) {
      for (let j = i + 1; j < best.length && tried < config.maxCandidatesPerIter; j++) {
        tried += 1;
        const candidate = trySwap(best, i, j, columns);
        if (!candidate) continue;
        const costs = computeCosts(candidate, edges, columns, config);
        if (costs.total + 1e-9 < bestCost) {
          best = candidate;
          bestCost = costs.total;
          acceptedMoves += 1;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const finalCosts = computeCosts(best, edges, columns, config);
  diagnostics.push(
    `Optimiser: iterations=${iterations}, accepted=${acceptedMoves}, cost ${initialCosts.total.toFixed(3)} → ${finalCosts.total.toFixed(3)}.`,
  );

  const gridItems: GridLayoutItemSpec[] = best
    .slice()
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((p) => ({
      ref: p.ref,
      row: p.row,
      column: p.column,
      column_span: p.span === 1 ? undefined : p.span,
    }));

  return {
    grid: {
      type: 'grid',
      columns,
      placement: layout.placement,
      items: gridItems,
    },
    undirectedEdges: edges,
    sectionOrder,
    initialCost: initialCosts.total,
    finalCost: finalCosts.total,
    semanticCostInitial: initialCosts.semantic,
    semanticCostFinal: finalCosts.semantic,
    orderingCostInitial: initialCosts.ordering,
    orderingCostFinal: finalCosts.ordering,
    compactnessCostInitial: initialCosts.compactness,
    compactnessCostFinal: finalCosts.compactness,
    iterations,
    acceptedMoves,
    diagnostics,
  };
}
