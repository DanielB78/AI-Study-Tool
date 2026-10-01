import type { NodeSectionConnectorConfig } from '../types';

interface StructureConnectorPreviewProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  scale: number;
  config: NodeSectionConnectorConfig;
}

/**
 * Design-time connector preview using the same stroke/arrow semantics as ConnectorElement.
 * Not an image — SVG line/arrow matching canvas connector style.
 */
export function StructureConnectorPreview({
  x1,
  y1,
  x2,
  y2,
  scale,
  config,
}: StructureConnectorPreviewProps) {
  const sx1 = x1 * scale;
  const sy1 = y1 * scale;
  const sx2 = x2 * scale;
  const sy2 = y2 * scale;
  const minX = Math.min(sx1, sx2) - 8;
  const minY = Math.min(sy1, sy2) - 8;
  const width = Math.max(1, Math.abs(sx2 - sx1) + 16);
  const height = Math.max(1, Math.abs(sy2 - sy1) + 16);
  const dash =
    config.strokeStyle === 'dashed'
      ? '6 4'
      : config.strokeStyle === 'dotted'
        ? '2 3'
        : undefined;

  const markerId = `struct-conn-arrow-${Math.round(sx1)}-${Math.round(sy1)}-${Math.round(sx2)}-${Math.round(sy2)}`;

  return (
    <svg
      className="structure-connector-preview"
      style={{
        left: minX,
        top: minY,
        width,
        height,
      }}
      width={width}
      height={height}
      aria-hidden
    >
      <defs>
        {config.connectorType === 'arrow' && (
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill={config.color} />
          </marker>
        )}
      </defs>
      <line
        x1={sx1 - minX}
        y1={sy1 - minY}
        x2={sx2 - minX}
        y2={sy2 - minY}
        stroke={config.color}
        strokeWidth={config.strokeWidth}
        strokeDasharray={dash}
        markerEnd={
          config.connectorType === 'arrow' ? `url(#${markerId})` : undefined
        }
      />
    </svg>
  );
}
