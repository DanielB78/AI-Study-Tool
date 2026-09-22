import type { StyleDefaults, TextAlignment } from '../../types/canvas';

interface Props {
  style: StyleDefaults;
  onChange: (partial: Partial<StyleDefaults>) => void;
  showEditButton?: boolean;
  onEditText?: () => void;
}

const FONT_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: 'system-ui, sans-serif', label: 'System' },
];

export function TextOptions({
  style,
  onChange,
  showEditButton = false,
  onEditText,
}: Props) {
  return (
    <>
      <label className="ctx-field" title="Text colour">
        <span className="ctx-field-label">Colour</span>
        <input
          type="color"
          value={style.textColor}
          onChange={(e) => onChange({ textColor: e.target.value })}
        />
      </label>

      <label className="ctx-field" title="Font family">
        <span className="ctx-field-label">Font</span>
        <select
          className="ctx-select"
          value={style.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          aria-label="Font family"
        >
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {!FONT_OPTIONS.some((o) => o.value === style.fontFamily) && (
            <option value={style.fontFamily}>Custom</option>
          )}
        </select>
      </label>

      <label className="ctx-field" title="Font size">
        <span className="ctx-field-label">Size</span>
        <input
          type="number"
          min={10}
          max={96}
          className="ctx-number"
          value={style.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) || 18 })}
        />
      </label>

      <button
        type="button"
        className={style.fontBold ? 'ctx-chip active' : 'ctx-chip'}
        title="Bold"
        aria-pressed={style.fontBold}
        onClick={() => onChange({ fontBold: !style.fontBold })}
      >
        B
      </button>

      <select
        className="ctx-select"
        value={style.textAlignment}
        title="Alignment"
        aria-label="Text alignment"
        onChange={(e) =>
          onChange({ textAlignment: e.target.value as TextAlignment })
        }
      >
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>

      {showEditButton && onEditText && (
        <button type="button" className="ctx-chip" title="Edit text (Enter)" onClick={onEditText}>
          Edit
        </button>
      )}
    </>
  );
}
