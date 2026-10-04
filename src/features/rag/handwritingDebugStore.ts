/**
 * Transient handwriting-region debug state — NOT stored in CanvasDocument.
 * Recomputes only when enabled and pen content (or config) changes.
 */

import { create } from 'zustand';
import { useCanvasStore } from '../../store/canvasStore';
import {
  DEFAULT_HANDWRITING_REGION_CONFIG,
  type HandwritingRegionConfigPatch,
  type HandwritingRegionDetectionConfig,
} from './handwritingConfig';
import {
  detectHandwritingRegions,
  emptyHandwritingDetection,
  handwritingContentKey,
} from './handwritingRegionDetector';
import type { HandwritingDetectionResult } from './handwritingTypes';

export interface HandwritingDebugState {
  showRegions: boolean;
  showLines: boolean;
  config: HandwritingRegionDetectionConfig;
  result: HandwritingDetectionResult;
  /** Last content key that produced `result`. */
  lastContentKey: string;
  selectedRegionId: string | null;
  selectedLineId: string | null;

  setShowRegions: (show: boolean) => void;
  setShowLines: (show: boolean) => void;
  setConfigPatch: (patch: HandwritingRegionConfigPatch) => void;
  resetConfig: () => void;
  selectRegion: (id: string | null) => void;
  selectLine: (id: string | null) => void;
  /** Recompute if stale / forced. Cheap no-op when nothing changed. */
  ensureDetection: (options?: { force?: boolean }) => HandwritingDetectionResult;
  refreshDetection: () => HandwritingDetectionResult;
}

function recompute(
  config: HandwritingRegionDetectionConfig,
): HandwritingDetectionResult {
  const elements = useCanvasStore.getState().document.elements;
  return detectHandwritingRegions(elements, config);
}

export function createHandwritingDebugStore() {
  return create<HandwritingDebugState>((set, get) => ({
    showRegions: false,
    showLines: false,
    config: { ...DEFAULT_HANDWRITING_REGION_CONFIG },
    result: emptyHandwritingDetection(),
    lastContentKey: '',
    selectedRegionId: null,
    selectedLineId: null,

    setShowRegions: (show) => {
      set({ showRegions: show });
      if (show || get().showLines) {
        get().ensureDetection({ force: true });
      }
    },

    setShowLines: (show) => {
      set({ showLines: show });
      if (show || get().showRegions) {
        get().ensureDetection({ force: true });
      }
    },

    setConfigPatch: (patch) => {
      const config = { ...get().config, ...patch };
      set({ config });
      if (get().showRegions || get().showLines) {
        const result = recompute(config);
        set({
          result,
          lastContentKey: result.contentKey,
          selectedRegionId: null,
          selectedLineId: null,
        });
      }
    },

    resetConfig: () => {
      const config = { ...DEFAULT_HANDWRITING_REGION_CONFIG };
      set({ config });
      if (get().showRegions || get().showLines) {
        const result = recompute(config);
        set({
          result,
          lastContentKey: result.contentKey,
          selectedRegionId: null,
          selectedLineId: null,
        });
      }
    },

    selectRegion: (id) => set({ selectedRegionId: id, selectedLineId: null }),
    selectLine: (id) => set({ selectedLineId: id, selectedRegionId: null }),

    ensureDetection: (options) => {
      const state = get();
      const elements = useCanvasStore.getState().document.elements;
      const key = handwritingContentKey(elements);
      if (
        !options?.force &&
        key === state.lastContentKey &&
        state.result.contentKey === key
      ) {
        return state.result;
      }
      const result = detectHandwritingRegions(elements, state.config);
      set({
        result,
        lastContentKey: result.contentKey,
      });
      return result;
    },

    refreshDetection: () => get().ensureDetection({ force: true }),
  }));
}

export const useHandwritingDebugStore = createHandwritingDebugStore();

/**
 * Subscribe to canvas drawing changes while overlays are visible.
 * Call once from app bootstrap / overlay mount.
 */
export function syncHandwritingDetectionOnCanvasChange(): () => void {
  return useCanvasStore.subscribe((state, prev) => {
    const hw = useHandwritingDebugStore.getState();
    if (!hw.showRegions && !hw.showLines) return;
    if (state.document.elements === prev.document.elements) return;
    const key = handwritingContentKey(state.document.elements);
    if (key === hw.lastContentKey) return;
    // Only recompute when drawing-related content actually changed.
    hw.ensureDetection({ force: true });
  });
}
