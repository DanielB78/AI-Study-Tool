/**
 * HTML KaTeX overlays for EquationElements — positioned in screen space from world geometry.
 */

import { useMemo } from 'react';
import type { Camera, EquationElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import { renderLatexHtml } from '../features/equations/latex';

interface Props {
  equations: EquationElement[];
  camera: Camera;
  editingId: string | null;
  /** Hide overlays for ids currently transformed via Konva drag if needed. */
  hiddenIds?: ReadonlySet<string>;
}

export function EquationHtmlLayer({
  equations,
  camera,
  editingId,
  hiddenIds,
}: Props) {
  const items = useMemo(() => {
    return equations.map((el) => {
      const topLeft = worldToScreen({ x: el.x, y: el.y }, camera);
      const { html, error } = renderLatexHtml(el.latex, {
        displayMode: el.displayMode !== 'inline',
      });
      return { el, topLeft, html, error };
    });
  }, [equations, camera]);

  return (
    <div className="equation-html-layer" aria-hidden>
      {items.map(({ el, topLeft, html, error }) => {
        if (el.id === editingId) return null;
        if (hiddenIds?.has(el.id)) return null;
        const w = el.width * camera.zoom;
        const h = el.height * camera.zoom;
        return (
          <div
            key={el.id}
            className={`equation-html-item${error ? ' equation-html-item--error' : ''}`}
            style={{
              transform: `translate(${topLeft.x}px, ${topLeft.y}px) rotate(${el.rotation}deg)`,
              width: w,
              height: h,
              fontSize: el.fontSize * camera.zoom,
              color: el.color,
              opacity: el.opacity,
              pointerEvents: 'none',
            }}
          >
            {error ? (
              <div className="equation-html-error">
                <strong>Invalid LaTeX</strong>
                <code>{el.latex}</code>
                <span>{error}</span>
              </div>
            ) : (
              <div
                className="equation-html-math"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
