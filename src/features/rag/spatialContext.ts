/**
 * Spatial expansion stage — independent of semantic ranking.
 * Finds canvas elements whose AABB distance to an anchor is ≤ radius.
 *
 * Operates over CANVAS ELEMENT GEOMETRY (not the embedding index).
 * ImageElements and GraphElements are spatial-only candidates:
 * geometry (+ asset ref for images). Graphs have NO embeddings.
 */

import type { CanvasElement, ImageElement, TextElement } from '../../types/canvas';
import { boundingBoxDistance, type WorldRect } from './geometry';

/** Common derived spatial metadata for any eligible canvas element. */
export interface SpatialElementRecord {
  board_id: string;
  element_id: string;
  element_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Image asset reference (data URL / storage URL). Never duplicated as binary in RAG DB. */
  asset_src?: string;
  /** Lightweight hash of the asset reference for change detection (not an embedding). */
  content_hash?: string | null;
  updated_at?: number;
}

/** Image-specific spatial record (no embedding vector). */
export type ImageSpatialRecord = SpatialElementRecord & {
  element_type: 'image';
  asset_src: string;
};

export interface SpatialHit {
  element_id: string;
  element_type: string;
  anchor_element_id: string;
  distance: number;
  geometry: WorldRect;
  /** Full text when available (TextElement / equation latex / shape label). */
  text: string;
  /** Image asset src when element_type === 'image'. Not a caption. */
  image_src?: string;
}

export interface SpatialElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  latex?: string;
  /** ImageElement.src — asset reference only. */
  src?: string;
}

function toRect(el: SpatialElementLike): WorldRect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

function extractText(el: SpatialElementLike): string {
  if (typeof el.text === 'string' && el.text.length > 0) return el.text;
  if (typeof el.latex === 'string' && el.latex.length > 0) return el.latex;
  if (typeof el.label === 'string' && el.label.length > 0) return el.label;
  return '';
}

/** Lightweight non-cryptographic hash of an asset reference string. */
export function hashAssetRef(src: string): string {
  let h = 5381;
  for (let i = 0; i < src.length; i += 1) {
    h = ((h << 5) + h) ^ src.charCodeAt(i);
  }
  // Include length so truncated-looking refs still differentiate.
  return `h${(h >>> 0).toString(16)}_L${src.length}`;
}

/**
 * Eligible types for spatial context.
 * Images and graphs are included even though they have no embedding.
 * Graphs: geometry only for retrieval — structured state is enriched later.
 */
export function isSpatiallyEligible(el: SpatialElementLike): boolean {
  if (el.type === 'text') return true;
  if (el.type === 'equation') return true;
  if (el.type === 'image') return true;
  if (el.type === 'graph') return true;
  if (el.type === 'handwriting_region') return true;
  // Shape labels only when non-empty — no invented semantics.
  if (el.type === 'shape' && typeof el.label === 'string' && el.label.trim()) {
    return true;
  }
  return false;
}

/**
 * Find elements within `radius` world units of `anchor` (AABB distance).
 *
 * Radius ≤ 0 → empty list (pure semantic mode; even distance-0 neighbours
 * are excluded so developers can test semantic-only context).
 * The anchor itself is never returned as a spatial hit.
 */
export function findElementsWithinRadius(
  anchor: SpatialElementLike,
  elements: readonly SpatialElementLike[],
  radius: number,
): SpatialHit[] {
  if (radius <= 0) return [];

  const anchorRect = toRect(anchor);
  const hits: SpatialHit[] = [];

  for (const el of elements) {
    if (el.id === anchor.id) continue;
    if (!isSpatiallyEligible(el)) continue;
    const distance = boundingBoxDistance(anchorRect, toRect(el));
    if (distance <= radius) {
      const hit: SpatialHit = {
        element_id: el.id,
        element_type: el.type,
        anchor_element_id: anchor.id,
        distance,
        geometry: toRect(el),
        text: extractText(el),
      };
      if (el.type === 'image' && typeof el.src === 'string') {
        hit.image_src = el.src;
      }
      hits.push(hit);
    }
  }

  hits.sort((a, b) => a.distance - b.distance || a.element_id.localeCompare(b.element_id));
  return hits;
}

/** Expand around multiple anchors; callers should dedupe by element id. */
export function findElementsNearAnchors(
  anchors: readonly SpatialElementLike[],
  elements: readonly SpatialElementLike[],
  radius: number,
): SpatialHit[] {
  if (radius <= 0 || anchors.length === 0) return [];
  const all: SpatialHit[] = [];
  for (const anchor of anchors) {
    all.push(...findElementsWithinRadius(anchor, elements, radius));
  }
  return all;
}

export function canvasElementsAsSpatial(
  elements: readonly CanvasElement[],
  extra?: readonly SpatialElementLike[],
): SpatialElementLike[] {
  const base: SpatialElementLike[] = elements.map((el) => {
    if (el.type === 'text') {
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        text: el.text,
      };
    }
    if (el.type === 'equation') {
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        latex: el.latex,
        text: el.latex,
      };
    }
    if (el.type === 'shape') {
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        label: el.label,
      };
    }
    if (el.type === 'image') {
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        src: el.src,
      };
    }
    if (el.type === 'graph') {
      return {
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        // Structured graph body is filled from live CanvasDocument when
        // building context — never embed graph content.
      };
    }
    return {
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    };
  });
  if (!extra?.length) return base;
  const seen = new Set(base.map((e) => e.id));
  const out = [...base];
  for (const el of extra) {
    if (seen.has(el.id)) continue;
    out.push(el);
    seen.add(el.id);
  }
  return out;
}

export function textElementAsSpatial(el: TextElement): SpatialElementLike {
  return {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    text: el.text,
  };
}

/** Derive a SpatialElementRecord from a live canvas element (CanvasDocument is source of truth). */
export function toSpatialElementRecord(
  boardId: string,
  el: CanvasElement,
): SpatialElementRecord | null {
  if (!isSpatiallyEligible({
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    text: el.type === 'text' ? el.text : undefined,
    label: el.type === 'shape' ? el.label : undefined,
    latex: el.type === 'equation' ? el.latex : undefined,
    src: el.type === 'image' ? el.src : undefined,
  })) {
    return null;
  }

  const base: SpatialElementRecord = {
    board_id: boardId,
    element_id: el.id,
    element_type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    updated_at: el.updatedAt,
  };

  if (el.type === 'image') {
    return {
      ...base,
      element_type: 'image',
      asset_src: el.src,
      content_hash: hashAssetRef(el.src),
    } satisfies ImageSpatialRecord;
  }

  return base;
}

/** Derive spatial records for all eligible elements on a board. */
export function deriveSpatialElementRecords(
  boardId: string,
  elements: readonly CanvasElement[],
): SpatialElementRecord[] {
  const out: SpatialElementRecord[] = [];
  for (const el of elements) {
    const rec = toSpatialElementRecord(boardId, el);
    if (rec) out.push(rec);
  }
  return out;
}

/** Image-only spatial records (no embeddings). */
export function deriveImageSpatialRecords(
  boardId: string,
  elements: readonly CanvasElement[],
): ImageSpatialRecord[] {
  return deriveSpatialElementRecords(boardId, elements).filter(
    (r): r is ImageSpatialRecord => r.element_type === 'image' && !!r.asset_src,
  );
}

/** Resolve live ImageElement from CanvasDocument by id. */
export function resolveImageElement(
  elements: readonly CanvasElement[],
  elementId: string,
): ImageElement | null {
  const el = elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'image') return null;
  return el;
}
