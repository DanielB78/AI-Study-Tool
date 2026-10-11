/**
 * HTML overlays for TextElements that carry structured richText.
 */

import { useMemo } from 'react';
import type { Camera, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import { getRichTextDocument } from '../features/text/richText';
import { richTextToHtml } from '../features/text/richTextHtml';

interface Props {
  texts: TextElement[];
  camera: Camera;
  editingId: string | null;
}

export function TextHtmlLayer({ texts, camera, editingId }: Props) {
  const items = useMemo(() => {
    return texts
      .filter((el) => el.richText && el.richText.blocks.length > 0)
      .map((el) => {
        const topLeft = worldToScreen({ x: el.x, y: el.y }, camera);
        const doc = getRichTextDocument(el);
        const html = richTextToHtml(doc, {
          color: el.color,
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
        });
        return { el, topLeft, html };
      });
  }, [texts, camera]);

  return (
    <div className="text-html-layer" aria-hidden>
      {items.map(({ el, topLeft, html }) => {
        if (el.id === editingId) return null;
        const w = el.width * camera.zoom;
        const h = el.height * camera.zoom;
        const pad = el.padding * camera.zoom;
        return (
          <div
            key={el.id}
            className="text-html-item"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${topLeft.x}px, ${topLeft.y}px) rotate(${el.rotation}deg)`,
              transformOrigin: 'top left',
              width: w,
              height: h,
              padding: pad,
              boxSizing: 'border-box',
              background: el.backgroundColor ?? 'transparent',
              borderRadius: el.cornerRadius * camera.zoom,
              opacity: el.opacity,
              overflow: 'hidden',
              pointerEvents: 'none',
              fontSize: el.fontSize * camera.zoom,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
