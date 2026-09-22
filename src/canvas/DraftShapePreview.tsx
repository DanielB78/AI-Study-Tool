import { Ellipse, Line, Rect } from 'react-konva';
import type { DraftShapeKind } from '../store/canvasStore';
import type { StyleDefaults } from '../types/canvas';
import { strokeDashFor, isShapeTool } from '../types/canvas';
import { shapePointsFor } from '../utils/shapeGeometry';

interface Props {
  draft: {
    kind: DraftShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    x2?: number;
    y2?: number;
  };
  style: StyleDefaults;
}

export function DraftShapePreview({ draft, style }: Props) {
  const fill = style.fillColor ?? 'rgba(0,0,0,0)';
  const stroke = style.strokeColor ?? '#1a1a1a';
  const dash = strokeDashFor(style.strokeStyle, style.strokeWidth);

  if (draft.kind === 'line' || draft.kind === 'arrow') {
    const points = [
      draft.x,
      draft.y,
      draft.x2 ?? draft.x,
      draft.y2 ?? draft.y,
    ];
    return (
      <Line
        points={points}
        stroke={stroke}
        strokeWidth={style.strokeWidth}
        dash={dash}
        listening={false}
      />
    );
  }

  if (draft.kind === 'ellipse') {
    return (
      <Ellipse
        x={draft.x + draft.width / 2}
        y={draft.y + draft.height / 2}
        radiusX={Math.max(draft.width / 2, 0.5)}
        radiusY={Math.max(draft.height / 2, 0.5)}
        fill={fill}
        stroke={stroke}
        strokeWidth={style.strokeWidth}
        dash={dash}
        opacity={0.85}
        listening={false}
      />
    );
  }

  if (draft.kind === 'rectangle' || draft.kind === 'roundedRect') {
    return (
      <Rect
        x={draft.x}
        y={draft.y}
        width={draft.width}
        height={draft.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={style.strokeWidth}
        dash={dash}
        cornerRadius={draft.kind === 'roundedRect' ? style.cornerRadius : 0}
        opacity={0.85}
        listening={false}
      />
    );
  }

  if (isShapeTool(draft.kind)) {
    const points = shapePointsFor(draft.kind, draft.width, draft.height);
    if (!points) return null;
    return (
      <Line
        x={draft.x}
        y={draft.y}
        points={points}
        closed
        fill={fill}
        stroke={stroke}
        strokeWidth={style.strokeWidth}
        dash={dash}
        opacity={0.85}
        listening={false}
      />
    );
  }

  return null;
}
