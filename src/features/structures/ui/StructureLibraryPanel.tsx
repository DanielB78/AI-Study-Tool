import { useState } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import { createConceptSummaryStructure } from '../factory';
import { useStructureStore } from '../structureStore';
import { StructureEditor } from './StructureEditor';
import { StructurePreview } from './StructurePreview';
import { saveStructureLibrary } from '../storage';

export function StructureLibraryPanel() {
  const uiMode = useStructureStore((s) => s.uiMode);
  const structures = useStructureStore((s) => s.structures);
  const draft = useStructureStore((s) => s.draft);
  const openLibrary = useStructureStore((s) => s.openLibrary);
  const close = useStructureStore((s) => s.close);
  const startNew = useStructureStore((s) => s.startNew);
  const editStructure = useStructureStore((s) => s.editStructure);
  const openPreview = useStructureStore((s) => s.openPreview);
  const deleteStructure = useStructureStore((s) => s.deleteStructure);
  const renameStructure = useStructureStore((s) => s.renameStructure);
  const duplicateStructure = useStructureStore((s) => s.duplicateStructure);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  if (uiMode === 'closed') {
    return (
      <button
        type="button"
        className="structure-library-toggle"
        onClick={() => openLibrary()}
        title="Note structures"
        aria-label="Note structures"
      >
        <LayoutTemplate size={16} strokeWidth={2.1} aria-hidden />
        <span>Structures</span>
      </button>
    );
  }

  return (
    <aside
      className="structure-library-panel"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="structure-library-header">
        <div>
          <strong>Note Structures</strong>
          <span className="structure-library-sub">
            Reusable layouts for AI-filled notes
          </span>
        </div>
        <button
          type="button"
          className="structure-icon-btn"
          onClick={close}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      {uiMode === 'library' && (
        <div className="structure-library-body">
          <div className="structure-library-actions">
            <button
              type="button"
              className="structure-btn primary"
              onClick={() => {
                const name = window.prompt('Structure name', 'Untitled structure');
                if (name == null) return;
                startNew(name.trim() || 'Untitled structure');
              }}
            >
              + New Structure
            </button>
            {structures.length === 0 && (
              <button
                type="button"
                className="structure-btn ghost"
                onClick={() => {
                  const seed = createConceptSummaryStructure();
                  const next = [seed, ...useStructureStore.getState().structures];
                  saveStructureLibrary({ version: 1, structures: next });
                  useStructureStore.setState({ structures: next });
                }}
              >
                Add Concept Summary example
              </button>
            )}
          </div>

          {structures.length === 0 ? (
            <p className="structure-library-empty">
              No saved structures yet. Create one, or add the Concept Summary example.
            </p>
          ) : (
            <ul className="structure-library-list">
              {structures.map((s) => (
                <li key={s.id} className="structure-library-item">
                  {renamingId === s.id ? (
                    <form
                      className="structure-rename-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        renameStructure(s.id, renameValue);
                        setRenamingId(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        aria-label="Rename structure"
                      />
                      <button type="submit" className="structure-btn primary">
                        OK
                      </button>
                      <button
                        type="button"
                        className="structure-btn ghost"
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="structure-library-item-main">
                        <strong>{s.name}</strong>
                        <span className="structure-library-meta">
                          {s.fields.length} field{s.fields.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="structure-library-item-actions">
                        <button
                          type="button"
                          className="structure-btn ghost"
                          onClick={() => editStructure(s.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="structure-btn ghost"
                          onClick={() => openPreview(s.id)}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          className="structure-btn ghost"
                          onClick={() => {
                            setRenamingId(s.id);
                            setRenameValue(s.name);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="structure-btn ghost"
                          onClick={() => duplicateStructure(s.id)}
                        >
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="structure-btn danger"
                          onClick={() => {
                            if (window.confirm(`Delete “${s.name}”? Existing notes stay on the board.`)) {
                              deleteStructure(s.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {uiMode === 'editor' && <StructureEditor />}

      {uiMode === 'preview' && draft && (
        <div className="structure-preview-body">
          <StructurePreview structure={draft} maxWidth={480} />
          <div className="structure-preview-actions">
            <button
              type="button"
              className="structure-btn"
              onClick={() => editStructure(draft.id)}
            >
              Edit
            </button>
            <button
              type="button"
              className="structure-btn ghost"
              onClick={() => openLibrary()}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
