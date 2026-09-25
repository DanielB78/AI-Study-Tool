import { Rect } from 'react-konva';
import { useMemo } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import { expandRect } from '../geometry';
import { computeDebugContext, useRagDebugStore } from '../ragDebugStore';

/**
 * Transient Konva overlay for RAG debug highlights.
 * Not part of CanvasDocument — visualization only.
 */
export function RagDebugOverlay() {
  const open = useRagDebugStore((s) => s.open);
  const prompt = useRagDebugStore((s) => s.prompt);
  const candidates = useRagDebugStore((s) => s.candidates);
  const selectedAnchorIds = useRagDebugStore((s) => s.selectedAnchorIds);
  const radius = useRagDebugStore((s) => s.radius);
  const camera = useCanvasStore((s) => s.document.camera);
  const elements = useCanvasStore((s) => s.document.elements);

  const { context } = useMemo(() => {
    if (!open) {
      return {
        context: {
          semanticAnchors: [] as ReturnType<typeof computeDebugContext>['context']['semanticAnchors'],
          spatialElements: [] as ReturnType<typeof computeDebugContext>['context']['spatialElements'],
        },
      };
    }
    return computeDebugContext(
      { prompt, candidates, selectedAnchorIds, radius },
      elements,
    );
  }, [open, prompt, candidates, selectedAnchorIds, radius, elements]);

  if (!open) return null;

  const strokeScale = 1 / camera.zoom;
  const semanticIds = new Set(context.semanticAnchors.map((e) => e.element_id));

  return (
    <>
      {/* Soft expanded AABB around each semantic anchor (approx. radius region). */}
      {radius > 0 &&
        context.semanticAnchors.map((anchor) => {
          const expanded = expandRect(anchor.geometry, radius);
          return (
            <Rect
              key={`rag-radius-${anchor.element_id}`}
              x={expanded.x}
              y={expanded.y}
              width={expanded.width}
              height={expanded.height}
              fill="rgba(15, 118, 110, 0.06)"
              stroke="rgba(15, 118, 110, 0.35)"
              strokeWidth={1 * strokeScale}
              dash={[6 * strokeScale, 4 * strokeScale]}
              cornerRadius={4 * strokeScale}
              listening={false}
            />
          );
        })}

      {/* Spatial inclusions — amber; skipped if also semantic. */}
      {context.spatialElements.map((el) => {
        if (semanticIds.has(el.element_id)) return null;
        return (
          <Rect
            key={`rag-spatial-${el.element_id}`}
            x={el.geometry.x - 3}
            y={el.geometry.y - 3}
            width={el.geometry.width + 6}
            height={el.geometry.height + 6}
            fill="rgba(217, 119, 6, 0.08)"
            stroke="rgba(217, 119, 6, 0.7)"
            strokeWidth={1.5 * strokeScale}
            listening={false}
          />
        );
      })}

      {/* Semantic anchors — teal; take precedence. */}
      {context.semanticAnchors.map((el) => (
        <Rect
          key={`rag-sem-${el.element_id}`}
          x={el.geometry.x - 4}
          y={el.geometry.y - 4}
          width={el.geometry.width + 8}
          height={el.geometry.height + 8}
          fill="rgba(15, 118, 110, 0.10)"
          stroke="rgba(15, 118, 110, 0.9)"
          strokeWidth={2 * strokeScale}
          listening={false}
        />
      ))}
    </>
  );
}
