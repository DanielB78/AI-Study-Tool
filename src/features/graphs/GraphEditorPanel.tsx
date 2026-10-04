/**
 * Graph editor panel — expressions, viewport limits, settings, points.
 */

import { useEffect, useMemo, useState } from 'react';
import type { GraphElement } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import { touch } from '../../utils/ids';
import {
  createEmptyGraphExpression,
  createGraphPoint,
} from './createGraphElement';
import { validateGraphExpression } from './expressionService';
import { fitViewportToSamples, sampleAllExpressions } from './sampling';
import {
  DEFAULT_GRAPH_VIEWPORT,
  isValidViewport,
  type GraphExpression,
  type GraphSettings,
  type GraphViewport,
} from './types';
import { useGraphUiStore } from './graphUiStore';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function ExpressionRow({
  expression,
  index,
  onChange,
  onRemove,
}: {
  expression: GraphExpression;
  index: number;
  onChange: (next: GraphExpression) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(expression.sourceText);
  const debounced = useDebounced(draft, 180);

  useEffect(() => {
    setDraft(expression.sourceText);
  }, [expression.id, expression.sourceText]);

  useEffect(() => {
    if (debounced === expression.sourceText) return;
    // Persist canonical GraphMathSyntax when valid; otherwise keep draft so the
    // user can keep editing without losing invalid in-progress input.
    const validated = validateGraphExpression(debounced, 'human');
    const nextSource =
      validated.ok && validated.normalizedSource
        ? validated.normalizedSource
        : debounced;
    if (nextSource === expression.sourceText) return;
    onChange({ ...expression, sourceText: nextSource });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional debounce sync
  }, [debounced]);

  const validation = useMemo(
    () => validateGraphExpression(draft, 'human'),
    [draft],
  );

  return (
    <div className="graph-expr-row">
      <div className="graph-expr-row-top">
        <label className="graph-check">
          <input
            type="checkbox"
            checked={expression.visible}
            onChange={(e) =>
              onChange({ ...expression, visible: e.target.checked })
            }
          />
          <span
            className="graph-expr-swatch"
            style={{ background: expression.style.color }}
          />
          <span className="graph-expr-index">y{index + 1}</span>
        </label>
        <button type="button" className="graph-btn ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
      <input
        className={`graph-input mono${validation.ok || !draft.trim() ? '' : ' is-invalid'}`}
        value={draft}
        placeholder="e.g. x**2 or sin(x)"
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
      />
      {!validation.ok && draft.trim() && (
        <p className="graph-expr-error">Invalid expression — {validation.error}</p>
      )}
      <div className="graph-expr-domain">
        <span className="graph-meta">Domain</span>
        <input
          className="graph-input num"
          type="number"
          step="any"
          placeholder="min"
          value={expression.domainMin ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...expression,
              domainMin: v === '' ? null : Number(v),
            });
          }}
        />
        <span className="graph-meta">≤ x ≤</span>
        <input
          className="graph-input num"
          type="number"
          step="any"
          placeholder="max"
          value={expression.domainMax ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...expression,
              domainMax: v === '' ? null : Number(v),
            });
          }}
        />
      </div>
      <div className="graph-expr-style">
        <label className="graph-meta">
          Color
          <input
            type="color"
            value={expression.style.color}
            onChange={(e) =>
              onChange({
                ...expression,
                style: { ...expression.style, color: e.target.value },
              })
            }
          />
        </label>
      </div>
    </div>
  );
}

export function GraphEditorPanel() {
  const editingGraphId = useGraphUiStore((s) => s.editingGraphId);
  const closeEditor = useGraphUiStore((s) => s.closeEditor);
  const enterInteract = useGraphUiStore((s) => s.enterInteract);
  const elements = useCanvasStore((s) => s.document.elements);

  const element = elements.find(
    (el): el is GraphElement => el.type === 'graph' && el.id === editingGraphId,
  );

  if (!element || !editingGraphId) return null;

  const patch = (updater: (g: GraphElement) => GraphElement, options?: { history?: boolean }) => {
    const store = useCanvasStore.getState();
    if (options?.history !== false) store.pushHistory();
    store.updateElement(element.id, (el) => {
      if (el.type !== 'graph') return el;
      return touch(updater(el));
    });
    store.persist();
  };

  const setExpressions = (
    expressions: GraphExpression[],
    options?: { history?: boolean },
  ) => {
    patch((g) => ({ ...g, expressions }), options);
  };

  const setViewport = (viewport: GraphViewport) => {
    if (!isValidViewport(viewport)) return;
    patch((g) => ({ ...g, viewport }));
  };

  const setSettings = (settings: GraphSettings) => {
    patch((g) => ({ ...g, settings }));
  };

  const resetView = () => setViewport({ ...DEFAULT_GRAPH_VIEWPORT });

  const fitView = () => {
    const samples = sampleAllExpressions(element.expressions, element.viewport, {
      pixelWidth: element.width,
    });
    const fitted = fitViewportToSamples(samples);
    if (fitted) setViewport(fitted);
  };

  return (
    <aside
      className="graph-editor-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="graph-editor-header">
        <strong>Edit Graph</strong>
        <div className="graph-editor-header-actions">
          <button
            type="button"
            className="graph-btn"
            onClick={() => {
              enterInteract(element.id);
            }}
          >
            Interact
          </button>
          <button type="button" className="graph-btn ghost" onClick={closeEditor}>
            Close
          </button>
        </div>
      </header>

      <section className="graph-editor-section">
        <div className="graph-editor-section-title">Expressions</div>
        {element.expressions.length === 0 && (
          <p className="graph-meta">No expressions yet. Add one to plot y = f(x).</p>
        )}
        {element.expressions.map((expr, index) => (
          <ExpressionRow
            key={expr.id}
            expression={expr}
            index={index}
            onChange={(next) => {
              const prev = element.expressions.find((e) => e.id === next.id);
              const onlySource =
                prev &&
                prev.sourceText !== next.sourceText &&
                prev.visible === next.visible &&
                prev.domainMin === next.domainMin &&
                prev.domainMax === next.domainMax &&
                prev.style.color === next.style.color &&
                prev.style.strokeWidth === next.style.strokeWidth;
              setExpressions(
                element.expressions.map((e) => (e.id === next.id ? next : e)),
                { history: !onlySource },
              );
            }}
            onRemove={() => {
              setExpressions(element.expressions.filter((e) => e.id !== expr.id));
            }}
          />
        ))}
        <button
          type="button"
          className="graph-btn primary"
          onClick={() => {
            setExpressions([
              ...element.expressions,
              createEmptyGraphExpression(element.expressions.length, ''),
            ]);
          }}
        >
          + Add expression
        </button>
      </section>

      <section className="graph-editor-section">
        <div className="graph-editor-section-title">Viewport</div>
        <div className="graph-viewport-grid">
          <label>
            X min
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={element.viewport.xMin}
              onChange={(e) =>
                setViewport({
                  ...element.viewport,
                  xMin: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            X max
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={element.viewport.xMax}
              onChange={(e) =>
                setViewport({
                  ...element.viewport,
                  xMax: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Y min
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={element.viewport.yMin}
              onChange={(e) =>
                setViewport({
                  ...element.viewport,
                  yMin: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Y max
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={element.viewport.yMax}
              onChange={(e) =>
                setViewport({
                  ...element.viewport,
                  yMax: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        {!isValidViewport(element.viewport) && (
          <p className="graph-expr-error">Invalid range — min must be &lt; max.</p>
        )}
        <div className="graph-row">
          <button type="button" className="graph-btn" onClick={resetView}>
            Reset View
          </button>
          <button type="button" className="graph-btn ghost" onClick={fitView}>
            Fit
          </button>
        </div>
      </section>

      <section className="graph-editor-section">
        <div className="graph-editor-section-title">Settings</div>
        <label className="graph-check">
          <input
            type="checkbox"
            checked={element.settings.showGrid}
            onChange={(e) =>
              setSettings({ ...element.settings, showGrid: e.target.checked })
            }
          />
          Show grid
        </label>
        <label className="graph-check">
          <input
            type="checkbox"
            checked={element.settings.showXAxis}
            onChange={(e) =>
              setSettings({ ...element.settings, showXAxis: e.target.checked })
            }
          />
          Show X axis
        </label>
        <label className="graph-check">
          <input
            type="checkbox"
            checked={element.settings.showYAxis}
            onChange={(e) =>
              setSettings({ ...element.settings, showYAxis: e.target.checked })
            }
          />
          Show Y axis
        </label>
        <label className="graph-field">
          Title
          <input
            className="graph-input"
            value={element.settings.title}
            onChange={(e) =>
              setSettings({ ...element.settings, title: e.target.value })
            }
          />
        </label>
        <label className="graph-field">
          X axis label
          <input
            className="graph-input"
            value={element.settings.xAxisLabel}
            onChange={(e) =>
              setSettings({ ...element.settings, xAxisLabel: e.target.value })
            }
          />
        </label>
        <label className="graph-field">
          Y axis label
          <input
            className="graph-input"
            value={element.settings.yAxisLabel}
            onChange={(e) =>
              setSettings({ ...element.settings, yAxisLabel: e.target.value })
            }
          />
        </label>
      </section>

      <section className="graph-editor-section">
        <div className="graph-editor-section-title">Points</div>
        {element.points.map((p) => (
          <div key={p.id} className="graph-point-row">
            <label className="graph-check">
              <input
                type="checkbox"
                checked={p.visible}
                onChange={(e) =>
                  patch((g) => ({
                    ...g,
                    points: g.points.map((pt) =>
                      pt.id === p.id ? { ...pt, visible: e.target.checked } : pt,
                    ),
                  }))
                }
              />
            </label>
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={p.x}
              onChange={(e) =>
                patch((g) => ({
                  ...g,
                  points: g.points.map((pt) =>
                    pt.id === p.id ? { ...pt, x: Number(e.target.value) } : pt,
                  ),
                }))
              }
            />
            <input
              className="graph-input num"
              type="number"
              step="any"
              value={p.y}
              onChange={(e) =>
                patch((g) => ({
                  ...g,
                  points: g.points.map((pt) =>
                    pt.id === p.id ? { ...pt, y: Number(e.target.value) } : pt,
                  ),
                }))
              }
            />
            <input
              className="graph-input"
              placeholder="label"
              value={p.label}
              onChange={(e) =>
                patch((g) => ({
                  ...g,
                  points: g.points.map((pt) =>
                    pt.id === p.id ? { ...pt, label: e.target.value } : pt,
                  ),
                }))
              }
            />
            <button
              type="button"
              className="graph-btn ghost"
              onClick={() =>
                patch((g) => ({
                  ...g,
                  points: g.points.filter((pt) => pt.id !== p.id),
                }))
              }
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="graph-btn"
          onClick={() =>
            patch((g) => ({
              ...g,
              points: [...g.points, createGraphPoint(0, 0)],
            }))
          }
        >
          + Add point
        </button>
      </section>
    </aside>
  );
}
