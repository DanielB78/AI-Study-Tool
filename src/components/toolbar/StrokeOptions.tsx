import type { StyleDefaults } from '../../types/canvas';

interface Props {
  style: StyleDefaults;
  onChange: (partial: Partial<StyleDefaults>) => void;
}

export function StrokeOptions({ style, onChange }: Props) {
  return (
    <>
      <label className="ctx-field" title="Stroke colour">
        <span className="ctx-field-label">Colour</span>
        <input
          type="color"
          value={style.strokeColor}
          onChange={(e) => onChange({ strokeColor: e.target.value })}
        />
      </label>
      <label className="ctx-field" title="Stroke width">
        <span className="ctx-field-label">Width</span>
        <input
          type="range"
          min={1}
          max={24}
          value={style.strokeWidth}
          onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
        />
        <span className="ctx-range-value">{style.strokeWidth}</span>
      </label>
    </>
  );
}
