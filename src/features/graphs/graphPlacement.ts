/**
 * Automatic placement for GraphElements attached to TextElements,
 * and for graph-associated textbook TextComponents (title/caption/etc.).
 */

import type {
  Camera,
  CanvasElement,
  GraphElement,
  TextElement,
} from '../../types/canvas';
import { getElementBounds, rectsIntersect } from '../../utils/coordinates';
import { findFreeWorldPlacement } from '../ai/agent/placementService';
import {
  placeAiTextRect,
  type Rect,
  type ViewportSize,
} from '../ai/canvas/placement';
import {
  COMPONENT_LAYOUT,
  getComponentType,
  measureTextComponent,
  TEXT_COMPONENT_STYLES,
  type TextComponentMeta,
  type TextComponentType,
} from '../text/textComponents';
import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
} from './types';

export const GRAPH_COMPONENT_LAYOUT = {
  titleGap: 12,
  captionGap: 10,
  observationGap: 14,
  graphStackGap: 24,
  graphSideGap: 20,
  /** Preferred graph width when attached to text. */
  attachedWidth: 420,
  attachedHeight: 280,
} as const;

function asRect(el: CanvasElement): Rect {
  return getElementBounds(el);
}

function overlaps(candidate: Rect, elements: CanvasElement[]): boolean {
  return elements.some((el) => rectsIntersect(candidate, asRect(el)));
}

function tryPlace(preferred: Rect, obstacles: CanvasElement[]): Rect {
  if (!overlaps(preferred, obstacles)) return preferred;
  return findFreeWorldPlacement(preferred, obstacles, 'both');
}

export function getGraphAssociation(el: GraphElement): NonNullable<
  GraphElement['association']
> {
  return (
    el.association ?? {
      placementMode: 'auto',
    }
  );
}

/** Text/graph siblings auto-managed under a parent TextElement. */
export function relatedToText(
  elements: CanvasElement[],
  textId: string,
): CanvasElement[] {
  return elements.filter((el) => {
    if (el.id === textId) return false;
    if (el.type === 'text') {
      return (
        el.componentMeta?.associatedElementId === textId &&
        el.componentMeta.placementMode !== 'manual'
      );
    }
    if (el.type === 'graph') {
      return (
        el.association?.associatedElementId === textId &&
        el.association.placementMode !== 'manual'
      );
    }
    return false;
  });
}

function isExercise(el: CanvasElement): boolean {
  return el.type === 'text' && getComponentType(el) === 'exercise';
}

function isGraphChrome(el: CanvasElement): boolean {
  if (el.type !== 'text') return false;
  const role = el.componentMeta?.role;
  return (
    role === 'graph_title' ||
    role === 'graph_caption' ||
    role === 'graph_observation' ||
    role === 'graph_comment'
  );
}

/**
 * Measure presentation bounds of a graph including auto-placed chrome
 * (title above, caption/observations below).
 */
export function measureGraphPresentation(
  graph: GraphElement,
  elements: CanvasElement[],
): Rect {
  let minX = graph.x;
  let minY = graph.y;
  let maxX = graph.x + graph.width;
  let maxY = graph.y + graph.height;

  for (const el of elements) {
    if (el.type !== 'text') continue;
    if (el.componentMeta?.associatedElementId !== graph.id) continue;
    if (el.componentMeta.placementMode === 'manual') continue;
    const b = asRect(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export type GraphAttachPlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  associatedElementId: string;
  order: number;
  /** Auto exercises that should shift down by this amount (world units). */
  exerciseShift?: number;
};

/**
 * Place a new GraphElement relative to a parent TextElement.
 * Default: after explanatory components, before exercises.
 */
export function resolveGraphAttachPlacement(opts: {
  targetText: TextElement;
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
  width?: number;
  height?: number;
}): GraphAttachPlacementDecision {
  const width = opts.width ?? GRAPH_COMPONENT_LAYOUT.attachedWidth;
  const height = opts.height ?? GRAPH_COMPONENT_LAYOUT.attachedHeight;
  const related = relatedToText(opts.elements, opts.targetText.id);
  const existingGraphs = related.filter(
    (el): el is GraphElement => el.type === 'graph',
  );
  const order = existingGraphs.length;

  const exercises = related.filter(isExercise);
  const explanatory = related.filter(
    (el) => !isExercise(el) && !isGraphChrome(el) && el.type !== 'graph',
  );

  // Bottom of explanatory stack (or main text)
  let stackBottom =
    opts.targetText.y + opts.targetText.height + COMPONENT_LAYOUT.stackGap;
  for (const el of explanatory) {
    const b = asRect(el);
    stackBottom = Math.max(stackBottom, b.y + b.height + COMPONENT_LAYOUT.stackGap);
  }

  // Existing graphs — stack below their presentation bounds
  for (const g of existingGraphs) {
    const pres = measureGraphPresentation(g, opts.elements);
    stackBottom = Math.max(
      stackBottom,
      pres.y + pres.height + GRAPH_COMPONENT_LAYOUT.graphStackGap,
    );
  }

  // Prefer side-by-side for a second graph when room exists
  if (existingGraphs.length === 1) {
    const first = existingGraphs[0]!;
    const firstPres = measureGraphPresentation(first, opts.elements);
    const side: Rect = {
      x: firstPres.x + firstPres.width + GRAPH_COMPONENT_LAYOUT.graphSideGap,
      y: firstPres.y,
      width,
      height,
    };
    const viewportRight =
      opts.camera.x + opts.viewport.width / Math.max(opts.camera.zoom, 0.01);
    if (side.x + side.width < viewportRight - 40 && !overlaps(side, opts.elements)) {
      return {
        ...side,
        reason: 'graph_beside_existing',
        associatedElementId: opts.targetText.id,
        order,
      };
    }
  }

  const preferred: Rect = {
    x: opts.targetText.x,
    y: stackBottom,
    width,
    height,
  };

  // If exercises sit in the way and are auto, place before them and shift later
  let exerciseShift = 0;
  if (exercises.length > 0) {
    const topExercise = Math.min(...exercises.map((e) => e.y));
    if (preferred.y + preferred.height + GRAPH_COMPONENT_LAYOUT.graphStackGap > topExercise) {
      preferred.y = Math.min(preferred.y, topExercise);
      // Will insert above exercises; shift them down by graph height + gap
      exerciseShift =
        height + GRAPH_COMPONENT_LAYOUT.graphStackGap;
      // Actually place at current stack bottom which may already be above exercises
      // Recompute: insert just above top exercise if stack would overlap
      if (stackBottom + height > topExercise) {
        preferred.y = topExercise;
      }
    }
  }

  const placed = tryPlace(preferred, opts.elements);
  return {
    ...placed,
    width,
    height,
    reason:
      exerciseShift > 0
        ? 'graph_before_exercises'
        : order > 0
          ? 'graph_stack_below_siblings'
          : 'graph_below_text_stack',
    associatedElementId: opts.targetText.id,
    order,
    ...(exerciseShift > 0 ? { exerciseShift } : {}),
  };
}

/** Stack rank — lower appears closer to the graph (default reading order). */
const GRAPH_TEXT_STACK_RANK: Partial<Record<TextComponentType, number>> = {
  caption: 0,
  key_observation: 1,
  main_text: 2,
  definition: 3,
  example: 4,
  warning: 5,
  exercise: 6,
};

const MIN_SIDE_GRAPH_WIDTH = 280;
const MIN_SIDE_TEXT_WIDTH = 220;

export type GraphChromePlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  /** Auto-placed siblings to shift down after inserting this component. */
  reflow?: { elementIds: string[]; dy: number };
};

function stackRankOf(el: TextElement): number {
  return GRAPH_TEXT_STACK_RANK[getComponentType(el)] ?? 50;
}

/**
 * Place a textbook / chrome component relative to a GraphElement.
 * Used by title/caption/observation/comment and add_text_to_graph.
 */
export function resolveGraphChromePlacement(opts: {
  componentType: TextComponentType;
  text: string;
  meta?: TextComponentMeta;
  graph: GraphElement;
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
}): GraphChromePlacementDecision {
  const widthHint = Math.max(
    opts.graph.width * 0.85,
    TEXT_COMPONENT_STYLES[opts.componentType].defaultWidth,
  );
  const size = measureTextComponent({
    componentType: opts.componentType,
    text: opts.text,
    meta: opts.meta,
    availableWidth: widthHint,
  });

  const chrome = opts.elements.filter(
    (el): el is TextElement =>
      el.type === 'text' &&
      el.componentMeta?.associatedElementId === opts.graph.id &&
      el.componentMeta.placementMode !== 'manual',
  );

  if (opts.componentType === 'title') {
    const preferred: Rect = {
      x: opts.graph.x,
      y: opts.graph.y - size.height - GRAPH_COMPONENT_LAYOUT.titleGap,
      width: size.width,
      height: size.height,
    };
    const placed = tryPlace(preferred, opts.elements);
    return {
      ...placed,
      width: size.width,
      height: size.height,
      reason: 'graph_title_above',
    };
  }

  if (opts.componentType === 'linked_comment') {
    const preferred: Rect = {
      x: opts.graph.x + opts.graph.width + GRAPH_COMPONENT_LAYOUT.graphSideGap,
      y: opts.graph.y,
      width: size.width,
      height: size.height,
    };
    const placed = tryPlace(preferred, opts.elements);
    return {
      ...placed,
      width: size.width,
      height: size.height,
      reason: 'graph_comment_beside',
    };
  }

  const rank = GRAPH_TEXT_STACK_RANK[opts.componentType] ?? 50;

  // Prefer explanation beside the graph when both keep comfortable widths.
  if (opts.componentType === 'main_text') {
    const viewportRight =
      opts.camera.x + opts.viewport.width / Math.max(opts.camera.zoom, 0.01);
    const sideX =
      opts.graph.x + opts.graph.width + GRAPH_COMPONENT_LAYOUT.graphSideGap;
    const room = viewportRight - sideX - 40;
    if (
      opts.graph.width >= MIN_SIDE_GRAPH_WIDTH &&
      room >= MIN_SIDE_TEXT_WIDTH
    ) {
      const w = Math.min(
        Math.max(size.width, MIN_SIDE_TEXT_WIDTH),
        TEXT_COMPONENT_STYLES.main_text.defaultWidth,
        room,
      );
      const sideSize = measureTextComponent({
        componentType: 'main_text',
        text: opts.text,
        meta: opts.meta,
        availableWidth: w,
      });
      const preferred: Rect = {
        x: sideX,
        y: opts.graph.y,
        width: w,
        height: sideSize.height,
      };
      if (!overlaps(preferred, opts.elements)) {
        return { ...preferred, reason: 'graph_explanation_beside' };
      }
    }
  }

  const presentation = measureGraphPresentation(opts.graph, opts.elements);
  let y =
    presentation.y + presentation.height + GRAPH_COMPONENT_LAYOUT.captionGap;

  for (const el of chrome) {
    const elType = getComponentType(el);
    if (elType === 'title' || elType === 'linked_comment') continue;
    const elRank = stackRankOf(el);
    if (elRank < rank || (elRank === rank && elType === opts.componentType)) {
      const b = asRect(el);
      y = Math.max(
        y,
        b.y + b.height + GRAPH_COMPONENT_LAYOUT.observationGap,
      );
    }
  }

  const width = Math.min(size.width, Math.max(opts.graph.width, 280));
  const height = measureTextComponent({
    componentType: opts.componentType,
    text: opts.text,
    meta: opts.meta,
    availableWidth: width,
  }).height;

  const preferred: Rect = { x: opts.graph.x, y, width, height };

  const exerciseRank = GRAPH_TEXT_STACK_RANK.exercise ?? 6;
  const toShift = chrome.filter((el) => {
    const elType = getComponentType(el);
    if (elType === 'title' || elType === 'linked_comment') return false;
    const elRank = stackRankOf(el);
    if (elRank > rank) return true;
    return elType === 'exercise' && rank < exerciseRank;
  });

  const dy =
    toShift.length > 0
      ? height + GRAPH_COMPONENT_LAYOUT.observationGap
      : 0;

  if (toShift.length > 0 && rank < exerciseRank) {
    const topShiftY = Math.min(...toShift.map((e) => e.y));
    if (preferred.y + preferred.height + 4 > topShiftY) {
      preferred.y = Math.max(
        presentation.y +
          presentation.height +
          GRAPH_COMPONENT_LAYOUT.captionGap,
        topShiftY,
      );
    }
  }

  const obstacles = opts.elements.filter(
    (el) => !toShift.some((s) => s.id === el.id),
  );
  const placed = tryPlace(preferred, obstacles);

  return {
    ...placed,
    width,
    height,
    reason: `${opts.componentType}_below_graph`,
    ...(dy > 0 && toShift.length > 0
      ? { reflow: { elementIds: toShift.map((e) => e.id), dy } }
      : {}),
  };
}

/** Shift auto-placed related elements when parent graph moves. */
export function followGraphMove(
  elements: CanvasElement[],
  graphId: string,
  dx: number,
  dy: number,
): CanvasElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) => {
    if (el.type !== 'text') return el;
    if (el.componentMeta?.associatedElementId !== graphId) return el;
    if (el.componentMeta.placementMode === 'manual') return el;
    return { ...el, x: el.x + dx, y: el.y + dy };
  });
}

export function markGraphManual(el: GraphElement): GraphElement {
  return {
    ...el,
    association: {
      ...(el.association ?? { placementMode: 'manual' }),
      placementMode: 'manual',
    },
  };
}

/** Standalone graph (no text association) — viewport default. */
export function resolveStandaloneGraphPlacement(opts: {
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
  width?: number;
  height?: number;
}): Rect {
  const width = opts.width ?? DEFAULT_GRAPH_WIDTH;
  const height = opts.height ?? DEFAULT_GRAPH_HEIGHT;
  return placeAiTextRect({
    width,
    height,
    camera: opts.camera,
    elements: opts.elements,
    viewport: opts.viewport,
  });
}
