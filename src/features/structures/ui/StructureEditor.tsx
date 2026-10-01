import { StructureFieldBox } from './StructureFieldBox';
import { StructureFieldInspector } from './StructureFieldInspector';
import { useStructureStore } from '../structureStore';

const EDITOR_SCALE = 0.85;

export function StructureEditor() {
  const draft = useStructureStore((s) => s.draft);
  const selectedFieldId = useStructureStore((s) => s.selectedFieldId);
  const setDraftName = useStructureStore((s) => s.setDraftName);
  const setDraftDescription = useStructureStore((s) => s.setDraftDescription);
  const addComponent = useStructureStore((s) => s.addComponent);
  const updateField = useStructureStore((s) => s.updateField);
  const deleteField = useStructureStore((s) => s.deleteField);
  const duplicateField = useStructureStore((s) => s.duplicateField);
  const selectField = useStructureStore((s) => s.selectField);
  const setFieldGeometry = useStructureStore((s) => s.setFieldGeometry);
  const saveDraft = useStructureStore((s) => s.saveDraft);
  const discardDraft = useStructureStore((s) => s.discardDraft);

  if (!draft) return null;

  const selected = draft.fields.find((f) => f.id === selectedFieldId) ?? null;

  return (
    <div className="structure-editor">
      <header className="structure-editor-header">
        <div className="structure-editor-header-fields">
          <label className="structure-field-label inline">
            Name
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraftName(e.target.value)}
              aria-label="Structure name"
            />
          </label>
          <label className="structure-field-label inline">
            Description
            <input
              type="text"
              value={draft.description ?? ''}
              onChange={(e) => setDraftDescription(e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>
        <div className="structure-editor-header-actions">
          <div className="structure-add-menu" role="group" aria-label="Add component">
            <button
              type="button"
              className="structure-btn"
              onClick={() => addComponent('text')}
            >
              + Text
            </button>
            <button
              type="button"
              className="structure-btn"
              onClick={() => addComponent('equation')}
            >
              + Equation
            </button>
            <button
              type="button"
              className="structure-btn"
              onClick={() => addComponent('node_section')}
            >
              + Node Section
            </button>
          </div>
          <button
            type="button"
            className="structure-btn primary"
            onClick={() => {
              if (!saveDraft()) {
                window.alert('Name the structure and add at least one field.');
              }
            }}
          >
            Save
          </button>
          <button type="button" className="structure-btn ghost" onClick={discardDraft}>
            Cancel
          </button>
        </div>
      </header>

      <div className="structure-editor-body">
        <div
          className="structure-editor-canvas-wrap"
          onPointerDown={() => selectField(null)}
        >
          <div
            className="structure-editor-canvas"
            style={{
              width: draft.width * EDITOR_SCALE,
              height: draft.height * EDITOR_SCALE,
            }}
          >
            {draft.fields.map((field) => (
              <StructureFieldBox
                key={field.id}
                field={field}
                selected={field.id === selectedFieldId}
                scale={EDITOR_SCALE}
                onSelect={() => selectField(field.id)}
                onGeometryChange={(geom) => setFieldGeometry(field.id, geom)}
              />
            ))}
          </div>
          <p className="structure-editor-hint">
            Drag fields to move · drag corner to resize · placeholders show label + AI
            instruction
          </p>
        </div>

        <StructureFieldInspector
          field={selected}
          onChange={(patch) => {
            if (!selected) return;
            updateField(selected.id, patch);
          }}
          onDuplicate={() => {
            if (selected) duplicateField(selected.id);
          }}
          onDelete={() => {
            if (selected) deleteField(selected.id);
          }}
        />
      </div>
    </div>
  );
}
