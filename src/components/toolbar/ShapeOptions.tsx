import type { StyleDefaults } from '../../types/canvas';

interface Props {
  style: StyleDefaults;
  onChange: (partial: Partial<StyleDefaults>) => void;
}

export function ShapeOptions({ style, onChange }: Props) {
  return (
    <>
      <label className="ctx-field" title="Fill colour">
        <span className="ctx-field-label">Fill</span>
        <input
          type="color"
          value={style.fillColor}
          onChange={(e) => onChange({ fillColor: e.target.value })}
        />
      </label>
      <label className="ctx-field" title="Border colour">
        <span className="ctx-field-label">Border</span>
        <input
          type="color"
          value={style.strokeColor}
          onChange={(e) => onChange({ strokeColor: e.target.value })}
        />
      </label>
      <label className="ctx-field" title="Border width">
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
