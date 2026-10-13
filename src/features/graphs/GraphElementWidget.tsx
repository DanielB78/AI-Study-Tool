/**
 * GraphElementWidget — chrome around Chart.js plot (title, interaction badge, header).
 */

import { useCallback, useRef } from 'react';
import type { GraphElement } from '../../types/canvas';
import type { GraphViewport } from './types';
import { GraphPlot } from './GraphPlot';
import { useGraphUiStore } from './graphUiStore';

interface Props {
  element: GraphElement;
  /** Screen-space CSS size (world size * camera.zoom). */
  width: number;
  height: number;
  interactive: boolean;
  selected: boolean;
  onViewportCommit: (viewport: GraphViewport) => void;
  /** Drag header to move element while interacting (optional). */
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
}

export function GraphElementWidget({
  element,
  width,
  height,
  interactive,
  selected,
  onViewportCommit,
  onHeaderPointerDown,
}: Props) {
  const setCursor = useGraphUiStore((s) => s.setCursor);
  const cursor = useGraphUiStore((s) =>
    s.interactingGraphId === element.id ? s.cursor : null,
  );
  const regionToolActive = useGraphUiStore(
    (s) => s.regionTool?.graphId === element.id,
  );

  // Coalesce pan/zoom into a single commit when gesture ends (plugin already fires complete).
  const pending = useRef<GraphViewport | null>(null);
  const onViewportChange = useCallback(
    (viewport: GraphViewport) => {
      pending.current = viewport;
      onViewportCommit(viewport);
    },
    [onViewportCommit],
  );

  const headerH = Math.max(22, Math.min(28, height * 0.08));
  const plotH = Math.max(40, height - headerH);

  return (
    <div
      className={[
        'graph-element-widget',
        selected ? 'is-selected' : '',
        interactive ? 'is-interacting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width, height }}
    >
      <div
        className="graph-element-header"
        style={{ height: headerH }}
        onPointerDown={onHeaderPointerDown}
        title={interactive ? 'Drag header to move graph on canvas' : undefined}
      >
        <span className="graph-element-title">
          {element.settings.title.trim() || 'Graph'}
        </span>
        {interactive && !regionToolActive && (
          <span className="graph-element-badge">Graph interaction active</span>
        )}
        {regionToolActive && (
          <span className="graph-element-badge">Highlight region — drag on plot</span>
        )}
        {interactive && cursor && (
          <span className="graph-element-cursor">
            x={cursor.x.toFixed(2)} · y={cursor.y.toFixed(2)}
          </span>
        )}
      </div>
      <div className="graph-element-plot-wrap" style={{ height: plotH }}>
        <GraphPlot
          element={element}
          width={width}
          height={plotH}
          interactive={interactive}
          onViewportChange={onViewportChange}
          onCursorMove={interactive ? setCursor : undefined}
        />
      </div>
    </div>
  );
}
