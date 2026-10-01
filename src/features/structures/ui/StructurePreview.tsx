import type { NoteStructure } from '../types';
import { StructureFieldBox } from './StructureFieldBox';

interface StructurePreviewProps {
  structure: NoteStructure;
  maxWidth?: number;
}

/** Read-only layout preview — no LLM call; shows placeholder field content. */
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
        {structure.fields.map((field) => (
          <StructureFieldBox
            key={field.id}
            field={field}
            selected={false}
            scale={scale}
            readOnly
            onSelect={() => undefined}
            onGeometryChange={() => undefined}
          />
        ))}
      </div>
    </div>
  );
}
