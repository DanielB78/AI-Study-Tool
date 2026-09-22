import { nanoid } from 'nanoid';
import type { BaseElement, CanvasElement } from '../types/canvas';

export function createId(): string {
  return nanoid(12);
}

export function now(): number {
  return Date.now();
}

export function createBaseFields(
  partial: Partial<
    Pick<BaseElement, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'metadata'>
  > & { zIndex: number },
): BaseElement {
  const t = now();
  return {
    id: createId(),
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 0,
    height: partial.height ?? 0,
    rotation: partial.rotation ?? 0,
    zIndex: partial.zIndex,
    createdAt: t,
    updatedAt: t,
    metadata: partial.metadata ?? {},
  };
}

export function touch<T extends CanvasElement>(element: T): T {
  return { ...element, updatedAt: now() };
}

export function cloneElement(element: CanvasElement, offset = 20): CanvasElement {
  return touch({
    ...structuredClone(element),
    id: createId(),
    x: element.x + offset,
    y: element.y + offset,
    createdAt: now(),
    metadata: { ...element.metadata },
  });
}
