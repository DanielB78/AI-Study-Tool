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
  leadInGap: 8,
  belowGap: 12,
  equationStackGap: 28,
  /** Preferred presentation width for attached equations. */
  attachedMaxWidth: EQUATION_MAX_INITIAL_WIDTH,
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

  const preferred: Rect = {
    x: opts.targetText.x + Math.max(0, (opts.targetText.width - width) / 2),
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

/** Stack rank below equation — lower appears closer to the equation. */
const BELOW_STACK_RANK: Partial<Record<ComponentRole, number>> = {
  equation_step_explanation: 0,
  equation_symbol_definitions: 1,
  equation_interpretation: 2,
  equation_warning: 3,
};

export type EquationChromePlacementDecision = {
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  reflow?: { elementIds: string[]; dy: number };
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
  const widthHint = Math.max(
    opts.equation.width,
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
      x: opts.equation.x,
      y,
      width: size.width,
      height: size.height,
    };
    const placed = tryPlace(preferred, opts.elements);
    return {
      ...placed,
      width: size.width,
      height: size.height,
      reason: `${opts.role}_above_equation`,
    };
  }

  // Below-equation stack
  const below = chrome.filter((el) => {
    const role = el.componentMeta?.role as ComponentRole | undefined;
    return role && BELOW_STACK_RANK[role] !== undefined;
  });
  const myRank = BELOW_STACK_RANK[opts.role] ?? 50;

  let stackY =
    opts.equation.y + opts.equation.height + EQUATION_COMPONENT_LAYOUT.belowGap;
  for (const el of below) {
    const rank = BELOW_STACK_RANK[el.componentMeta!.role as ComponentRole] ?? 50;
    if (rank < myRank) {
      stackY = Math.max(
        stackY,
        el.y + el.height + EQUATION_COMPONENT_LAYOUT.belowGap,
      );
    }
  }

  const preferred: Rect = {
    x: opts.equation.x,
    y: stackY,
    width: size.width,
    height: size.height,
  };

  // Shift later siblings down
  const toShift = below
    .filter((el) => {
      const rank = BELOW_STACK_RANK[el.componentMeta!.role as ComponentRole] ?? 50;
      return rank >= myRank && el.y >= stackY - 1;
    })
    .sort((a, b) => a.y - b.y);

  const dy = size.height + EQUATION_COMPONENT_LAYOUT.belowGap;
  const shiftIds = new Set(toShift.map((e) => e.id));
  const placed = tryPlace(
    preferred,
    opts.elements.filter((el) => !shiftIds.has(el.id)),
  );

  return {
    ...placed,
    width: size.width,
    height: size.height,
    reason: `${opts.role}_below_equation`,
    ...(toShift.length > 0
      ? { reflow: { elementIds: toShift.map((e) => e.id), dy } }
      : {}),
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
