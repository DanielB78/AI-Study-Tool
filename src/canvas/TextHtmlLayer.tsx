/**
 * HTML overlays for TextElements that carry structured richText.
 *
 * Screen geometry = world geometry × camera.zoom. Rich HTML uses em sizes
 * relative to this host font-size so headings/spans scale with the box.
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
        // World-unit base fontSize — host applies zoom via CSS font-size.
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
        const zoom = camera.zoom;
        const w = el.width * zoom;
        const h = el.height * zoom;
        const pad = el.padding * zoom;
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
              borderRadius: el.cornerRadius * zoom,
              opacity: el.opacity,
              overflow: 'hidden',
              pointerEvents: 'none',
              // Single zoom scale for all nested em-based rich text sizes.
              fontSize: el.fontSize * zoom,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
