import type { NoteStructure } from '../types';
import { isNodeSection, isStructureField } from '../types';
import { StructureFieldBox } from './StructureFieldBox';
import { StructureNodeSectionBox } from './StructureNodeSectionBox';

interface StructurePreviewProps {
  structure: NoteStructure;
  maxWidth?: number;
}

/** Read-only layout preview — no LLM; real structure components (not images). */
export function StructurePreview({ structure, maxWidth = 420 }: StructurePreviewProps) {
  const scale = Math.min(1, maxWidth / structure.width);
  return (
    <div className="structure-preview">
      <div className="structure-preview-title">{structure.name}</div>
      <div
        className="structure-editor-canvas is-preview"
        style={{
          width: structure.width * scale,
          height: structure.height * scale,
        }}
      >
        {structure.fields.map((field) => {
          if (isNodeSection(field)) {
            return (
              <StructureNodeSectionBox
                key={field.id}
                section={field}
                scale={scale}
                selected={false}
                selectedTemplatePart={null}
                readOnly
                onSelectSection={() => undefined}
                onSelectTemplate={() => undefined}
                onSectionGeometryChange={() => undefined}
                onTemplateGeometryChange={() => undefined}
              />
            );
          }
          if (!isStructureField(field)) return null;
          return (
            <StructureFieldBox
              key={field.id}
              field={field}
              selected={false}
              scale={scale}
              readOnly
              onSelect={() => undefined}
              onGeometryChange={() => undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
