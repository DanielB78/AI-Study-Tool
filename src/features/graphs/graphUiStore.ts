/**
 * Transient graph interaction / editor UI state — NOT part of CanvasDocument.
 */

import { create } from 'zustand';

export interface GraphUiState {
  /** GraphElement currently in internal pan/zoom mode. */
  interactingGraphId: string | null;
  /** GraphElement whose editor panel is open. */
  editingGraphId: string | null;
  cursor: { x: number; y: number } | null;

  enterInteract: (id: string) => void;
  exitInteract: () => void;
  openEditor: (id: string) => void;
  closeEditor: () => void;
  setCursor: (coords: { x: number; y: number } | null) => void;
}

export const useGraphUiStore = create<GraphUiState>((set) => ({
  interactingGraphId: null,
  editingGraphId: null,
  cursor: null,

  enterInteract: (id) =>
    set({ interactingGraphId: id, cursor: null }),
  exitInteract: () => set({ interactingGraphId: null, cursor: null }),
  openEditor: (id) => set({ editingGraphId: id }),
  closeEditor: () => set({ editingGraphId: null }),
  setCursor: (coords) => set({ cursor: coords }),
}));
