import type { StyleDefaults, StrokeStyle, ArrowHeads } from '../../types/canvas';
import { ColorSwatchButton } from './ColorPickerPopover';
import { CtxPopover, OpacityControl } from './CtxPopover';

const FONTS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
  { value: '"Times New Roman", Times, serif', label: 'Times' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
];

interface SharedProps {
  style: StyleDefaults;
  onLive: (partial: Partial<StyleDefaults>) => void;
  onCommit: (partial: Partial<StyleDefaults>) => void;
}

export function TextFormattingControls({
  style,
  onLive,
  onCommit,
  showEdit,
  onEdit,
}: SharedProps & { showEdit?: boolean; onEdit?: () => void }) {
  return (
    <>
      <select
        className="ctx-select"
        title="Font"
        value={style.fontFamily}
        onChange={(e) => onCommit({ fontFamily: e.target.value })}
      >
        {FONTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        className="ctx-number"
        title="Size"
        min={10}
        max={96}
        value={style.fontSize}
        onChange={(e) => onCommit({ fontSize: Number(e.target.value) || 18 })}
      />
      <button
        type="button"
        className={style.fontWeight === 'bold' ? 'ctx-chip active' : 'ctx-chip'}
        title="Bold"
        onClick={() =>
          onCommit({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })
        }
      >
        B
      </button>
      <button
        type="button"
        className={style.fontItalic ? 'ctx-chip active' : 'ctx-chip'}
        title="Italic"
        onClick={() => onCommit({ fontItalic: !style.fontItalic })}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={style.underline ? 'ctx-chip active' : 'ctx-chip'}
        title="Underline"
        onClick={() => onCommit({ underline: !style.underline })}
      >
        <span style={{ textDecoration: 'underline' }}>U</span>
      </button>
      <button
        type="button"
        className={style.strikethrough ? 'ctx-chip active' : 'ctx-chip'}
        title="Strikethrough"
        onClick={() => onCommit({ strikethrough: !style.strikethrough })}
      >
        <span style={{ textDecoration: 'line-through' }}>S</span>
      </button>
      <select
        className="ctx-select"
        title="Alignment"
        value={style.textAlignment}
        onChange={(e) =>
          onCommit({
            textAlignment: e.target.value as StyleDefaults['textAlignment'],
          })
        }
      >
        <option value="left">Left</option>
        <option value="center">Centre</option>
        <option value="right">Right</option>
      </select>
      <ColorSwatchButton
        label="Text"
        value={style.textColor}
        allowTransparent={false}
        onChange={(c) => c && onCommit({ textColor: c })}
      />
      <ColorSwatchButton
        label="Fill"
        value={style.textBackgroundColor}
        allowTransparent
        onChange={(c) => onCommit({ textBackgroundColor: c })}
      />
      <CtxPopover label="More">
        <label className="popover-row">
          <span>Line height</span>
          <input
            type="range"
            min={100}
            max={250}
            value={Math.round(style.lineHeight * 100)}
            onChange={(e) => onLive({ lineHeight: Number(e.target.value) / 100 })}
            onPointerUp={(e) =>
              onCommit({
                lineHeight: Number((e.target as HTMLInputElement).value) / 100,
              })
            }
          />
        </label>
        <label className="popover-row">
          <span>Padding</span>
          <input
            type="range"
            min={0}
            max={32}
            value={style.textPadding}
            onChange={(e) => onLive({ textPadding: Number(e.target.value) })}
            onPointerUp={(e) =>
              onCommit({
                textPadding: Number((e.target as HTMLInputElement).value),
              })
            }
          />
        </label>
        <label className="popover-row">
          <span>Corners</span>
          <input
            type="range"
            min={0}
            max={32}
            value={style.textCornerRadius}
            onChange={(e) => onLive({ textCornerRadius: Number(e.target.value) })}
            onPointerUp={(e) =>
              onCommit({
                textCornerRadius: Number((e.target as HTMLInputElement).value),
              })
            }
          />
        </label>
      </CtxPopover>
      <OpacityControl
        value={style.opacity}
        onChange={(v) => onLive({ opacity: v })}
        onCommit={(v) => onCommit({ opacity: v })}
      />
      {showEdit && onEdit && (
        <button type="button" className="ctx-chip" title="Edit text" onClick={onEdit}>
          Edit
        </button>
      )}
    </>
  );
}

export function ShapeFormattingControls({
  style,
  onLive,
  onCommit,
  showCornerRadius,
}: SharedProps & { showCornerRadius?: boolean }) {
  return (
    <>
      <ColorSwatchButton
        label="Fill"
        value={style.fillColor}
        allowTransparent
        onChange={(c) => onCommit({ fillColor: c })}
      />
      <ColorSwatchButton
        label="Stroke"
        value={style.strokeColor}
        allowTransparent
        onChange={(c) => onCommit({ strokeColor: c })}
      />
      <label className="ctx-field" title="Stroke width">
        <span className="ctx-field-label">Width</span>
        <input
          type="range"
          min={0}
          max={24}
          value={style.strokeWidth}
          onChange={(e) => onLive({ strokeWidth: Number(e.target.value) })}
          onPointerUp={(e) =>
            onCommit({
              strokeWidth: Number((e.target as HTMLInputElement).value),
            })
          }
        />
      </label>
      <StrokeStyleSelect
        value={style.strokeStyle}
        onChange={(strokeStyle) => onCommit({ strokeStyle })}
      />
      {showCornerRadius && (
        <label className="ctx-field" title="Corner radius">
          <span className="ctx-field-label">Radius</span>
          <input
            type="range"
            min={0}
            max={48}
            value={style.cornerRadius}
            onChange={(e) => onLive({ cornerRadius: Number(e.target.value) })}
            onPointerUp={(e) =>
              onCommit({
                cornerRadius: Number((e.target as HTMLInputElement).value),
              })
            }
          />
        </label>
      )}
      <OpacityControl
        value={style.opacity}
        onChange={(v) => onLive({ opacity: v })}
        onCommit={(v) => onCommit({ opacity: v })}
      />
    </>
  );
}

export function StrokeFormattingControls({
  style,
  onLive,
  onCommit,
  showArrowHeads,
}: SharedProps & { showArrowHeads?: boolean }) {
  return (
    <>
      <ColorSwatchButton
        label="Colour"
        value={style.strokeColor}
        allowTransparent={false}
        onChange={(c) => c && onCommit({ strokeColor: c })}
      />
      <label className="ctx-field" title="Stroke width">
        <span className="ctx-field-label">Width</span>
        <input
          type="range"
          min={1}
          max={24}
          value={style.strokeWidth}
          onChange={(e) => onLive({ strokeWidth: Number(e.target.value) })}
          onPointerUp={(e) =>
            onCommit({
              strokeWidth: Number((e.target as HTMLInputElement).value),
            })
          }
        />
      </label>
      <StrokeStyleSelect
        value={style.strokeStyle}
        onChange={(strokeStyle) => onCommit({ strokeStyle })}
      />
      {showArrowHeads && (
        <select
          className="ctx-select"
          title="Arrow heads"
          value={style.arrowHeads}
          onChange={(e) =>
            onCommit({ arrowHeads: e.target.value as ArrowHeads })
          }
        >
          <option value="none">No heads</option>
          <option value="end">End</option>
          <option value="both">Both</option>
        </select>
      )}
      <OpacityControl
        value={style.opacity}
        onChange={(v) => onLive({ opacity: v })}
        onCommit={(v) => onCommit({ opacity: v })}
      />
    </>
  );
}

function StrokeStyleSelect({
  value,
  onChange,
}: {
  value: StrokeStyle;
  onChange: (v: StrokeStyle) => void;
}) {
  return (
    <select
      className="ctx-select"
      title="Stroke style"
      value={value}
      onChange={(e) => onChange(e.target.value as StrokeStyle)}
    >
      <option value="solid">Solid</option>
      <option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
    </select>
  );
}
