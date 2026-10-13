/**
 * Transient graph interaction / editor UI state — NOT part of CanvasDocument.
 */

import { create } from 'zustand';
import type { GraphRegionType } from './types';

export type GraphRegionToolState = {
  graphId: string;
  regionType: GraphRegionType;
  /** Required for curve_segment; optional otherwise. */
  expressionId?: string;
};

export interface GraphUiState {
  /** GraphElement currently in internal pan/zoom mode. */
  interactingGraphId: string | null;
  /** GraphElement whose editor panel is open. */
  editingGraphId: string | null;
  cursor: { x: number; y: number } | null;
  /** When set, plot drag creates a highlighted region instead of pan. */
  regionTool: GraphRegionToolState | null;

  enterInteract: (id: string) => void;
  exitInteract: () => void;
  openEditor: (id: string) => void;
  closeEditor: () => void;
  setCursor: (coords: { x: number; y: number } | null) => void;
  startRegionTool: (tool: GraphRegionToolState) => void;
  clearRegionTool: () => void;
}

export const useGraphUiStore = create<GraphUiState>((set) => ({
  interactingGraphId: null,
  editingGraphId: null,
  cursor: null,
  regionTool: null,

  enterInteract: (id) =>
    set({ interactingGraphId: id, cursor: null }),
  exitInteract: () =>
    set({ interactingGraphId: null, cursor: null, regionTool: null }),
  openEditor: (id) => set({ editingGraphId: id }),
  closeEditor: () => set({ editingGraphId: null }),
  setCursor: (coords) => set({ cursor: coords }),
  startRegionTool: (tool) =>
    set({
      regionTool: tool,
      interactingGraphId: tool.graphId,
      cursor: null,
    }),
  clearRegionTool: () => set({ regionTool: null }),
}));
