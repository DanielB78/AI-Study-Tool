import type {
  NoteStructureField,
  NoteStructureNodeSection,
  StructureComponent,
  StructureFieldContentType,
  NodeChildrenPlacement,
} from '../types';
import {
  NODE_SECTION_MAX_DEPTH_LIMIT,
  NODE_SECTION_MAX_TOTAL_NODES_LIMIT,
  isNodeSection,
} from '../types';
import type { SelectedNodeTemplatePart } from '../structureStore';

interface StructureFieldInspectorProps {
  field: StructureComponent | null;
  selectedNodeTemplatePart?: SelectedNodeTemplatePart;
  onChange: (patch: Partial<StructureComponent>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function StyleControls({
  title,
  style,
  onChange,
}: {
  title: string;
  style: NoteStructureField['style'];
  onChange: (style: NoteStructureField['style']) => void;
}) {
  return (
    <div className="structure-inspector-group">
      <div className="structure-inspector-subtitle">{title}</div>
      <label className="structure-field-label">
        Text colour
        <input
          type="color"
          value={style.color}
          onChange={(e) => onChange({ ...style, color: e.target.value })}
        />
      </label>
      <label className="structure-field-label">
        Background
        <input
          type="color"
          value={style.backgroundColor ?? '#ffffff'}
          onChange={(e) =>
            onChange({ ...style, backgroundColor: e.target.value })
          }
        />
      </label>
      <label className="structure-field-label">
        Font size
        <input
          type="number"
          min={10}
          max={48}
          value={style.fontSize}
          onChange={(e) =>
            onChange({ ...style, fontSize: Number(e.target.value) || 16 })
          }
        />
      </label>
      <div className="structure-inspector-style-row">
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={style.fontWeight === 'bold'}
            onChange={(e) =>
              onChange({
                ...style,
                fontWeight: e.target.checked ? 'bold' : 'normal',
              })
            }
          />
          Bold
        </label>
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={style.fontItalic}
            onChange={(e) => onChange({ ...style, fontItalic: e.target.checked })}
          />
          Italic
        </label>
        <label className="structure-field-check">
          <input
            type="checkbox"
            checked={style.underline}
            onChange={(e) => onChange({ ...style, underline: e.target.checked })}
          />
          Underline
        </label>
      </div>
    </div>
  );
}

function NodeSectionInspector({
  section,
  selectedPart,
  onChange,
  onDuplicate,
  onDelete,
}: {
  section: NoteStructureNodeSection;
  selectedPart: SelectedNodeTemplatePart;
  onChange: (patch: Partial<NoteStructureNodeSection>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="structure-inspector structure-inspector--node">
      <div className="structure-inspector-title">Node Section</div>
      {selectedPart && (
        <p className="structure-inspector-empty">
          Editing {selectedPart === 'root' ? 'root' : 'child'} template — drag/resize on
          canvas like a textbox.
        </p>
      )}

      <label className="structure-field-label">
        Name
        <input
          type="text"
          value={section.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>

      <label className="structure-field-label">
        Section instruction
        <textarea
          rows={3}
          value={section.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
          placeholder="Organise the subject into major concepts…"
        />
      </label>

      <div className="structure-inspector-group">
        <div className="structure-inspector-subtitle">Children Placement</div>
        <div className="structure-placement-seg" role="group" aria-label="Children placement">
          {(['below', 'sideways', 'around'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`structure-btn ghost${
                section.childrenPlacement === mode ? ' is-active' : ''
              }`}
              onClick={() =>
                onChange({ childrenPlacement: mode as NodeChildrenPlacement })
              }
            >
              {mode === 'below' ? 'Below' : mode === 'sideways' ? 'Sideways' : 'Around'}
            </button>
          ))}
        </div>
      </div>

      <label className="structure-field-check">
        <input
          type="checkbox"
          checked={section.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>

      <div className="structure-inspector-group">
        <div className="structure-inspector-subtitle">Root node</div>
        <label className="structure-field-label">
          Instruction
          <textarea
            rows={2}
            value={section.rootTemplate.instruction}
            onChange={(e) =>
              onChange({
                rootTemplate: {
                  ...section.rootTemplate,
                  instruction: e.target.value,
                },
              })
            }
          />
        </label>
        <div className="structure-inspector-style-row">
          <label className="structure-field-label">
            Width
            <input
              type="number"
              min={40}
              value={section.rootTemplate.width}
              onChange={(e) =>
                onChange({
                  rootTemplate: {
                    ...section.rootTemplate,
                    width: Number(e.target.value) || 200,
                  },
                })
              }
            />
          </label>
          <label className="structure-field-label">
            Height
            <input
              type="number"
              min={24}
              value={section.rootTemplate.height}
              onChange={(e) =>
                onChange({
                  rootTemplate: {
                    ...section.rootTemplate,
                    height: Number(e.target.value) || 64,
                  },
                })
              }
            />
          </label>
        </div>
        <StyleControls
          title="Root style"
          style={section.rootTemplate.style}
          onChange={(style) =>
            onChange({ rootTemplate: { ...section.rootTemplate, style } })
          }
        />
      </div>

      <div className="structure-inspector-group">
        <div className="structure-inspector-subtitle">Child node template</div>
        <label className="structure-field-label">
          Instruction
          <textarea
            rows={2}
            value={section.childTemplate.instruction}
            onChange={(e) =>
              onChange({
                childTemplate: {
                  ...section.childTemplate,
                  instruction: e.target.value,
                },
              })
            }
          />
        </label>
        <div className="structure-inspector-style-row">
          <label className="structure-field-label">
            Width
            <input
              type="number"
              min={40}
              value={section.childTemplate.width}
              onChange={(e) =>
                onChange({
                  childTemplate: {
                    ...section.childTemplate,
                    width: Number(e.target.value) || 180,
                  },
                })
              }
            />
          </label>
          <label className="structure-field-label">
            Height
            <input
              type="number"
              min={24}
              value={section.childTemplate.height}
              onChange={(e) =>
                onChange({
                  childTemplate: {
                    ...section.childTemplate,
                    height: Number(e.target.value) || 72,
                  },
                })
              }
            />
          </label>
        </div>
        <StyleControls
          title="Child style"
          style={section.childTemplate.style}
          onChange={(style) =>
            onChange({ childTemplate: { ...section.childTemplate, style } })
          }
        />
      </div>

      <div className="structure-inspector-group">
        <div className="structure-inspector-subtitle">Spacing & limits</div>
        <div className="structure-inspector-style-row">
          <label className="structure-field-label">
            Horizontal
            <input
              type="number"
              min={0}
              value={section.horizontalSpacing}
              onChange={(e) =>
                onChange({ horizontalSpacing: Number(e.target.value) || 0 })
              }
            />
          </label>
          <label className="structure-field-label">
            Vertical
            <input
              type="number"
              min={0}
              value={section.verticalSpacing}
              onChange={(e) =>
                onChange({ verticalSpacing: Number(e.target.value) || 0 })
              }
            />
          </label>
        </div>
        <label className="structure-field-label">
          Max depth
          <input
            type="number"
            min={1}
            max={NODE_SECTION_MAX_DEPTH_LIMIT}
            value={section.maxDepth}
            onChange={(e) =>
              onChange({
                maxDepth: Math.min(
                  NODE_SECTION_MAX_DEPTH_LIMIT,
                  Math.max(1, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </label>
        <label className="structure-field-label">
          Max total nodes
          <input
            type="number"
            min={1}
            max={NODE_SECTION_MAX_TOTAL_NODES_LIMIT}
            value={section.maxTotalNodes}
            onChange={(e) =>
              onChange({
                maxTotalNodes: Math.min(
                  NODE_SECTION_MAX_TOTAL_NODES_LIMIT,
                  Math.max(1, Number(e.target.value) || 1),
                ),
              })
            }
          />
        </label>
        <label className="structure-field-label">
          Max children per node (optional)
          <input
            type="number"
            min={0}
            placeholder="Unlimited"
            value={section.maxChildrenPerNode ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                maxChildrenPerNode: v === '' ? undefined : Math.max(1, Number(v) || 1),
              });
            }}
          />
        </label>
      </div>

      <div className="structure-inspector-group">
        <div className="structure-inspector-subtitle">Connector</div>
        <label className="structure-field-label">
          Type
          <select
            value={section.connectorConfig.connectorType}
            onChange={(e) =>
              onChange({
                connectorConfig: {
                  ...section.connectorConfig,
                  connectorType: e.target.value as 'line' | 'arrow',
                  arrowHeads: e.target.value === 'arrow' ? 'end' : 'none',
                },
              })
            }
          >
            <option value="arrow">Arrow</option>
            <option value="line">Line</option>
          </select>
        </label>
        <label className="structure-field-label">
          Style
          <select
            value={section.connectorConfig.strokeStyle}
            onChange={(e) =>
              onChange({
                connectorConfig: {
                  ...section.connectorConfig,
                  strokeStyle: e.target.value as 'solid' | 'dashed' | 'dotted',
                },
              })
            }
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
        <label className="structure-field-label">
          Width
          <input
            type="number"
            min={1}
            max={12}
            value={section.connectorConfig.strokeWidth}
            onChange={(e) =>
              onChange({
                connectorConfig: {
                  ...section.connectorConfig,
                  strokeWidth: Number(e.target.value) || 2,
                },
              })
            }
          />
        </label>
        <label className="structure-field-label">
          Colour
          <input
            type="color"
            value={section.connectorConfig.color}
            onChange={(e) =>
              onChange({
                connectorConfig: {
                  ...section.connectorConfig,
                  color: e.target.value,
                },
              })
            }
          />
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

export function StructureFieldInspector({
  field,
  selectedNodeTemplatePart = null,
  onChange,
  onDuplicate,
  onDelete,
}: StructureFieldInspectorProps) {
  if (!field) {
    return (
      <aside className="structure-inspector">
        <p className="structure-inspector-empty">
          Select a component to edit. Add Text, Equation, or Node Section.
        </p>
      </aside>
    );
  }

  if (isNodeSection(field)) {
    return (
      <NodeSectionInspector
        section={field}
        selectedPart={selectedNodeTemplatePart}
        onChange={onChange}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
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

      <StyleControls
        title="Style"
        style={field.style}
        onChange={(style) => onChange({ style })}
      />

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
