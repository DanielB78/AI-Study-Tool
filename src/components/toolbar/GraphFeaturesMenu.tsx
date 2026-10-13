import { useEffect, useRef, useState } from 'react';
import type { GraphElement } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import {
  uiAddGraphCaption,
  uiAddGraphComment,
  uiAddGraphObservation,
  uiAddGraphRegion,
  uiAnnotateGraphPoint,
  uiAttachExistingGraphToText,
  uiRemoveGraphRegion,
  uiSetGraphCurveLabel,
  uiSetGraphLegend,
  uiSetGraphTitle,
} from '../../features/graphs/graphComponentUi';
import type { GraphLegendVisibility, GraphRegionType } from '../../features/graphs/types';
import { useGraphUiStore } from '../../features/graphs/graphUiStore';

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

          <div className="ctx-features-divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const choice = window.prompt(
                'Legend visibility: auto | show | hide',
                element.settings.legendVisibility ?? 'auto',
              );
              if (!choice?.trim()) return;
              const v = choice.trim().toLowerCase();
              if (v !== 'auto' && v !== 'show' && v !== 'hide') return;
              uiSetGraphLegend(element.id, v as GraphLegendVisibility);
              close();
            }}
          >
            Legend: {element.settings.legendVisibility ?? 'auto'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              if (element.expressions.length === 0) {
                window.alert('No curves to rename.');
                return;
              }
              const list = element.expressions
                .map(
                  (e, i) =>
                    `${i + 1}. ${e.id}  (${e.label || e.sourceText || 'unnamed'})`,
                )
                .join('\n');
              const pick = window.prompt(
                `Rename which curve?\n${list}\nEnter expression id:`,
                element.expressions[0]!.id,
              );
              if (!pick?.trim()) return;
              const expr = element.expressions.find((e) => e.id === pick.trim());
              if (!expr) return;
              const label = window.prompt(
                'Curve display name',
                expr.label || expr.sourceText,
              );
              if (!label?.trim()) return;
              uiSetGraphCurveLabel(element.id, expr.id, label);
              close();
            }}
          >
            Rename curve
          </button>

          <div className="ctx-features-divider" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const typeRaw = window.prompt(
                'Region type: x_interval | rectangle | curve_segment\n(then drag on the graph)',
                'x_interval',
              );
              if (!typeRaw?.trim()) return;
              const type = typeRaw.trim() as GraphRegionType;
              if (
                type !== 'x_interval' &&
                type !== 'rectangle' &&
                type !== 'curve_segment'
              ) {
                return;
              }
              let expressionId: string | undefined;
              if (type === 'curve_segment') {
                expressionId =
                  window.prompt(
                    'expression_id for curve segment',
                    element.expressions[0]?.id ?? '',
                  )?.trim() || undefined;
                if (!expressionId) return;
              }
              useGraphUiStore.getState().startRegionTool({
                graphId: element.id,
                regionType: type,
                ...(expressionId ? { expressionId } : {}),
              });
              close();
            }}
          >
            Highlight region (drag)
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-features-item"
            onClick={() => {
              const typeRaw = window.prompt(
                'Region type: x_interval | rectangle | curve_segment',
                'x_interval',
              );
              if (!typeRaw?.trim()) return;
              const type = typeRaw.trim() as GraphRegionType;
              if (
                type !== 'x_interval' &&
                type !== 'rectangle' &&
                type !== 'curve_segment'
              ) {
                return;
              }
              const xMin = Number(window.prompt('x_min', '1'));
              const xMax = Number(window.prompt('x_max', '3'));
              if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin === xMax) {
                return;
              }
              const label =
                window.prompt('Region label (optional)', '')?.trim() || undefined;
              if (type === 'rectangle') {
                const yMin = Number(window.prompt('y_min', '0'));
                const yMax = Number(window.prompt('y_max', '2'));
                if (
                  !Number.isFinite(yMin) ||
                  !Number.isFinite(yMax) ||
                  yMin === yMax
                ) {
                  return;
                }
                uiAddGraphRegion(element.id, {
                  type,
                  x_min: xMin,
                  x_max: xMax,
                  y_min: yMin,
                  y_max: yMax,
                  label,
                });
              } else if (type === 'curve_segment') {
                const exprId =
                  window.prompt(
                    'expression_id',
                    element.expressions[0]?.id ?? '',
                  )?.trim() ?? '';
                if (!exprId) return;
                uiAddGraphRegion(element.id, {
                  type,
                  x_min: xMin,
                  x_max: xMax,
                  expression_id: exprId,
                  label,
                });
              } else {
                uiAddGraphRegion(element.id, {
                  type,
                  x_min: xMin,
                  x_max: xMax,
                  label,
                });
              }
              close();
            }}
          >
            Highlight region (values)
          </button>
          {(element.regions ?? []).length > 0 && (
            <button
              type="button"
              role="menuitem"
              className="ctx-features-item"
              onClick={() => {
                const list = (element.regions ?? [])
                  .map(
                    (r) =>
                      `${r.id}  ${r.type}  [${r.xMin}, ${r.xMax}]${r.label ? `  ${r.label}` : ''}`,
                  )
                  .join('\n');
                const id = window.prompt(
                  `Remove which region?\n${list}\nEnter region id:`,
                  element.regions[0]?.id ?? '',
                );
                if (!id?.trim()) return;
                uiRemoveGraphRegion(element.id, id.trim());
                close();
              }}
            >
              Remove region
            </button>
          )}

          <div className="ctx-features-divider" role="separator" />

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
