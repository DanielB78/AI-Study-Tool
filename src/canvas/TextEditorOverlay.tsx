import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Camera, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';

interface Props {
  element: TextElement;
  camera: Camera;
  containerRect: DOMRect | null;
  onChange: (text: string, width: number, height: number) => void;
  onClose: () => void;
}

export function TextEditorOverlay({
  element,
  camera,
  containerRect,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ignoreBlurUntil = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    ignoreBlurUntil.current = Date.now() + 300;
    el.focus();
    el.select();
  }, [element.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(element.height * camera.zoom, el.scrollHeight)}px`;
  }, [element.text, element.height, element.fontSize, camera.zoom]);

  if (!containerRect) return null;

  const screen = worldToScreen({ x: element.x, y: element.y }, camera);
  const left = containerRect.left + screen.x;
  const top = containerRect.top + screen.y;
  const width = Math.max(element.width * camera.zoom, 40);

  return (
    <textarea
      ref={ref}
      className="text-editor-overlay"
      value={element.text}
      style={{
        position: 'fixed',
        left,
        top,
        width,
        minHeight: Math.max(element.height * camera.zoom, element.fontSize * camera.zoom * 1.4),
        fontSize: element.fontSize * camera.zoom,
        fontFamily: element.fontFamily,
        fontWeight: element.fontStyle === 'bold' ? 700 : 400,
        color: element.color,
        textAlign: element.alignment,
        lineHeight: 1.25,
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: 'top left',
        zIndex: 40,
      }}
      onChange={(e) => {
        const next = e.target.value;
        const measuredHeight = Math.max(
          element.fontSize * 1.4 + 8,
          e.target.scrollHeight / camera.zoom,
        );
        onChange(next, element.width, measuredHeight);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => {
        if (Date.now() < ignoreBlurUntil.current) {
          // Re-focus if the creating click / transient focus steal blurred us.
          requestAnimationFrame(() => ref.current?.focus());
          return;
        }
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    />
  );
}
