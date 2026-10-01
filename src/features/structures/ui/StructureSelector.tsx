import { useStructureStore } from '../structureStore';

interface StructureSelectorProps {
  id?: string;
  className?: string;
  disabled?: boolean;
  onInteraction?: () => void;
}

/** Compact Structure: [No Structure ▼] control for the AI prompt area. */
export function StructureSelector({
  id = 'ai-structure-select',
  className = 'structure-selector',
  disabled,
  onInteraction,
}: StructureSelectorProps) {
  const structures = useStructureStore((s) => s.structures);
  const selectedId = useStructureStore((s) => s.selectedStructureIdForAi);
  const setSelected = useStructureStore((s) => s.setSelectedStructureIdForAi);

  return (
    <label className={className} htmlFor={id}>
      <span className="structure-selector-label">Structure</span>
      <select
        id={id}
        className="structure-selector-select"
        value={selectedId ?? ''}
        disabled={disabled}
        onChange={(e) => {
          onInteraction?.();
          const v = e.target.value;
          setSelected(v === '' ? null : v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Note structure for AI prompt"
      >
        <option value="">No Structure</option>
        {structures.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
