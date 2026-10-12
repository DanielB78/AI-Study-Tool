/**
 * Collapsed comment indicators + open comment popovers for TextElements.
 * Popovers are overlays — they do not expand persistent element bounds.
 */

import { useMemo } from 'react';
import type { Camera, TextElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import {
  uiRemoveTextComment,
  uiToggleCommentOpen,
  uiUpdateTextComment,
} from '../features/text/textFeatureUi';
import { TEXT_FEATURE_LAYOUT } from '../features/text/textFeatures';

interface Props {
  texts: TextElement[];
  camera: Camera;
}

const COMMENT_ACCENT: Record<string, string> = {
  explanation: '#2563EB',
  correction: '#DC2626',
  suggestion: '#16A34A',
  question: '#EA580C',
};

function estimateBodyTopOffset(el: TextElement): number {
  let y = el.padding;
  if (el.title?.text.trim()) {
    const titleSize = Math.round(el.fontSize * 1.35);
    y += titleSize * 1.25 + TEXT_FEATURE_LAYOUT.titleGap;
  }
  return y;
}

export function TextCommentLayer({ texts, camera }: Props) {
  const items = useMemo(() => {
    return texts
      .filter((el) => (el.comments?.length ?? 0) > 0)
      .map((el) => {
        const topLeft = worldToScreen({ x: el.x, y: el.y }, camera);
        return { el, topLeft };
      });
  }, [texts, camera]);

  if (items.length === 0) return null;

  return (
    <div className="text-comment-layer">
      {items.map(({ el, topLeft }) => {
        const zoom = camera.zoom;
        const bodyTop = estimateBodyTopOffset(el) * zoom;
        const comments = el.comments ?? [];
        return (
          <div
            key={el.id}
            className="text-comment-host"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${topLeft.x}px, ${topLeft.y}px)`,
              width: el.width * zoom,
              height: el.height * zoom,
              pointerEvents: 'none',
            }}
          >
            {comments.map((c, i) => {
              const accent = COMMENT_ACCENT[c.commentType] ?? '#2563EB';
              const indicatorTop = bodyTop + i * 22 * zoom;
              const open = c.displayState === 'open';
              const panelX = (c.panelOffsetX ?? el.width + 8) * zoom;
              const panelY =
                (c.panelOffsetY ?? estimateBodyTopOffset(el) + i * 28) * zoom;
              return (
                <div key={c.id}>
                  <button
                    type="button"
                    className="text-comment-indicator"
                    title={c.anchor.quote}
                    style={{
                      position: 'absolute',
                      right: 4 * zoom,
                      top: indicatorTop,
                      pointerEvents: 'auto',
                      borderColor: accent,
                      color: accent,
                      fontSize: Math.max(10, 11 * zoom),
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      uiToggleCommentOpen(c.id, !open);
                    }}
                  >
                    ✎
                  </button>
                  {open && (
                    <div
                      className="text-comment-popover"
                      style={{
                        position: 'absolute',
                        left: panelX,
                        top: panelY,
                        width: Math.max(160, 220 * zoom),
                        pointerEvents: 'auto',
                        borderColor: accent,
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="text-comment-popover__head">
                        <span style={{ color: accent }}>{c.commentType}</span>
                        <button
                          type="button"
                          className="text-comment-popover__close"
                          onClick={() => uiToggleCommentOpen(c.id, false)}
                        >
                          ×
                        </button>
                      </div>
                      <div className="text-comment-popover__quote">
                        “{c.anchor.quote}”
                        {c.anchor.status === 'unresolved' && (
                          <em> (anchor unresolved)</em>
                        )}
                      </div>
                      <textarea
                        className="text-comment-popover__body"
                        defaultValue={c.text}
                        rows={3}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next && next !== c.text) {
                            uiUpdateTextComment(c.id, next);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="text-comment-popover__delete"
                        onClick={() => uiRemoveTextComment(c.id)}
                      >
                        Delete comment
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
