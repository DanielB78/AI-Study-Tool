import { useEffect, useRef, useState } from 'react';
import type { GraphElement } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import {
  uiAddGraphCaption,
  uiAddGraphComment,
  uiAddGraphObservation,
  uiAnnotateGraphPoint,
  uiAttachExistingGraphToText,
  uiSetGraphTitle,
} from '../../features/graphs/graphComponentUi';

type Props = {
  element: GraphElement;
};

export function GraphFeaturesMenu({ element }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="ctx-features" ref={rootRef}>
      <button
        type="button"
        className={open ? 'ctx-chip active' : 'ctx-chip'}
        title="Add graph components"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Features ▾
      </button>
      {open && (
        <div className="ctx-features-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt(
                'Graph title',
                element.settings.title || '',
              );
              if (!text?.trim()) return;
              uiSetGraphTitle(element.id, text);
              close();
            }}
          >
            Add / edit title
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Caption / description');
              if (!text?.trim()) return;
              uiAddGraphCaption(element.id, text);
              close();
            }}
          >
            Add caption
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const text = window.prompt('Key observation');
              if (!text?.trim()) return;
              uiAddGraphObservation(element.id, text);
              close();
            }}
          >
            Add observation
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const comment = window.prompt('Comment on this graph');
              if (!comment?.trim()) return;
              const exprId = element.expressions[0]?.id;
              uiAddGraphComment(element.id, comment, exprId);
              close();
            }}
          >
            Add comment
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const xRaw = window.prompt('Mark point at x =', '0');
              if (xRaw == null) return;
              const x = Number(xRaw);
              if (!Number.isFinite(x)) return;
              const label = window.prompt('Point label', 'Marked point');
              if (!label?.trim()) return;
              uiAnnotateGraphPoint(
                element.id,
                x,
                label,
                element.expressions[0]?.id,
              );
              close();
            }}
          >
            Annotate point
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const texts = useCanvasStore
                .getState()
                .document.elements.filter((e) => e.type === 'text');
              if (texts.length === 0) {
                window.alert('No TextElement on the canvas to attach to.');
                return;
              }
              const choice = window.prompt(
                `Attach to TextElement id:\n${texts
                  .slice(0, 8)
                  .map((t) => t.id)
                  .join('\n')}`,
                texts[0]!.id,
              );
              if (!choice?.trim()) return;
              uiAttachExistingGraphToText(element.id, choice.trim());
              close();
            }}
          >
            Attach to text
          </button>
        </div>
      )}
    </div>
  );
}
