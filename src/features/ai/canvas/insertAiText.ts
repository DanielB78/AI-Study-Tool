import type { CanvasElement, StyleDefaults, TextElement } from '../../../types/canvas';
import type { Camera } from '../../../types/canvas';
import { createAiTextElement } from './createAiTextElement';
import {
  AI_TEXT_DEFAULT_WIDTH,
  getDefaultViewportSize,
  placeAiTextRect,
  type ViewportSize,
} from './placement';

/**
 * Dependencies for inserting an AI text response onto the board.
 * Injected so tests can use a fake canvas without talking to Zustand.
 */
export interface AiCanvasInsertTarget {
  getCamera: () => Camera;
  getElements: () => CanvasElement[];
  getStyle: () => StyleDefaults;
  nextZIndex: () => number;
  /** Existing editor mutation — creates one undoable history entry. */
  addElement: (element: CanvasElement, select?: boolean) => void;
  afterInsert?: (element: TextElement) => void;
  getViewportSize?: () => ViewportSize;
}

export interface InsertAiTextResult {
  element: TextElement;
}

/**
 * Turn plain LLM text into a normal TextElement and insert it via the editor store.
 * Later this can be replaced by a structured operations executor.
 */
export function insertAiTextResponse(
  text: string,
  target: AiCanvasInsertTarget,
): InsertAiTextResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const camera = target.getCamera();
  const elements = target.getElements();
  const style = target.getStyle();
  const viewport = target.getViewportSize?.() ?? getDefaultViewportSize();
  const width = AI_TEXT_DEFAULT_WIDTH;
  const zIndex = target.nextZIndex();

  // Probe height with a temporary origin; placement uses the measured size.
  const probe = createAiTextElement(trimmed, { x: 0, y: 0 }, {
    zIndex,
    style,
    width,
  });

  const placed = placeAiTextRect({
    camera,
    viewport,
    elements,
    width: probe.width,
    height: probe.height,
  });

  const element = createAiTextElement(trimmed, { x: placed.x, y: placed.y }, {
    zIndex,
    style,
    width,
  });
  // Keep height from estimate (createAiTextElement recalculates identically).
  element.height = probe.height;

  target.addElement(element, true);
  target.afterInsert?.(element);
  return { element };
}
