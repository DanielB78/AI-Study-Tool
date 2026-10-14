/**
 * Automatic placement for EquationElements attached to TextElements,
 * and for equation-associated textbook TextComponents.
 */

import type {
  Camera,
  CanvasElement,
  EquationElement,
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
  type ComponentRole,
  type TextComponentMeta,
  type TextComponentType,
} from '../text/textComponents';
import {
  EQUATION_DEFAULT_FONT_SIZE,
  EQUATION_MAX_INITIAL_WIDTH,
  measureEquationSize,
} from './latex';

export const EQUATION_COMPONENT_LAYOUT = {
  titleGap: 10,
  leadInGap: 10,
  belowGap: 14,
  equationStackGap: 32,
  /** Preferred presentation width for attached equations. */
  attachedMaxWidth: EQUATION_MAX_INITIAL_WIDTH,
  /** Content-column width used when aligning chrome under a parent TextElement. */
  contentColumnMinWidth: 360,
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

export function getEquationAssociation(el: EquationElement): NonNullable<
  EquationElement['association']
> {
  return (
    el.association ?? {
      placementMode: 'auto',
    }
  );
}

/** Text/equation/graph siblings auto-managed under a parent TextElement. */
export function relatedToTextIncludingEquations(
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
    if (el.type === 'equation') {
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

/**
 * Measure presentation bounds of an equation including auto-placed chrome
 * (title/lead-in above, explanations below).
 */
export function measureEquationPresentation(
  equation: EquationElement,
  elements: CanvasElement[],
): Rect {
  let minX = equation.x;
  let minY = equation.y;
  let maxX = equation.x + equation.width;
  let maxY = equation.y + equation.height;

  for (const el of elements) {
    if (el.type !== 'text') continue;
    if (el.componentMeta?.associatedElementId !== equation.id) continue;
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

export type EquationAttachPlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  associatedElementId: string;
  order: number;
  exerciseShift?: number;
};

/**
 * Place a new EquationElement relative to a parent TextElement.
 * Default: after explanatory content / prior equations, before exercises.
 */
export function resolveEquationAttachPlacement(opts: {
  targetText: TextElement;
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
  latex: string;
  fontSize?: number;
}): EquationAttachPlacementDecision {
  const fontSize = opts.fontSize ?? EQUATION_DEFAULT_FONT_SIZE;
  const size = measureEquationSize(opts.latex, {
    fontSize,
    displayMode: true,
    maxWidth: Math.max(
      opts.targetText.width,
      EQUATION_COMPONENT_LAYOUT.attachedMaxWidth * 0.85,
    ),
  });
  const width = size.width;
  const height = size.height;

  const related = relatedToTextIncludingEquations(
    opts.elements,
    opts.targetText.id,
  );
  const existingEquations = related.filter(
    (el): el is EquationElement => el.type === 'equation',
  );
  const existingGraphs = related.filter((el) => el.type === 'graph');
  const order = existingEquations.length;

  const exercises = related.filter(isExercise);
  const explanatory = related.filter(
    (el) =>
      el.type === 'text' &&
      !isExercise(el) &&
      !String(el.componentMeta?.role ?? '').startsWith('graph_') &&
      !String(el.componentMeta?.role ?? '').startsWith('equation_'),
  );

  let stackBottom =
    opts.targetText.y + opts.targetText.height + COMPONENT_LAYOUT.stackGap;
  for (const el of explanatory) {
    const b = asRect(el);
    stackBottom = Math.max(stackBottom, b.y + b.height + COMPONENT_LAYOUT.stackGap);
  }
  for (const g of existingGraphs) {
    const b = asRect(g);
    stackBottom = Math.max(
      stackBottom,
      b.y + b.height + EQUATION_COMPONENT_LAYOUT.equationStackGap,
    );
  }
  for (const eq of existingEquations) {
    const pres = measureEquationPresentation(eq, opts.elements);
    stackBottom = Math.max(
      stackBottom,
      pres.y + pres.height + EQUATION_COMPONENT_LAYOUT.equationStackGap,
    );
  }

  // Always centre on the parent text column — even when the equation is wider.
  const preferred: Rect = {
    x: opts.targetText.x + (opts.targetText.width - width) / 2,
    y: stackBottom,
    width,
    height,
  };

  let exerciseShift = 0;
  if (exercises.length > 0) {
    const topExercise = Math.min(...exercises.map((e) => e.y));
    if (
      preferred.y + preferred.height + EQUATION_COMPONENT_LAYOUT.equationStackGap >
      topExercise
    ) {
      if (stackBottom + height > topExercise) {
        preferred.y = topExercise;
      }
      exerciseShift = height + EQUATION_COMPONENT_LAYOUT.equationStackGap;
    }
  }

  const placed = tryPlace(preferred, opts.elements);
  return {
    ...placed,
    width,
    height,
    reason:
      exerciseShift > 0
        ? 'equation_before_exercises'
        : order > 0
          ? 'equation_stack_below_siblings'
          : 'equation_below_text_stack',
    associatedElementId: opts.targetText.id,
    order,
    ...(exerciseShift > 0 ? { exerciseShift } : {}),
  };
}

/** Above-equation roles (title, lead-in). */
const ABOVE_ROLES: ReadonlySet<ComponentRole> = new Set([
  'equation_title',
  'equation_lead_in',
]);

/**
 * Stack rank below equation — lower appears closer to the equation.
 * Textbook order: variable defs, then step explanation, then interpretation.
 */
const BELOW_STACK_RANK: Partial<Record<ComponentRole, number>> = {
  equation_symbol_definitions: 0,
  equation_step_explanation: 1,
  equation_interpretation: 2,
  equation_warning: 3,
};

/** Parent TextElement that an equation is associated with, if any. */
function parentTextForEquation(
  equation: EquationElement,
  elements: CanvasElement[],
): TextElement | null {
  const parentId = equation.association?.associatedElementId;
  if (!parentId) return null;
  const parent = elements.find((el) => el.id === parentId);
  return parent?.type === 'text' ? parent : null;
}

/**
 * Content column for equation chrome: left-aligned with parent text when
 * associated; otherwise a column anchored at the equation's left edge.
 */
function contentColumnForEquation(
  equation: EquationElement,
  elements: CanvasElement[],
  componentType: TextComponentType,
): { x: number; width: number } {
  const parent = parentTextForEquation(equation, elements);
  const presetWidth = TEXT_COMPONENT_STYLES[componentType].defaultWidth;
  if (parent) {
    return {
      x: parent.x,
      width: Math.max(
        parent.width,
        equation.width,
        EQUATION_COMPONENT_LAYOUT.contentColumnMinWidth,
        presetWidth,
      ),
    };
  }
  return {
    x: equation.x,
    width: Math.max(
      equation.width,
      EQUATION_COMPONENT_LAYOUT.contentColumnMinWidth,
      presetWidth,
    ),
  };
}

/**
 * When chrome under an equation grows, shift later auto-placed sibling
 * equations (same parent) and their chrome downward.
 */
export function computeSiblingEquationReflow(
  equation: EquationElement,
  elements: CanvasElement[],
  dy: number,
): { elementIds: string[]; dy: number } | null {
  if (dy === 0) return null;
  const parentId = equation.association?.associatedElementId;
  if (!parentId) return null;
  if (equation.association?.placementMode === 'manual') return null;

  const myOrder = equation.association?.order;
  const siblings = elements.filter(
    (el): el is EquationElement =>
      el.type === 'equation' &&
      el.id !== equation.id &&
      el.association?.associatedElementId === parentId &&
      el.association.placementMode !== 'manual' &&
      (typeof myOrder === 'number'
        ? (el.association.order ?? Infinity) > myOrder
        : el.y > equation.y),
  );
  if (siblings.length === 0) return null;

  const ids = new Set<string>();
  for (const sib of siblings) {
    ids.add(sib.id);
    for (const el of elements) {
      if (el.type !== 'text') continue;
      if (el.componentMeta?.associatedElementId !== sib.id) continue;
      if (el.componentMeta.placementMode === 'manual') continue;
      ids.add(el.id);
    }
  }
  return { elementIds: [...ids], dy };
}

export type EquationChromePlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  /**
   * Uniform dy (legacy) and/or per-element shifts. Per-element shifts are
   * preferred when inserting coefficient/symbol text between the equation and
   * later explanations so nothing overlaps.
   */
  reflow?: {
    elementIds?: string[];
    dy?: number;
    shifts?: Array<{ id: string; dy: number }>;
  };
};

/**
 * Place a textbook component relative to an EquationElement.
 */
export function resolveEquationChromePlacement(opts: {
  componentType: TextComponentType;
  role: ComponentRole;
  text: string;
  meta?: TextComponentMeta;
  equation: EquationElement;
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
}): EquationChromePlacementDecision {
  const column = contentColumnForEquation(
    opts.equation,
    opts.elements,
    opts.componentType,
  );
  const size = measureTextComponent({
    componentType: opts.componentType,
    text: opts.text,
    meta: opts.meta,
    availableWidth: column.width,
  });

  const chrome = opts.elements.filter(
    (el): el is TextElement =>
      el.type === 'text' &&
      el.componentMeta?.associatedElementId === opts.equation.id &&
      el.componentMeta.placementMode !== 'manual',
  );

  if (ABOVE_ROLES.has(opts.role)) {
    // Stack titles / lead-ins above the equation (title further up).
    const above = chrome.filter((el) =>
      ABOVE_ROLES.has(el.componentMeta?.role as ComponentRole),
    );
    let top = opts.equation.y;
    for (const el of above) {
      top = Math.min(top, el.y);
    }
    const gap =
      opts.role === 'equation_title'
        ? EQUATION_COMPONENT_LAYOUT.titleGap
        : EQUATION_COMPONENT_LAYOUT.leadInGap;
    // Title sits above lead-in if both exist.
    let y = top - size.height - gap;
    if (opts.role === 'equation_title') {
      y = Math.min(
        y,
        ...above
          .filter((el) => el.componentMeta?.role === 'equation_lead_in')
          .map((el) => el.y - size.height - gap),
        opts.equation.y - size.height - gap,
      );
    }
    const preferred: Rect = {
      x: column.x,
      y,
      width: size.width,
      height: size.height,
    };

    // If lead-in/title would collide with the parent TextElement (or other
    // obstacles above), keep the content-column x and push the equation
    // (plus its chrome / later siblings) downward instead of free-floating.
    const parent = parentTextForEquation(opts.equation, opts.elements);
    const ignoreIds = new Set<string>([
      opts.equation.id,
      ...chrome.map((c) => c.id),
      ...(parent ? [parent.id] : []),
    ]);
    const obstacles = opts.elements.filter((el) => !ignoreIds.has(el.id));
    let placeY = preferred.y;
    if (parent) {
      const parentBottom = parent.y + parent.height + EQUATION_COMPONENT_LAYOUT.leadInGap;
      if (placeY < parentBottom) {
        placeY = parentBottom;
      }
    }
    // Still colliding with unrelated obstacles? Nudge down within the column.
    let guard = 0;
    while (
      overlaps(
        { ...preferred, y: placeY },
        obstacles,
      ) &&
      guard < 40
    ) {
      placeY += 12;
      guard += 1;
    }

    const neededTop = placeY + size.height + gap;
    const equationDy = Math.max(0, neededTop - opts.equation.y);
    const reflowIds: string[] = [];
    if (equationDy > 0) {
      reflowIds.push(opts.equation.id);
      for (const c of chrome) reflowIds.push(c.id);
      const siblingReflow = computeSiblingEquationReflow(
        opts.equation,
        opts.elements,
        equationDy,
      );
      if (siblingReflow) reflowIds.push(...siblingReflow.elementIds);
    }

    return {
      x: column.x,
      y: placeY,
      width: size.width,
      height: size.height,
      reason: `${opts.role}_above_equation`,
      ...(reflowIds.length > 0
        ? { reflow: { elementIds: reflowIds, dy: equationDy } }
        : {}),
    };
  }

  // Below-equation stack (coefficient/symbol defs → step explanation →
  // interpretation → warning). Coefficient text is always immediately under
  // the equation and above any other associated explanation text.
  const below = chrome.filter((el) => {
    const role = el.componentMeta?.role as ComponentRole | undefined;
    return role && BELOW_STACK_RANK[role] !== undefined;
  });
  const myRank = BELOW_STACK_RANK[opts.role] ?? 50;
  const gap = EQUATION_COMPONENT_LAYOUT.belowGap;

  const rankOf = (el: TextElement) =>
    BELOW_STACK_RANK[el.componentMeta!.role as ComponentRole] ?? 50;

  // Pin coefficient/symbol defs directly under the equation. Later roles stack
  // after every lower-rank chrome block.
  let stackY = opts.equation.y + opts.equation.height + gap;
  if (myRank > 0) {
    for (const el of below) {
      if (rankOf(el) < myRank) {
        stackY = Math.max(stackY, el.y + el.height + gap);
      }
    }
  }

  const placeY = stackY;
  const preferred: Rect = {
    x: column.x,
    y: placeY,
    width: size.width,
    height: size.height,
  };

  // Always reflow equal/higher-rank chrome — never leave them as obstacles that
  // would push the new component past them (wrong order / collisions).
  const toRepack = below
    .filter((el) => rankOf(el) >= myRank)
    .sort((a, b) => {
      const dr = rankOf(a) - rankOf(b);
      return dr !== 0 ? dr : a.y - b.y;
    });

  let cursor = placeY + size.height + gap;
  const shifts: Array<{ id: string; dy: number }> = [];
  for (const el of toRepack) {
    const dy = cursor - el.y;
    if (Math.abs(dy) > 0.5) shifts.push({ id: el.id, dy });
    cursor += el.height + gap;
  }

  const shiftIds = new Set(shifts.map((s) => s.id));

  // Unrelated obstacles only (not the equation, not chrome we're repacking).
  const ignoreIds = new Set<string>([
    opts.equation.id,
    ...chrome.map((c) => c.id),
    ...shiftIds,
  ]);
  const obstacles = opts.elements.filter((el) => !ignoreIds.has(el.id));
  let finalY = placeY;
  let guard = 0;
  while (overlaps({ ...preferred, y: finalY }, obstacles) && guard < 40) {
    finalY += 12;
    guard += 1;
  }
  if (finalY !== placeY) {
    const bump = finalY - placeY;
    for (const s of shifts) s.dy += bump;
    // Also shift lower-rank? No — finalY bump means unrelated obstacles;
    // keep coefficient intent: if we had to bump, higher chrome follows.
  }

  // Downstream sibling equations follow the net growth of this below-stack.
  const stackGrowth = size.height + gap + (finalY - placeY);
  const siblingReflow = computeSiblingEquationReflow(
    opts.equation,
    opts.elements,
    stackGrowth,
  );
  if (siblingReflow) {
    for (const id of siblingReflow.elementIds) {
      if (shiftIds.has(id)) continue;
      shifts.push({ id, dy: siblingReflow.dy });
      shiftIds.add(id);
    }
  }

  return {
    x: column.x,
    y: finalY,
    width: size.width,
    height: size.height,
    reason: `${opts.role}_below_equation`,
    ...(shifts.length > 0 ? { reflow: { shifts } } : {}),
  };
}

/** Shift auto-placed related text when parent equation moves. */
export function followEquationMove(
  elements: CanvasElement[],
  equationId: string,
  dx: number,
  dy: number,
): CanvasElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) => {
    if (el.type !== 'text') return el;
    if (el.componentMeta?.associatedElementId !== equationId) return el;
    if (el.componentMeta.placementMode === 'manual') return el;
    return { ...el, x: el.x + dx, y: el.y + dy };
  });
}

export function markEquationManual(el: EquationElement): EquationElement {
  return {
    ...el,
    association: {
      ...(el.association ?? { placementMode: 'manual' }),
      placementMode: 'manual',
    },
  };
}

/** Standalone equation — viewport default. */
export function resolveStandaloneEquationPlacement(opts: {
  elements: CanvasElement[];
  camera: Camera;
  viewport: ViewportSize;
  width: number;
  height: number;
}): Rect {
  return placeAiTextRect({
    width: opts.width,
    height: opts.height,
    camera: opts.camera,
    elements: opts.elements,
    viewport: opts.viewport,
  });
}
