import type { NoteStructureField, StructureFieldContentType } from '../types';

interface StructureFieldInspectorProps {
  field: NoteStructureField | null;
  onChange: (patch: Partial<NoteStructureField>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function StructureFieldInspector({
  field,
  onChange,
  onDuplicate,
  onDelete,
}: StructureFieldInspectorProps) {
  if (!field) {
    return (
      <aside className="structure-inspector">
        <p className="structure-inspector-empty">Select a field to edit its label and AI instruction.</p>
      </aside>
    );
  }

  return (
    <aside className="structure-inspector">
      <div className="structure-inspector-title">Field</div>

      <label className="structure-field-label">
        Label
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>

      <label className="structure-field-label">
        AI instruction
        <textarea
          rows={4}
          value={field.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder="What should the AI put here?"
        />
      </label>

      <label className="structure-field-label">
        Type
        <select
          value={field.contentType}
          onChange={(e) =>
            onChange({ contentType: e.target.value as StructureFieldContentType })
          }
        >
          <option value="text">TEXT</option>
          <option value="equation">EQUATION</option>
        </select>
      </label>

      <label className="structure-field-check">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>

      <label className="structure-field-label">
        Text colour
        <input
          type="color"
          value={field.style.color}
          onChange={(e) =>
            onChange({ style: { ...field.style, color: e.target.value } })
          }
        />
      </label>

      <label className="structure-field-label">
        Background
        <input
          type="color"
          value={field.style.backgroundColor ?? '#ffffff'}
          onChange={(e) =>
            onChange({
              style: { ...field.style, backgroundColor: e.target.value },
            })
          }
        />
      </label>

      <label className="structure-field-label">
        Font size
        <input
          type="number"
          min={10}
          max={48}
          value={field.style.fontSize}
          onChange={(e) =>
            onChange({
              style: {
                ...field.style,
                fontSize: Number(e.target.value) || 16,
              },
            })
          }
        />
      </label>

      <div className="structure-inspector-style-row">
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={field.style.fontWeight === 'bold'}
            onChange={(e) =>
              onChange({
                style: {
                  ...field.style,
                  fontWeight: e.target.checked ? 'bold' : 'normal',
                },
              })
            }
          />
          Bold
        </label>
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={field.style.fontItalic}
            onChange={(e) =>
              onChange({
                style: { ...field.style, fontItalic: e.target.checked },
              })
            }
          />
          Italic
        </label>
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={field.style.underline}
            onChange={(e) =>
              onChange({
                style: { ...field.style, underline: e.target.checked },
              })
            }
          />
          Underline
        </label>
      </div>

      <div className="structure-inspector-actions">
        <button type="button" className="structure-btn ghost" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="structure-btn danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </aside>
  );
}
