import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Camera, ShapeElement, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import {
  getRichTextDocument,
  richTextToPlainText,
  type RichTextDocument,
} from '../features/text/richText';
import { htmlToRichText, richTextToHtml } from '../features/text/richTextHtml';

type Editable =
  | { kind: 'text'; element: TextElement }
  | { kind: 'shapeLabel'; element: ShapeElement };

interface Props {
  target: Editable;
  camera: Camera;
  containerRect: DOMRect | null;
  onChangeText: (text: string, width: number, height: number) => void;
  onChangeRichText?: (
    richText: RichTextDocument,
    plain: string,
    width: number,
    height: number,
  ) => void;
  onChangeLabel: (label: string) => void;
  onClose: () => void;
}

export function TextEditorOverlay({
  target,
  camera,
  containerRect,
  onChangeText,
  onChangeRichText,
  onChangeLabel,
  onClose,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const richRef = useRef<HTMLDivElement>(null);
  const ignoreBlurUntil = useRef(0);
  const id = target.element.id;
  const isText = target.kind === 'text';
  const useRich =
    isText &&
    !!(target.element.richText && target.element.richText.blocks.length > 0);

  useLayoutEffect(() => {
    ignoreBlurUntil.current = Date.now() + 300;
    if (useRich) {
      const el = richRef.current;
      if (!el) return;
      el.focus();
    } else {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
  }, [id, useRich]);

  useEffect(() => {
    if (useRich) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(
      target.element.height * camera.zoom,
      el.scrollHeight,
    )}px`;
  }, [target, camera.zoom, useRich]);

  useEffect(() => {
    if (!useRich || !isText) return;
    const el = richRef.current;
    if (!el) return;
    const doc = getRichTextDocument(target.element);
    el.innerHTML = richTextToHtml(doc, {
      color: target.element.color,
      fontSize: target.element.fontSize,
      fontFamily: target.element.fontFamily,
    });
  }, [id, useRich, isText]); // eslint-disable-line react-hooks/exhaustive-deps -- seed once per open

  if (!containerRect) return null;

  const el = target.element;
  const screen = worldToScreen({ x: el.x, y: el.y }, camera);
  const left = containerRect.left + screen.x;
  const top = containerRect.top + screen.y;
  const width = Math.max(el.width * camera.zoom, 40);

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

  const sharedStyle: CSSProperties = {
    position: 'fixed',
    left,
    top,
    width,
    minHeight: Math.max(el.height * camera.zoom, fontSize * 1.4),
    fontSize,
    fontFamily,
    fontWeight: fontWeight === 'bold' ? 700 : 400,
    fontStyle: fontItalic ? 'italic' : 'normal',
    color,
    textAlign: align,
    lineHeight,
    padding,
    background: bg ?? 'rgba(255,255,255,0.96)',
    borderRadius: radius,
    transform: `rotate(${el.rotation}deg)`,
    transformOrigin: 'top left',
    zIndex: 40,
    boxSizing: 'border-box',
    overflow: 'auto',
  };

  const commitRich = () => {
    const host = richRef.current;
    if (!host || !textEl || !onChangeRichText) return;
    const root =
      (host.querySelector('[data-rt-root]') as HTMLElement | null) ?? host;
    const rich = htmlToRichText(root, { baseFontSize: textEl.fontSize });
    const plain = richTextToPlainText(rich);
    const measuredHeight = Math.max(
      textEl.fontSize * textEl.lineHeight + textEl.padding * 2,
      host.scrollHeight / camera.zoom,
    );
    onChangeRichText(rich, plain, textEl.width, measuredHeight);
  };

  if (useRich && textEl) {
    return (
      <div
        ref={richRef}
        className="text-editor-overlay text-editor-overlay--rich"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        data-rich-editor="1"
        style={{
          ...sharedStyle,
          outline: '2px solid rgba(37, 99, 235, 0.35)',
        }}
        onInput={() => commitRich()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => {
          if (Date.now() < ignoreBlurUntil.current) {
            requestAnimationFrame(() => richRef.current?.focus());
            return;
          }
          commitRich();
          onClose();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            commitRich();
            onClose();
          }
        }}
      />
    );
  }

  return (
    <textarea
      ref={textareaRef}
      className="text-editor-overlay"
      value={value}
      style={{
        ...sharedStyle,
        textDecoration: isText
          ? [
              textEl!.underline ? 'underline' : '',
              textEl!.strikethrough ? 'line-through' : '',
            ]
              .filter(Boolean)
              .join(' ')
          : 'none',
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
          requestAnimationFrame(() => textareaRef.current?.focus());
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
