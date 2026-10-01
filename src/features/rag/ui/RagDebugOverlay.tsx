import { Rect } from 'react-konva';
import { useMemo } from 'react';
import { useCanvasStore } from '../../../store/canvasStore';
import { expandRect } from '../geometry';
import { computeDebugContext, useRagDebugStore } from '../ragDebugStore';

/**
 * Transient Konva overlay for RAG debug highlights.
 * Not part of CanvasDocument — visualization only.
 *
 * Colors:
 * - explicit selection: red
 * - prompt semantic anchors: teal
 * - spatial additions: amber
 * - semantic expansion additions: violet
 */
export function RagDebugOverlay() {
  const open = useRagDebugStore((s) => s.open);
  const prompt = useRagDebugStore((s) => s.prompt);
  const candidates = useRagDebugStore((s) => s.candidates);
  const selectedAnchorIds = useRagDebugStore((s) => s.selectedAnchorIds);
  const explicitSelectionIds = useRagDebugStore((s) => s.explicitSelectionIds);
  const spatialExpansionEnabled = useRagDebugStore((s) => s.spatialExpansionEnabled);
  const radius = useRagDebugStore((s) => s.radius);
  const semanticExpansionEnabled = useRagDebugStore((s) => s.semanticExpansionEnabled);
  const semanticExpansionDepth = useRagDebugStore((s) => s.semanticExpansionDepth);
  const semanticMaxNeighbours = useRagDebugStore((s) => s.semanticMaxNeighbours);
  const semanticExpandResponse = useRagDebugStore((s) => s.semanticExpandResponse);
  const semanticIncludedIds = useRagDebugStore((s) => s.semanticIncludedIds);
  const camera = useCanvasStore((s) => s.document.camera);
  const elements = useCanvasStore((s) => s.document.elements);

  const { context } = useMemo(() => {
    if (!open) {
      return {
        context: {
          explicitlySelectedElements: [] as ReturnType<
            typeof computeDebugContext
          >['context']['explicitlySelectedElements'],
          semanticAnchors: [] as ReturnType<
            typeof computeDebugContext
          >['context']['semanticAnchors'],
          spatialElements: [] as ReturnType<
            typeof computeDebugContext
          >['context']['spatialElements'],
          semanticNeighborElements: [] as ReturnType<
            typeof computeDebugContext
          >['context']['semanticNeighborElements'],
        },
      };
    }
    return computeDebugContext(
      {
        prompt,
        candidates,
        selectedAnchorIds,
        explicitSelectionIds,
        spatialExpansionEnabled,
        radius,
        semanticExpansionEnabled,
        semanticExpansionDepth,
        semanticMaxNeighbours,
        semanticExpandResponse,
        semanticIncludedIds,
      },
      elements,
    );
  }, [
    open,
    prompt,
    candidates,
    selectedAnchorIds,
    explicitSelectionIds,
    spatialExpansionEnabled,
    radius,
    semanticExpansionEnabled,
    semanticExpansionDepth,
    semanticMaxNeighbours,
    semanticExpandResponse,
    semanticIncludedIds,
    elements,
  ]);

  if (!open) return null;

  const strokeScale = 1 / camera.zoom;
  const explicitIds = new Set(
    context.explicitlySelectedElements.map((e) => e.element_id),
  );
  const semanticIds = new Set(context.semanticAnchors.map((e) => e.element_id));

  return (
    <>
      {spatialExpansionEnabled &&
        radius > 0 &&
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

      {context.semanticNeighborElements.map((el) => {
        if (semanticIds.has(el.element_id) || explicitIds.has(el.element_id)) {
          return null;
        }
        return (
          <Rect
            key={`rag-sem-exp-${el.element_id}`}
            x={el.geometry.x - 3}
            y={el.geometry.y - 3}
            width={el.geometry.width + 6}
            height={el.geometry.height + 6}
            fill="rgba(124, 58, 237, 0.08)"
            stroke="rgba(124, 58, 237, 0.75)"
            strokeWidth={1.5 * strokeScale}
            listening={false}
          />
        );
      })}

      {context.spatialElements.map((el) => {
        if (semanticIds.has(el.element_id) || explicitIds.has(el.element_id)) {
          return null;
        }
        const alsoNeighbor = el.sources.some((s) => s.type === 'semantic_neighbor');
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
            dash={alsoNeighbor ? [4 * strokeScale, 3 * strokeScale] : undefined}
            listening={false}
          />
        );
      })}

      {context.semanticAnchors.map((el) => {
        if (explicitIds.has(el.element_id)) return null;
        return (
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
        );
      })}

      {/* Explicit selection — red; highest visual precedence among RAG overlays. */}
      {context.explicitlySelectedElements.map((el) => (
        <Rect
          key={`rag-explicit-${el.element_id}`}
          x={el.geometry.x - 5}
          y={el.geometry.y - 5}
          width={el.geometry.width + 10}
          height={el.geometry.height + 10}
          fill="rgba(220, 38, 38, 0.08)"
          stroke="rgba(185, 28, 28, 0.95)"
          strokeWidth={2.5 * strokeScale}
          listening={false}
        />
      ))}
    </>
  );
}
