import type { CanvasElement, StyleDefaults, TextElement } from '../../../types/canvas';
import type { Camera } from '../../../types/canvas';
import { createAiTextElement, measureAiTextSize } from './createAiTextElement';
import {
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
  const zIndex = target.nextZIndex();
  const sized = measureAiTextSize(trimmed, { style });

  const placed = placeAiTextRect({
    camera,
    viewport,
    elements,
    width: sized.width,
    height: sized.height,
  });

  const element = createAiTextElement(trimmed, { x: placed.x, y: placed.y }, {
    zIndex,
    style,
    width: sized.width,
    autoSize: true,
    metadata: { source: 'chat', autoSize: true },
  });
  element.height = sized.height;

  target.addElement(element, true);
  target.afterInsert?.(element);
  return { element };
}
