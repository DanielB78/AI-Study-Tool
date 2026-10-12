/**
 * HTML overlays for TextElements that carry structured richText,
 * optional title, and supplementary notes.
 *
 * Screen geometry = world geometry × camera.zoom. Rich HTML uses em sizes
 * relative to this host font-size so headings/spans scale with the box.
 */

import { useMemo } from 'react';
import type { Camera, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import { getRichTextDocument } from '../features/text/richText';
import { richTextToHtml } from '../features/text/richTextHtml';
import {
  sortedNotes,
  TEXT_FEATURE_LAYOUT,
  textElementNeedsHtmlOverlay,
} from '../features/text/textFeatures';

interface Props {
  texts: TextElement[];
  camera: Camera;
  editingId: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFeatureHtml(el: TextElement): string {
  const parts: string[] = [];
  if (el.title?.text.trim()) {
    parts.push(
      `<div class="text-feature-title" data-title-id="${escapeHtml(el.title.id)}">${escapeHtml(el.title.text)}</div>`,
    );
  }
  if (el.richText && el.richText.blocks.length > 0) {
    const doc = getRichTextDocument(el);
    parts.push(
      richTextToHtml(doc, {
        color: el.color,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
      }),
    );
  } else if (el.title || (el.notes && el.notes.length > 0)) {
    parts.push(`<div class="text-feature-body">${escapeHtml(el.text)}</div>`);
  }
  const notes = sortedNotes(el);
  if (notes.length > 0) {
    parts.push(`<div class="text-feature-notes">`);
    for (const note of notes) {
      parts.push(
        `<div class="text-feature-note" data-note-id="${escapeHtml(note.id)}" data-note-type="${escapeHtml(note.noteType)}">${escapeHtml(note.text)}</div>`,
      );
    }
    parts.push(`</div>`);
  }
  return parts.join('');
}

export function TextHtmlLayer({ texts, camera, editingId }: Props) {
  const items = useMemo(() => {
    return texts
      .filter(textElementNeedsHtmlOverlay)
      .map((el) => {
        const topLeft = worldToScreen({ x: el.x, y: el.y }, camera);
        const html = buildFeatureHtml(el);
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
              fontSize: el.fontSize * zoom,
              ['--text-title-gap' as string]: `${TEXT_FEATURE_LAYOUT.titleGap * zoom}px`,
              ['--text-note-gap' as string]: `${TEXT_FEATURE_LAYOUT.noteGap * zoom}px`,
              ['--text-note-sep' as string]: `${TEXT_FEATURE_LAYOUT.noteSeparatorGap * zoom}px`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
