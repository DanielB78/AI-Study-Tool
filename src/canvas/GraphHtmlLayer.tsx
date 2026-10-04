/**
 * Screen-space HTML overlays for GraphElements (Chart.js stays sharp under camera zoom).
 */

import { useCallback, useMemo } from 'react';
import type { Camera, GraphElement } from '../types/canvas';
import { worldToScreen } from '../utils/coordinates';
import { useCanvasStore } from '../store/canvasStore';
import { GraphElementWidget } from '../features/graphs/GraphElementWidget';
import { useGraphUiStore } from '../features/graphs/graphUiStore';
import type { GraphViewport } from '../features/graphs/types';
import { touch } from '../utils/ids';

interface Props {
  graphs: GraphElement[];
  camera: Camera;
  selectedIds: readonly string[];
  hiddenIds?: ReadonlySet<string>;
}

export function GraphHtmlLayer({
  graphs,
  camera,
  selectedIds,
  hiddenIds,
}: Props) {
  const interactingGraphId = useGraphUiStore((s) => s.interactingGraphId);
  const enterInteract = useGraphUiStore((s) => s.enterInteract);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const commitViewport = useCallback((id: string, viewport: GraphViewport) => {
    const store = useCanvasStore.getState();
    // Single history entry per completed pan/zoom gesture (plugin fires onComplete).
    store.beginInteraction();
    store.updateElement(id, (el) => {
      if (el.type !== 'graph') return el;
      return touch({ ...el, viewport });
    });
    store.endInteraction();
    store.persist();
  }, []);

  const items = useMemo(() => {
    return graphs.map((el) => {
      const topLeft = worldToScreen({ x: el.x, y: el.y }, camera);
      return { el, topLeft };
    });
  }, [graphs, camera]);

  return (
    <div className="graph-html-layer">
      {items.map(({ el, topLeft }) => {
        if (hiddenIds?.has(el.id)) return null;
        const w = el.width * camera.zoom;
        const h = el.height * camera.zoom;
        const interactive = interactingGraphId === el.id;
        const selected = selectedSet.has(el.id);
        return (
          <div
            key={el.id}
            className="graph-html-item"
            style={{
              transform: `translate(${topLeft.x}px, ${topLeft.y}px) rotate(${el.rotation}deg)`,
              width: w,
              height: h,
              opacity: el.opacity,
              // Hit-testing stays on Konva unless interacting with the plot.
              pointerEvents: interactive ? 'auto' : 'none',
              zIndex: interactive ? 6 : 4,
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              enterInteract(el.id);
            }}
          >
            <GraphElementWidget
              element={el}
              width={w}
              height={h}
              interactive={interactive}
              selected={selected}
              onViewportCommit={(viewport) => commitViewport(el.id, viewport)}
            />
          </div>
        );
      })}
    </div>
  );
}
