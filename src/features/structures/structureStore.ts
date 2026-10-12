/**
 * Note structure library + editor UI state (transient editor state + persisted library).
 */

import { create } from 'zustand';
import {
  createEmptyStructure,
  createNodeSection,
  createStructureField,
  duplicateComponent,
  duplicateStructure as duplicateStructureModel,
} from './factory';
import { loadStructureLibrary, saveStructureLibrary } from './storage';
import type {
  NoteStructure,
  NoteStructureField,
  NoteStructureNodeSection,
  NodeTemplate,
  StructureComponent,
} from './types';
import { NOTE_STRUCTURE_VERSION } from './types';
import { now } from '../../utils/ids';

export type StructureUiMode = 'closed' | 'library' | 'editor' | 'preview';

export type AddComponentKind = 'text' | 'equation' | 'node_section';

/** Which part of a Node Section is selected in the editor. */
export type SelectedNodeTemplatePart = 'root' | 'child' | null;

export interface StructureStoreState {
  structures: NoteStructure[];
  uiMode: StructureUiMode;
  /** Structure being edited (draft; not saved until saveDraft). */
  draft: NoteStructure | null;
  selectedFieldId: string | null;
  /** When selected field is a Node Section: which template is active. */
  selectedNodeTemplatePart: SelectedNodeTemplatePart;
  /** Per-request AI selection (also snapshotted in ragDebugStore). */
  selectedStructureIdForAi: string | null;

  openLibrary: () => void;
  close: () => void;
  openPreview: (id: string) => void;
  startNew: (name?: string) => void;
  editStructure: (id: string) => void;
  saveDraft: () => boolean;
  discardDraft: () => void;
  deleteStructure: (id: string) => void;
  renameStructure: (id: string, name: string) => void;
  duplicateStructure: (id: string) => void;

  setDraftName: (name: string) => void;
  setDraftDescription: (description: string) => void;
  addComponent: (kind: AddComponentKind) => void;
  /** @deprecated use addComponent('text') */
  addField: () => void;
  updateField: (fieldId: string, patch: Partial<StructureComponent>) => void;
  updateNodeSection: (
    fieldId: string,
    patch: Partial<NoteStructureNodeSection>,
  ) => void;
  deleteField: (fieldId: string) => void;
  duplicateField: (fieldId: string) => void;
  selectField: (
    fieldId: string | null,
    nodeTemplatePart?: SelectedNodeTemplatePart,
  ) => void;
  setFieldGeometry: (
    fieldId: string,
    geom: Pick<
      StructureComponent,
      'relativeX' | 'relativeY' | 'relativeWidth' | 'relativeHeight'
    >,
  ) => void;
  setNodeTemplateGeometry: (
    fieldId: string,
    part: 'root' | 'child',
    geom: Pick<NodeTemplate, 'relativeX' | 'relativeY' | 'width' | 'height'>,
  ) => void;

  setSelectedStructureIdForAi: (id: string | null) => void;
  getStructureById: (id: string) => NoteStructure | null;
}

function persist(structures: NoteStructure[]) {
  saveStructureLibrary({ version: NOTE_STRUCTURE_VERSION, structures });
}

function touchDraft(draft: NoteStructure): NoteStructure {
  return { ...draft, updatedAt: now() };
}

export function createStructureStore() {
  const loaded = loadStructureLibrary();
  return create<StructureStoreState>((set, get) => ({
    structures: loaded.structures,
    uiMode: 'closed',
    draft: null,
    selectedFieldId: null,
    selectedNodeTemplatePart: null,
    selectedStructureIdForAi: null,

    openLibrary: () =>
      set({
        uiMode: 'library',
        draft: null,
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      }),
    close: () =>
      set({
        uiMode: 'closed',
        draft: null,
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      }),
    openPreview: (id) => {
      const s = get().structures.find((x) => x.id === id) ?? null;
      if (!s) return;
      set({
        uiMode: 'preview',
        draft: structuredClone(s),
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      });
    },

    startNew: (name) => {
      const draft = createEmptyStructure(name ?? 'Untitled structure');
      set({
        uiMode: 'editor',
        draft,
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      });
    },

    editStructure: (id) => {
      const s = get().structures.find((x) => x.id === id);
      if (!s) return;
      set({
        uiMode: 'editor',
        draft: structuredClone(s),
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      });
    },

    saveDraft: () => {
      const draft = get().draft;
      if (!draft) return false;
      if (!draft.name.trim()) return false;
      if (draft.fields.length === 0) return false;
      const saved = touchDraft({ ...draft, name: draft.name.trim() });
      const others = get().structures.filter((s) => s.id !== saved.id);
      const structures = [...others, saved].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      persist(structures);
      set({
        structures,
        uiMode: 'library',
        draft: null,
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      });
      return true;
    },

    discardDraft: () =>
      set({
        uiMode: 'library',
        draft: null,
        selectedFieldId: null,
        selectedNodeTemplatePart: null,
      }),

    deleteStructure: (id) => {
      const structures = get().structures.filter((s) => s.id !== id);
      persist(structures);
      set((s) => ({
        structures,
        selectedStructureIdForAi:
          s.selectedStructureIdForAi === id ? null : s.selectedStructureIdForAi,
      }));
    },

    renameStructure: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const structures = get().structures.map((s) =>
        s.id === id ? { ...s, name: trimmed, updatedAt: now() } : s,
      );
      persist(structures);
      set({ structures });
    },

    duplicateStructure: (id) => {
      const source = get().structures.find((s) => s.id === id);
      if (!source) return;
      const copy = duplicateStructureModel(source);
      const structures = [copy, ...get().structures];
      persist(structures);
      set({ structures });
    },

    setDraftName: (name) =>
      set((s) => (s.draft ? { draft: { ...s.draft, name } } : s)),
    setDraftDescription: (description) =>
      set((s) => (s.draft ? { draft: { ...s.draft, description } } : s)),

    addComponent: (kind) => {
      const draft = get().draft;
      if (!draft) return;
      const offset = draft.fields.length * 24;
      let field: StructureComponent;
      if (kind === 'node_section') {
        field = createNodeSection({
          relativeX: 24 + offset,
          relativeY: 24 + offset,
          zIndex: draft.fields.length,
        });
      } else {
        field = createStructureField({
          label: `Field ${draft.fields.length + 1}`,
          instruction: 'Describe what the AI should write here.',
          contentType: kind === 'equation' ? 'equation' : 'text',
          relativeX: 24 + offset,
          relativeY: 24 + offset,
          zIndex: draft.fields.length,
        });
      }
      set({
        draft: touchDraft({ ...draft, fields: [...draft.fields, field] }),
        selectedFieldId: field.id,
        selectedNodeTemplatePart: kind === 'node_section' ? 'root' : null,
      });
    },

    addField: () => get().addComponent('text'),

    updateField: (fieldId, patch) => {
      const draft = get().draft;
      if (!draft) return;
      set({
        draft: touchDraft({
          ...draft,
          fields: draft.fields.map((f) => {
            if (f.id !== fieldId) return f;
            if (f.componentKind === 'node_section') {
              const p = patch as Partial<NoteStructureNodeSection>;
              return {
                ...f,
                ...p,
                componentKind: 'node_section' as const,
                rootTemplate: p.rootTemplate
                  ? {
                      ...f.rootTemplate,
                      ...p.rootTemplate,
                      style: p.rootTemplate.style
                        ? { ...f.rootTemplate.style, ...p.rootTemplate.style }
                        : f.rootTemplate.style,
                    }
                  : f.rootTemplate,
                childTemplate: p.childTemplate
                  ? {
                      ...f.childTemplate,
                      ...p.childTemplate,
                      style: p.childTemplate.style
                        ? { ...f.childTemplate.style, ...p.childTemplate.style }
                        : f.childTemplate.style,
                    }
                  : f.childTemplate,
                connectorConfig: p.connectorConfig
                  ? { ...f.connectorConfig, ...p.connectorConfig }
                  : f.connectorConfig,
              };
            }
            const p = patch as Partial<NoteStructureField>;
            return {
              ...f,
              ...p,
              componentKind: 'field' as const,
              style: p.style ? { ...f.style, ...p.style } : f.style,
            };
          }),
        }),
      });
    },

    updateNodeSection: (fieldId, patch) => {
      get().updateField(fieldId, patch);
    },

    deleteField: (fieldId) => {
      const draft = get().draft;
      if (!draft) return;
      set({
        draft: touchDraft({
          ...draft,
          fields: draft.fields.filter((f) => f.id !== fieldId),
        }),
        selectedFieldId:
          get().selectedFieldId === fieldId ? null : get().selectedFieldId,
      });
    },

    duplicateField: (fieldId) => {
      const draft = get().draft;
      if (!draft) return;
      const source = draft.fields.find((f) => f.id === fieldId);
      if (!source) return;
      const copy = duplicateComponent(source);
      copy.zIndex = draft.fields.length;
      set({
        draft: touchDraft({ ...draft, fields: [...draft.fields, copy] }),
        selectedFieldId: copy.id,
      });
    },

    selectField: (fieldId, nodeTemplatePart = null) =>
      set({
        selectedFieldId: fieldId,
        selectedNodeTemplatePart: fieldId ? nodeTemplatePart : null,
      }),

    setFieldGeometry: (fieldId, geom) => {
      get().updateField(fieldId, geom);
    },

    setNodeTemplateGeometry: (fieldId, part, geom) => {
      const draft = get().draft;
      if (!draft) return;
      const field = draft.fields.find((f) => f.id === fieldId);
      if (!field || field.componentKind !== 'node_section') return;
      if (part === 'root') {
        get().updateField(fieldId, {
          rootTemplate: { ...field.rootTemplate, ...geom },
        });
      } else {
        get().updateField(fieldId, {
          childTemplate: { ...field.childTemplate, ...geom },
        });
      }
    },

    setSelectedStructureIdForAi: (id) => set({ selectedStructureIdForAi: id }),

    getStructureById: (id) => get().structures.find((s) => s.id === id) ?? null,
  }));
}

export const useStructureStore = createStructureStore();
