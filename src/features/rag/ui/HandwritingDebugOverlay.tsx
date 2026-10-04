/**
 * Transient Konva overlay for handwriting line/region debug rectangles.
 * Not part of CanvasDocument — visualization only.
 */

import { useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import { useCanvasStore } from '../../../store/canvasStore';
import {
  syncHandwritingDetectionOnCanvasChange,
  useHandwritingDebugStore,
} from '../handwritingDebugStore';

export function HandwritingDebugOverlay() {
  const showRegions = useHandwritingDebugStore((s) => s.showRegions);
  const showLines = useHandwritingDebugStore((s) => s.showLines);
  const result = useHandwritingDebugStore((s) => s.result);
  const selectedRegionId = useHandwritingDebugStore((s) => s.selectedRegionId);
  const selectedLineId = useHandwritingDebugStore((s) => s.selectedLineId);
  const selectRegion = useHandwritingDebugStore((s) => s.selectRegion);
  const selectLine = useHandwritingDebugStore((s) => s.selectLine);
  const ensureDetection = useHandwritingDebugStore((s) => s.ensureDetection);
  const camera = useCanvasStore((s) => s.document.camera);
  const elements = useCanvasStore((s) => s.document.elements);

  useEffect(() => syncHandwritingDetectionOnCanvasChange(), []);

  useEffect(() => {
    if (showRegions || showLines) {
      ensureDetection();
    }
  }, [showRegions, showLines, elements, ensureDetection]);

  if (!showRegions && !showLines) return null;

  const strokeScale = 1 / camera.zoom;
  const fontSize = Math.max(10, 12 * strokeScale);

  return (
    <Group listening>
      {showLines &&
        result.lines.map((line) => {
          const selected = selectedLineId === line.id;
          const b = line.bounds;
          return (
            <Group key={`hw-line-${line.id}`}>
              <Rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                fill={selected ? 'rgba(14, 165, 233, 0.12)' : 'rgba(14, 165, 233, 0.05)'}
                stroke={selected ? 'rgba(2, 132, 199, 0.95)' : 'rgba(14, 165, 233, 0.55)'}
                strokeWidth={(selected ? 1.5 : 1) * strokeScale}
                dash={[4 * strokeScale, 3 * strokeScale]}
                listening
                onClick={(e) => {
                  e.cancelBubble = true;
                  selectLine(line.id);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  selectLine(line.id);
                }}
              />
              <Text
                x={b.x + 2 * strokeScale}
                y={b.y - fontSize - 2 * strokeScale}
                text={`${line.id} · ${line.strokeIds.length}s`}
                fontSize={fontSize}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="rgba(3, 105, 161, 0.9)"
                listening={false}
              />
            </Group>
          );
        })}

      {showRegions &&
        result.regions.map((region) => {
          const selected = selectedRegionId === region.id;
          const b = region.bounds;
          return (
            <Group key={`hw-region-${region.id}`}>
              <Rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                fill={
                  selected ? 'rgba(234, 88, 12, 0.14)' : 'rgba(234, 88, 12, 0.06)'
                }
                stroke={
                  selected ? 'rgba(194, 65, 12, 0.95)' : 'rgba(234, 88, 12, 0.75)'
                }
                strokeWidth={(selected ? 2.5 : 2) * strokeScale}
                listening
                onClick={(e) => {
                  e.cancelBubble = true;
                  selectRegion(region.id);
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  selectRegion(region.id);
                }}
              />
              <Text
                x={b.x + 4 * strokeScale}
                y={b.y + 4 * strokeScale}
                text={`${region.id}\n${region.lineCount} lines · ${region.strokeCount} strokes`}
                fontSize={fontSize}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fill="rgba(154, 52, 18, 0.95)"
                listening={false}
                lineHeight={1.25}
              />
            </Group>
          );
        })}
    </Group>
  );
}
