/**
 * Spatial expansion stage — independent of semantic ranking.
 * Finds canvas elements whose AABB distance to an anchor is ≤ radius.
 */

import type { CanvasElement, TextElement } from '../../types/canvas';
import { boundingBoxDistance, type WorldRect } from './geometry';

export interface SpatialHit {
  element_id: string;
  element_type: string;
  anchor_element_id: string;
  distance: number;
  geometry: WorldRect;
  /** Full text when available (TextElement). */
  text: string;
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
}

function toRect(el: SpatialElementLike): WorldRect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

function extractText(el: SpatialElementLike): string {
  if (typeof el.text === 'string' && el.text.length > 0) return el.text;
  if (typeof el.label === 'string' && el.label.length > 0) return el.label;
  return '';
}

/**
 * Eligible types for spatial context (v1: TextElements primarily).
 * Extensible later for shapes-with-labels, connectors, etc.
 */
export function isSpatiallyEligible(el: SpatialElementLike): boolean {
  if (el.type === 'text') return true;
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
      hits.push({
        element_id: el.id,
        element_type: el.type,
        anchor_element_id: anchor.id,
        distance,
        geometry: toRect(el),
        text: extractText(el),
      });
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
): SpatialElementLike[] {
  return elements.map((el) => {
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
    return {
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    };
  });
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
