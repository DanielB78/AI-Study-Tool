import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Camera, ShapeElement, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';

type Editable =
  | { kind: 'text'; element: TextElement }
  | { kind: 'shapeLabel'; element: ShapeElement };

interface Props {
  target: Editable;
  camera: Camera;
  containerRect: DOMRect | null;
  onChangeText: (text: string, width: number, height: number) => void;
  onChangeLabel: (label: string) => void;
  onClose: () => void;
}

export function TextEditorOverlay({
  target,
  camera,
  containerRect,
  onChangeText,
  onChangeLabel,
  onClose,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ignoreBlurUntil = useRef(0);
  const id = target.element.id;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    ignoreBlurUntil.current = Date.now() + 300;
    el.focus();
    el.select();
  }, [id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(
      target.element.height * camera.zoom,
      el.scrollHeight,
    )}px`;
  }, [target, camera.zoom]);

  if (!containerRect) return null;

  const el = target.element;
  const screen = worldToScreen({ x: el.x, y: el.y }, camera);
  const left = containerRect.left + screen.x;
  const top = containerRect.top + screen.y;
  const width = Math.max(el.width * camera.zoom, 40);

  const isText = target.kind === 'text';
  const textEl = isText ? target.element : null;
  const shapeEl = !isText ? target.element : null;

  const value = isText ? textEl!.text : shapeEl!.label;
  const fontSize = (isText ? textEl!.fontSize : shapeEl!.labelFontSize) * camera.zoom;
  const fontFamily = isText ? textEl!.fontFamily : shapeEl!.labelFontFamily;
  const fontWeight = isText ? textEl!.fontWeight : shapeEl!.labelFontWeight;
  const fontItalic = isText ? textEl!.fontItalic : shapeEl!.labelFontItalic;
  const color = isText ? textEl!.color : shapeEl!.labelColor;
  const align = isText ? textEl!.alignment : 'center';
  const bg = isText ? textEl!.backgroundColor : null;
  const padding = isText ? textEl!.padding * camera.zoom : 8 * camera.zoom;
  const lineHeight = isText ? textEl!.lineHeight : 1.3;
  const radius = isText ? textEl!.cornerRadius * camera.zoom : 0;

  return (
    <textarea
      ref={ref}
      className="text-editor-overlay"
      value={value}
      style={{
        position: 'fixed',
        left,
        top,
        width,
        minHeight: Math.max(el.height * camera.zoom, fontSize * 1.4),
        fontSize,
        fontFamily,
        fontWeight: fontWeight === 'bold' ? 700 : 400,
        fontStyle: fontItalic ? 'italic' : 'normal',
        textDecoration: isText
          ? [
              textEl!.underline ? 'underline' : '',
              textEl!.strikethrough ? 'line-through' : '',
            ]
              .filter(Boolean)
              .join(' ')
          : 'none',
        color,
        textAlign: align,
        lineHeight,
        padding,
        background: bg ?? 'rgba(255,255,255,0.96)',
        borderRadius: radius,
        transform: `rotate(${el.rotation}deg)`,
        transformOrigin: 'top left',
        zIndex: 40,
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (isText) {
          const measuredHeight = Math.max(
            textEl!.fontSize * textEl!.lineHeight + textEl!.padding * 2,
            e.target.scrollHeight / camera.zoom,
          );
          onChangeText(next, textEl!.width, measuredHeight);
        } else {
          onChangeLabel(next);
        }
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => {
        if (Date.now() < ignoreBlurUntil.current) {
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
