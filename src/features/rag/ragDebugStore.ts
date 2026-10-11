/**
 * Transient RAG debug UI state — NOT stored in CanvasDocument.
 */

import { create } from 'zustand';
import { useCanvasStore } from '../../store/canvasStore';
import type { CanvasElement, TextElement } from '../../types/canvas';
import {
  RAG_MAX_CONTEXT_CHARACTERS,
  RAG_MAX_CONTEXT_ELEMENTS,
  RAG_MAX_CONTEXT_IMAGES,
  RAG_SEMANTIC_EXPANSION_DEPTH_DEFAULT,
  RAG_SEMANTIC_EXPANSION_DEPTH_MAX,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_DEFAULT,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MAX,
  RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MIN,
  RAG_SPATIAL_RADIUS_DEFAULT,
} from './config';
import {
  anchorsFromCandidates,
  buildRagContext,
  type RagContext,
} from './contextBuilder';
import {
  resolveExplicitSelection,
  snapshotEditorSelection,
} from './explicitSelection';
import {
  inspectCanvasRegion,
  toExplicitRegionSelectionSnapshot,
  type CanvasRegionInspection,
  type ExplicitRegionSelectionSnapshot,
} from './regionContext';
import { renderCanvasRegion } from './regionRenderer';
import type { WorldRect } from './geometry';
import {
  REGION_CONTEXT_MAX_DIMENSION,
  REGION_CONTEXT_MIN_DIMENSION,
  REGION_CONTEXT_RENDER_SCALE,
} from './config';
import {
  canvasElementsAsSpatial,
  findElementsNearAnchors,
  type SpatialHit,
} from './spatialContext';
import {
  handwritingRegionsAsSpatial,
  resolveHandwritingRecognition,
} from './handwritingSync';
import { formatGraphElementForContext } from './graphContext';
import {
  ragRetrievalService,
  type PromptIntentClassification,
  type RetrievedCandidate,
} from './ragRetrieval';
import {
  allExpansionChildIds,
  buildSemanticTrees,
  semanticExpansionService,
  semanticHitsForContext,
  topExpansionChildIds,
  type SemanticExpandResponse,
  type SemanticNeighborHit,
  type SemanticTreeNode,
} from './semanticExpansion';
import { aiService } from '../ai/data/aiService';
import { useAiStore } from '../ai/state/aiStore';
import {
  DEFAULT_LLM_EXECUTION_MODE,
  buildLlmPrompt,
  isAutomaticLlmMode,
  isManualLlmMode,
  setLlmExecutionModeOverride,
  type BuiltLlmPrompt,
  type LlmExecutionMode,
} from '../ai/llm';
import {
  applyAgentOperations,
  handleAgentResponse,
  CanvasAgentParseError,
  parseAgentResponsePlan,
} from '../ai/llm/handleLlmResponse';
import type { CanvasAgentResponse } from '../ai/agent/operations';
import { CANVAS_EDITOR_SYSTEM_PROMPT } from '../ai/agent/prompts/loadAgentPrompt';
import { useStructureStore } from '../structures/structureStore';
import type { NoteStructure } from '../structures/types';

export interface RagDebugState {
  open: boolean;
  prompt: string;
  retrieving: boolean;
  expanding: boolean;
  sending: boolean;
  error: string | null;
  statusMessage: string | null;
  candidates: RetrievedCandidate[];
  selectedAnchorIds: string[];
  /**
   * Editor selection IDs snapshotted at prompt submit (Retrieve / Send / Copy).
   * Distinct from selectedAnchorIds (RAG semantic-anchor checkboxes).
   */
  explicitSelectionIds: string[];
  /**
   * Marquee world bounds snapshotted at prompt submit.
   * Independent of live lastMarqueeRegion after the request is built.
   */
  explicitRegionBounds: WorldRect | null;
  /** Classification of the snapshotted region (empty / structured_only / visual). */
  explicitRegionInspection: CanvasRegionInspection | null;
  /** Rendered region PNG data URL when visual content requires an attachment. */
  explicitRegionImageSrc: string | null;
  /** Compact debug snapshot for retrieval JSON. */
  explicitRegionSelectionDebug: ExplicitRegionSelectionSnapshot | null;
  /**
   * Structure ID snapshotted at prompt submit (Retrieve / Copy / Send / Preview).
   * Changing the live dropdown afterward must not alter an already-built prompt.
   */
  selectedStructureId: string | null;
  /** Independent of semantic expansion. */
  spatialExpansionEnabled: boolean;
  radius: number;
  /**
   * Spatial hits the user has unchecked in the debug UI.
   * Default empty → all spatial hits are included.
   */
  spatialExcludedIds: string[];
  /** Independent of spatial expansion. Off by default — never silent. */
  semanticExpansionEnabled: boolean;
  semanticExpansionDepth: number;
  semanticMaxNeighbours: number;
  semanticExpandResponse: SemanticExpandResponse | null;
  /** Manual include set for semantic-expansion children (not roots). */
  semanticIncludedIds: string[];
  /** Collapsed branch keys: `${rootId}:${elementId}` */
  semanticCollapsedKeys: string[];
  previewOpen: boolean;
  llmPromptPreviewOpen: boolean;
  responseModalOpen: boolean;
  pastedResponse: string;
  /** Parsed plan ready for Apply (null until valid JSON is previewed). */
  pendingPlan: string[] | null;
  pendingOperations: CanvasAgentResponse | null;
  parseError: string | null;
  llmExecutionMode: LlmExecutionMode;
  lastCopiedPrompt: string | null;
  lastBuiltPrompt: BuiltLlmPrompt | null;
  lastQueryChunks: number;
  lastRetrieveMeta: {
    embedding_model: string;
    embedding_provider: string;
    min_similarity: number | null;
  } | null;
  /** Observational prompt-intent classification from the last Retrieve. */
  promptIntent: PromptIntentClassification | null;

  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPrompt: (value: string) => void;
  setRadius: (value: number) => void;
  setSpatialExpansionEnabled: (enabled: boolean) => void;
  toggleSpatialIncluded: (elementId: string) => void;
  selectAllSpatialHits: () => void;
  clearSpatialSelection: () => void;
  setSemanticExpansionEnabled: (enabled: boolean) => void;
  setSemanticExpansionDepth: (depth: number) => void;
  setSemanticMaxNeighbours: (n: number) => void;
  toggleSemanticIncluded: (elementId: string) => void;
  selectAllSemanticExpansion: () => void;
  clearSemanticExpansionSelection: () => void;
  selectTopSemanticExpansion: (n: number) => void;
  toggleSemanticBranch: (key: string) => void;
  refreshSemanticExpansion: () => Promise<void>;
  setPreviewOpen: (open: boolean) => void;
  setLlmPromptPreviewOpen: (open: boolean) => void;
  setLlmExecutionMode: (mode: LlmExecutionMode) => void;
  toggleAnchor: (elementId: string) => void;
  selectTopN: (n: number) => void;
  clearAnchors: () => void;
  /** Capture current editor selectedIds into explicitSelectionIds. */
  captureExplicitSelectionSnapshot: () => string[];
  /**
   * Capture lastMarqueeRegion → inspect → optionally render region image.
   * Must be awaited before building multimodal context.
   */
  captureRegionSelectionSnapshot: () => Promise<ExplicitRegionSelectionSnapshot | null>;
  /** Capture live AI structure selector into selectedStructureId. */
  captureStructureSnapshot: () => string | null;
  /** Resolve the snapshotted structure (not the live dropdown). */
  getSnapshottedStructure: () => NoteStructure | null;
  retrieve: () => Promise<void>;
  /** Automatic mode only — never called when Manual LLM Mode is active. */
  sendWithContext: () => Promise<void>;
  buildCurrentLlmPrompt: (options?: {
    resnapshotSelection?: boolean;
  }) => Promise<BuiltLlmPrompt | null>;
  copyLlmPrompt: () => Promise<boolean>;
  openResponseModal: () => void;
  closeResponseModal: () => void;
  setPastedResponse: (value: string) => void;
  previewPastedPlan: () => boolean;
  pasteResponseFromClipboard: () => Promise<boolean>;
  applyPastedResponse: () => boolean;
  copyRetrievalDebugData: () => Promise<boolean>;
  clearError: () => void;
}

export type DebugContextSlice = {
  prompt: string;
  candidates: RetrievedCandidate[];
  selectedAnchorIds: string[];
  explicitSelectionIds: string[];
  explicitRegionBounds: WorldRect | null;
  explicitRegionInspection: CanvasRegionInspection | null;
  explicitRegionImageSrc: string | null;
  selectedStructureId: string | null;
  spatialExpansionEnabled: boolean;
  radius: number;
  spatialExcludedIds: string[];
  semanticExpansionEnabled: boolean;
  semanticExpansionDepth: number;
  semanticMaxNeighbours: number;
  semanticExpandResponse: SemanticExpandResponse | null;
  semanticIncludedIds: string[];
};

function resolveSnapshottedStructure(
  selectedStructureId: string | null,
): NoteStructure | null {
  if (!selectedStructureId) return null;
  return useStructureStore.getState().getStructureById(selectedStructureId);
}

function buildParseContextFromState(state: DebugContextSlice) {
  const { context } = computeDebugContext(state);
  const allowedElementIds = new Set(context.allElements.map((e) => e.element_id));
  const elementTypes = new Map<string, string>();
  const graphExpressionIds = new Map<string, Set<string>>();
  const graphPointIds = new Map<string, Set<string>>();
  for (const el of useCanvasStore.getState().document.elements) {
    if (allowedElementIds.has(el.id)) {
      elementTypes.set(el.id, el.type);
    }
    if (allowedElementIds.has(el.id) && el.type === 'graph') {
      graphExpressionIds.set(
        el.id,
        new Set(el.expressions.map((e) => e.id)),
      );
      graphPointIds.set(el.id, new Set(el.points.map((p) => p.id)));
    }
  }
  return {
    allowedElementIds,
    elementTypes,
    graphExpressionIds,
    graphPointIds,
    context,
    selectedStructure: resolveSnapshottedStructure(state.selectedStructureId),
  };
}

function resolveLiveElement(
  docElements: readonly CanvasElement[],
  elementId: string,
): { text: string; type: string; geometry: { x: number; y: number; width: number; height: number } } | null {
  // Derived handwriting regions are not CanvasElements — resolve from OCR sync.
  if (elementId.startsWith('hw_')) {
    const hw = resolveHandwritingRecognition(elementId);
    if (hw && hw.status === 'ready') {
      return {
        text: hw.recognizedText,
        type: 'handwriting_region',
        geometry: { ...hw.bounds },
      };
    }
    return null;
  }
  const el = docElements.find((e) => e.id === elementId);
  if (!el) return null;
  if (el.type === 'text') {
    return {
      text: el.text,
      type: el.type,
      geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  }
  if (el.type === 'equation') {
    return {
      text: el.latex,
      type: el.type,
      geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  }
  if (el.type === 'shape' && el.label) {
    return {
      text: el.label,
      type: el.type,
      geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  }
  if (el.type === 'graph') {
    return {
      text: formatGraphElementForContext(el),
      type: el.type,
      geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
    };
  }
  return {
    text: '',
    type: el.type,
    geometry: { x: el.x, y: el.y, width: el.width, height: el.height },
  };
}

/** Derive current context from store slices + live canvas (pure enough for UI). */
export function computeDebugContext(
  state: DebugContextSlice,
  canvasElements?: CanvasElement[],
): {
  context: RagContext;
  /** All spatial hits within radius (before manual exclude). */
  spatialHits: SpatialHit[];
  /** Spatial hits after manual include/exclude filtering. */
  spatialHitsIncluded: SpatialHit[];
  semanticNeighborHits: SemanticNeighborHit[];
  semanticTrees: SemanticTreeNode[];
} {
  const selected = new Set(state.selectedAnchorIds);
  const docElements =
    canvasElements ?? useCanvasStore.getState().document.elements;
  const anchors = anchorsFromCandidates(state.candidates, selected, (elementId) =>
    resolveLiveElement(docElements, elementId),
  );

  const canvasEls = canvasElementsAsSpatial(
    docElements,
    handwritingRegionsAsSpatial(),
  );
  const anchorSpatials = anchors.map((a) => ({
    id: a.element_id,
    type: a.element_type,
    x: a.geometry.x,
    y: a.geometry.y,
    width: a.geometry.width,
    height: a.geometry.height,
    text: a.text,
  }));

  const spatialHitsRaw =
    !state.spatialExpansionEnabled || anchors.length === 0
      ? []
      : findElementsNearAnchors(anchorSpatials, canvasEls, state.radius);

  const excluded = new Set(state.spatialExcludedIds);
  const spatialHits = spatialHitsRaw.filter((h) => !excluded.has(h.element_id));

  const included = new Set(state.semanticIncludedIds);
  let semanticNeighborHits: SemanticNeighborHit[] = [];
  let semanticTrees: SemanticTreeNode[] = [];

  if (
    state.semanticExpansionEnabled &&
    state.semanticExpandResponse &&
    state.semanticExpansionDepth > 0
  ) {
    semanticTrees = buildSemanticTrees(state.semanticExpandResponse);
    semanticNeighborHits = semanticHitsForContext(
      state.semanticExpandResponse,
      included,
      (elementId) => resolveLiveElement(docElements, elementId),
    );
  }

  const explicitSelections = resolveExplicitSelection(
    state.explicitSelectionIds,
    docElements,
  );

  const regionInspection = state.explicitRegionInspection;
  const regionStructuredSelections = regionInspection?.structuredSelections ?? [];
  const regionBounds = state.explicitRegionBounds;
  const regionImage =
    regionInspection?.shouldRenderImage && state.explicitRegionImageSrc
      ? {
          worldBounds: regionBounds ?? regionInspection.bounds,
          asset_src: state.explicitRegionImageSrc,
          includedElementIds: regionInspection.intersectingElementIds,
          containsUnstructuredVisuals: regionInspection.hasVisualContent,
        }
      : null;

  // Enrich spatial image/graph/handwriting hits with live state.
  const enrichedSpatialHits = spatialHits.map((hit) => {
    if (hit.element_type === 'image') {
      if (hit.image_src) return hit;
      const live = docElements.find((e) => e.id === hit.element_id);
      if (live && live.type === 'image') {
        return { ...hit, image_src: live.src };
      }
      return hit;
    }
    if (hit.element_type === 'graph') {
      const live = docElements.find((e) => e.id === hit.element_id);
      if (live && live.type === 'graph') {
        return { ...hit, text: formatGraphElementForContext(live) };
      }
    }
    if (hit.element_type === 'handwriting_region') {
      const hw = resolveHandwritingRecognition(hit.element_id);
      if (hw?.status === 'ready') {
        return { ...hit, text: hw.recognizedText };
      }
    }
    return hit;
  });

  // Collect handwriting region images for multimodal LLM context.
  // OCR text is for retrieval; original stroke crop is what the LLM sees.
  const handwritingImages: import('./contextBuilder').HandwritingImageInput[] = [];
  const seenHw = new Set<string>();

  for (const anchor of anchors) {
    if (anchor.element_type !== 'handwriting_region') continue;
    if (seenHw.has(anchor.element_id)) continue;
    const hw = resolveHandwritingRecognition(anchor.element_id);
    if (!hw || hw.status !== 'ready' || !hw.regionImageDataUrl) continue;
    seenHw.add(anchor.element_id);
    handwritingImages.push({
      region_id: anchor.element_id,
      asset_src: hw.regionImageDataUrl,
      geometry: { ...hw.bounds },
      stroke_ids: [...hw.strokeIds],
      ocr_transcription: hw.recognizedText,
      reason: 'semantic_handwriting',
      sources: [{ type: 'semantic', similarity: anchor.similarity, matched_chunks: anchor.matched_chunks }],
      nearest_distance: null,
    });
  }

  for (const hit of enrichedSpatialHits) {
    if (hit.element_type !== 'handwriting_region') continue;
    if (seenHw.has(hit.element_id)) {
      // Already a semantic anchor — merge spatial provenance later via dedupe.
      continue;
    }
    const hw = resolveHandwritingRecognition(hit.element_id);
    if (!hw || hw.status !== 'ready' || !hw.regionImageDataUrl) continue;
    seenHw.add(hit.element_id);
    handwritingImages.push({
      region_id: hit.element_id,
      asset_src: hw.regionImageDataUrl,
      geometry: { ...hw.bounds },
      stroke_ids: [...hw.strokeIds],
      ocr_transcription: hw.recognizedText,
      reason: 'spatial_neighbor',
      sources: [
        {
          type: 'spatial',
          anchor_element_id: hit.anchor_element_id,
          distance: hit.distance,
        },
      ],
      nearest_distance: hit.distance,
    });
  }

  const context = buildRagContext({
    query: state.prompt.trim(),
    explicitSelections,
    regionStructuredSelections,
    regionBounds,
    regionImage,
    handwritingImages,
    semanticAnchors: anchors,
    spatialHits: enrichedSpatialHits,
    semanticNeighborHits,
    maxElements: RAG_MAX_CONTEXT_ELEMENTS,
    maxCharacters: RAG_MAX_CONTEXT_CHARACTERS,
    maxImages: RAG_MAX_CONTEXT_IMAGES,
  });

  return {
    context,
    spatialHits: spatialHitsRaw,
    spatialHitsIncluded: enrichedSpatialHits,
    semanticNeighborHits,
    semanticTrees,
  };
}

function hasBuildableContext(state: {
  prompt: string;
  selectedAnchorIds: string[];
  explicitSelectionIds: string[];
}): boolean {
  // Prompt alone is enough: empty canvas context is valid (e.g. structured note
  // with viewport_default and no prior board content). Selection/anchors enrich.
  return state.prompt.trim().length > 0;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function clampDepth(depth: number): number {
  return Math.max(0, Math.min(RAG_SEMANTIC_EXPANSION_DEPTH_MAX, Math.round(depth)));
}

function clampMaxNeighbours(n: number): number {
  return Math.max(
    RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MIN,
    Math.min(RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_MAX, Math.round(n) || 1),
  );
}

export function createRagDebugStore() {
  return create<RagDebugState>((set, get) => {
    const runSemanticExpand = async () => {
      const state = get();
      if (!state.semanticExpansionEnabled) {
        set({
          semanticExpandResponse: null,
          semanticIncludedIds: [],
          expanding: false,
        });
        return;
      }
      if (state.selectedAnchorIds.length === 0 || state.semanticExpansionDepth <= 0) {
        set({
          semanticExpandResponse: null,
          semanticIncludedIds: [],
          expanding: false,
        });
        return;
      }
      if (state.expanding) return;

      set({ expanding: true, error: null });
      try {
        const boardId = useCanvasStore.getState().document.id;
        const response = await semanticExpansionService.expand({
          board_id: boardId,
          root_anchor_ids: state.selectedAnchorIds,
          depth: state.semanticExpansionDepth,
          max_neighbours: state.semanticMaxNeighbours,
        });
        // Default: select all children (debug-friendly; user can deselect).
        const allIds = allExpansionChildIds(response);
        set({
          semanticExpandResponse: response,
          semanticIncludedIds: allIds,
          expanding: false,
          statusMessage: `Semantic expansion: ${allIds.length} neighbour(s)`,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Semantic expansion failed';
        set({
          expanding: false,
          error: message,
          semanticExpandResponse: null,
          semanticIncludedIds: [],
        });
      }
    };

    return {
      open: false,
      prompt: '',
      retrieving: false,
      expanding: false,
      sending: false,
      error: null,
      statusMessage: null,
      candidates: [],
      selectedAnchorIds: [],
      explicitSelectionIds: [],
      explicitRegionBounds: null,
      explicitRegionInspection: null,
      explicitRegionImageSrc: null,
      explicitRegionSelectionDebug: null,
      selectedStructureId: null,
      spatialExpansionEnabled: true,
      radius: RAG_SPATIAL_RADIUS_DEFAULT,
      spatialExcludedIds: [],
      semanticExpansionEnabled: false,
      semanticExpansionDepth: RAG_SEMANTIC_EXPANSION_DEPTH_DEFAULT,
      semanticMaxNeighbours: RAG_SEMANTIC_EXPANSION_MAX_NEIGHBOURS_DEFAULT,
      semanticExpandResponse: null,
      semanticIncludedIds: [],
      semanticCollapsedKeys: [],
      previewOpen: false,
      llmPromptPreviewOpen: false,
      responseModalOpen: false,
      pastedResponse: '',
      pendingPlan: null,
      pendingOperations: null,
      parseError: null,
      llmExecutionMode: DEFAULT_LLM_EXECUTION_MODE,
      lastCopiedPrompt: null,
      lastBuiltPrompt: null,
      lastQueryChunks: 0,
      lastRetrieveMeta: null,
      promptIntent: null,

      openPanel: () => set({ open: true }),
      closePanel: () =>
        set({
          open: false,
          previewOpen: false,
          llmPromptPreviewOpen: false,
          responseModalOpen: false,
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
        }),
      togglePanel: () =>
        set((s) => ({
          open: !s.open,
          previewOpen: s.open ? false : s.previewOpen,
          llmPromptPreviewOpen: s.open ? false : s.llmPromptPreviewOpen,
          responseModalOpen: s.open ? false : s.responseModalOpen,
          pendingPlan: s.open ? null : s.pendingPlan,
          pendingOperations: s.open ? null : s.pendingOperations,
        })),

      setPrompt: (value) => set({ prompt: value, error: null }),

      setRadius: (value) => set({ radius: Math.max(0, value) }),

      setSpatialExpansionEnabled: (enabled) =>
        set({ spatialExpansionEnabled: enabled }),

      toggleSpatialIncluded: (elementId) => {
        set((s) => {
          const excluded = s.spatialExcludedIds.includes(elementId);
          return {
            spatialExcludedIds: excluded
              ? s.spatialExcludedIds.filter((id) => id !== elementId)
              : [...s.spatialExcludedIds, elementId],
          };
        });
      },

      selectAllSpatialHits: () => set({ spatialExcludedIds: [] }),

      clearSpatialSelection: () => {
        const { spatialHits } = computeDebugContext(get());
        const ids = [...new Set(spatialHits.map((h) => h.element_id))];
        set({ spatialExcludedIds: ids });
      },

      setSemanticExpansionEnabled: (enabled) => {
        set({ semanticExpansionEnabled: enabled, error: null });
        if (enabled) {
          void runSemanticExpand();
        } else {
          set({
            semanticExpandResponse: null,
            semanticIncludedIds: [],
            expanding: false,
          });
        }
      },

      setSemanticExpansionDepth: (depth) => {
        set({ semanticExpansionDepth: clampDepth(depth), error: null });
        if (get().semanticExpansionEnabled) {
          void runSemanticExpand();
        }
      },

      setSemanticMaxNeighbours: (n) => {
        set({ semanticMaxNeighbours: clampMaxNeighbours(n), error: null });
        if (get().semanticExpansionEnabled) {
          void runSemanticExpand();
        }
      },

      toggleSemanticIncluded: (elementId) => {
        set((s) => {
          const has = s.semanticIncludedIds.includes(elementId);
          return {
            semanticIncludedIds: has
              ? s.semanticIncludedIds.filter((id) => id !== elementId)
              : [...s.semanticIncludedIds, elementId],
          };
        });
      },

      selectAllSemanticExpansion: () => {
        const response = get().semanticExpandResponse;
        if (!response) return;
        set({ semanticIncludedIds: allExpansionChildIds(response) });
      },

      clearSemanticExpansionSelection: () => set({ semanticIncludedIds: [] }),

      selectTopSemanticExpansion: (n) => {
        const response = get().semanticExpandResponse;
        if (!response) return;
        set({ semanticIncludedIds: topExpansionChildIds(response, n) });
      },

      toggleSemanticBranch: (key) => {
        set((s) => {
          const has = s.semanticCollapsedKeys.includes(key);
          return {
            semanticCollapsedKeys: has
              ? s.semanticCollapsedKeys.filter((k) => k !== key)
              : [...s.semanticCollapsedKeys, key],
          };
        });
      },

      refreshSemanticExpansion: () => runSemanticExpand(),

      setPreviewOpen: (open) => set({ previewOpen: open }),

      setLlmPromptPreviewOpen: (open) => set({ llmPromptPreviewOpen: open }),

      setLlmExecutionMode: (mode) => {
        setLlmExecutionModeOverride(mode);
        set({ llmExecutionMode: mode });
      },

      toggleAnchor: (elementId) => {
        set((s) => {
          const has = s.selectedAnchorIds.includes(elementId);
          return {
            selectedAnchorIds: has
              ? s.selectedAnchorIds.filter((id) => id !== elementId)
              : [...s.selectedAnchorIds, elementId],
          };
        });
        if (get().semanticExpansionEnabled) {
          void runSemanticExpand();
        }
      },

      selectTopN: (n) => {
        const { candidates } = get();
        const ids = candidates.slice(0, Math.max(0, n)).map((c) => c.element_id);
        set({ selectedAnchorIds: ids });
        if (get().semanticExpansionEnabled) {
          void runSemanticExpand();
        }
      },

      clearAnchors: () => {
        set({
          selectedAnchorIds: [],
          semanticExpandResponse: null,
          semanticIncludedIds: [],
        });
      },

      captureExplicitSelectionSnapshot: () => {
        const ids = snapshotEditorSelection(
          useCanvasStore.getState().selectedIds,
        );
        set({ explicitSelectionIds: ids });
        return ids;
      },

      captureRegionSelectionSnapshot: async () => {
        const canvasState = useCanvasStore.getState();
        const bounds = canvasState.lastMarqueeRegion;
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
          set({
            explicitRegionBounds: null,
            explicitRegionInspection: null,
            explicitRegionImageSrc: null,
            explicitRegionSelectionDebug: null,
          });
          return null;
        }

        const inspection = inspectCanvasRegion(
          canvasState.document.elements,
          bounds,
        );

        let imageSrc: string | null = null;
        if (inspection.shouldRenderImage) {
          try {
            const rendered = await renderCanvasRegion(
              canvasState.document,
              bounds,
              {
                scale: REGION_CONTEXT_RENDER_SCALE,
                maxDimension: REGION_CONTEXT_MAX_DIMENSION,
                minDimension: REGION_CONTEXT_MIN_DIMENSION,
              },
            );
            imageSrc = rendered.dataUrl;
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : 'Failed to render selected canvas region';
            set({
              explicitRegionBounds: { ...bounds },
              explicitRegionInspection: inspection,
              explicitRegionImageSrc: null,
              explicitRegionSelectionDebug: toExplicitRegionSelectionSnapshot(
                inspection,
                false,
              ),
              error: `Selected region requires visual context but rendering failed: ${message}`,
            });
            return toExplicitRegionSelectionSnapshot(inspection, false);
          }
        }

        const debug = toExplicitRegionSelectionSnapshot(
          inspection,
          Boolean(imageSrc),
        );
        set({
          explicitRegionBounds: { ...bounds },
          explicitRegionInspection: inspection,
          explicitRegionImageSrc: imageSrc,
          explicitRegionSelectionDebug: debug,
        });
        return debug;
      },

      captureStructureSnapshot: () => {
        const id = useStructureStore.getState().selectedStructureIdForAi;
        set({ selectedStructureId: id });
        return id;
      },

      getSnapshottedStructure: () =>
        resolveSnapshottedStructure(get().selectedStructureId),

      clearError: () => set({ error: null }),

      buildCurrentLlmPrompt: async (options) => {
        if (options?.resnapshotSelection !== false) {
          get().captureExplicitSelectionSnapshot();
          get().captureStructureSnapshot();
          await get().captureRegionSelectionSnapshot();
        }
        const state = get();
        const prompt = state.prompt.trim();
        if (!hasBuildableContext(state)) return null;
        const { context } = computeDebugContext(state);
        const built = buildLlmPrompt({
          userPrompt: prompt,
          ragContext: context,
          selectedStructure: resolveSnapshottedStructure(state.selectedStructureId),
        });
        set({ lastBuiltPrompt: built });
        return built;
      },

      copyLlmPrompt: async () => {
        // New submit → capture current editor selection + structure + region.
        const built = await get().buildCurrentLlmPrompt({
          resnapshotSelection: true,
        });
        if (!built) {
          set({
            error: 'Enter a prompt first.',
          });
          return false;
        }
        const ok = await writeClipboard(built.finalLlmPrompt);
        if (!ok) {
          set({ error: 'Could not copy to clipboard.' });
          return false;
        }
        const imageCount = built.imageAttachments.length;
        const regionCount = built.imageAttachments.filter(
          (a) => a.selection_reason === 'explicit_region_selection',
        ).length;
        set({
          lastCopiedPrompt: built.finalLlmPrompt,
          statusMessage:
            imageCount > 0
              ? regionCount > 0
                ? `Prompt copied · ${imageCount} image attachment(s) required (incl. selected region)`
                : `Prompt copied · ${imageCount} image attachment(s) required`
              : 'Prompt copied',
          error: null,
        });
        return true;
      },

      openResponseModal: () =>
        set({
          responseModalOpen: true,
          pastedResponse: '',
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
          error: null,
        }),
      closeResponseModal: () =>
        set({
          responseModalOpen: false,
          pastedResponse: '',
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
        }),
      setPastedResponse: (value) =>
        set({
          pastedResponse: value,
          pendingPlan: null,
          pendingOperations: null,
          parseError: null,
        }),

      previewPastedPlan: () => {
        const state = get();
        try {
          // Use snapshotted structure from last prompt build; if none, capture live.
          if (state.selectedStructureId === null && state.lastBuiltPrompt == null) {
            get().captureStructureSnapshot();
          }
          const { allowedElementIds, elementTypes, selectedStructure } =
            buildParseContextFromState(get());
          const parsed = parseAgentResponsePlan(state.pastedResponse, {
            allowedElementIds,
            elementTypes,
            selectedStructure,
          });
          set({
            pendingPlan: parsed.plan,
            pendingOperations: parsed.response,
            parseError: null,
            error: null,
          });
          return true;
        } catch (err) {
          const message =
            err instanceof CanvasAgentParseError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Invalid agent response';
          set({
            pendingPlan: null,
            pendingOperations: null,
            parseError: message,
            error: message,
          });
          return false;
        }
      },

      pasteResponseFromClipboard: async () => {
        try {
          const text = await navigator.clipboard.readText();
          set({
            pastedResponse: text,
            pendingPlan: null,
            pendingOperations: null,
            parseError: null,
          });
          return true;
        } catch {
          set({ error: 'Could not read clipboard — paste with Ctrl+V.' });
          return false;
        }
      },

      applyPastedResponse: () => {
        const state = get();
        let ops = state.pendingOperations;
        if (!ops) {
          const ok = get().previewPastedPlan();
          if (!ok) return false;
          ops = get().pendingOperations;
        }
        if (!ops || ops.operations.length === 0) {
          set({ error: 'No validated operations to apply.' });
          return false;
        }

        try {
          const result = applyAgentOperations(ops.operations);
          set({
            responseModalOpen: false,
            pastedResponse: '',
            pendingPlan: null,
            pendingOperations: null,
            parseError: null,
            statusMessage: `Applied ${ops.operations.length} operation(s)`,
            error: null,
          });
          useAiStore.setState({
            status: 'success',
            errorMessage: null,
            statusMessage: 'AI plan applied to canvas',
            lastInsertedId: result.createdIds[0] ?? result.updatedIds[0] ?? null,
            lastPrompt: get().prompt.trim() || useAiStore.getState().lastPrompt,
            expanded: true,
          });
          return true;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to apply operations';
          set({ error: message });
          return false;
        }
      },

      copyRetrievalDebugData: async () => {
        const state = get();
        const { context, spatialHits, semanticNeighborHits, semanticTrees } =
          computeDebugContext(state);
        const built = hasBuildableContext(state)
          ? buildLlmPrompt({
              userPrompt: state.prompt.trim(),
              ragContext: context,
            })
          : null;
        const payload = {
          userPrompt: state.prompt,
          llmExecutionMode: state.llmExecutionMode,
          promptIntent: state.promptIntent,
          explicitSelection: context.explicitlySelectedElements.map((e) => ({
            element_id: e.element_id,
            element_type: e.element_type,
          })),
          candidates: state.candidates,
          selectedAnchorIds: state.selectedAnchorIds,
          explicitSelectionIds: state.explicitSelectionIds,
          explicitRegionSelection: state.explicitRegionSelectionDebug,
          spatialExpansionEnabled: state.spatialExpansionEnabled,
          radius: state.radius,
          spatialExcludedIds: state.spatialExcludedIds,
          semanticExpansionEnabled: state.semanticExpansionEnabled,
          semanticExpansionDepth: state.semanticExpansionDepth,
          semanticMaxNeighbours: state.semanticMaxNeighbours,
          semanticIncludedIds: state.semanticIncludedIds,
          semanticExpandResponse: state.semanticExpandResponse,
          semanticTrees,
          spatialHits,
          semanticNeighborHits,
          contextStats: context.stats,
          imageAttachments: context.imageAttachments.map((a) => ({
            element_id: a.element_id,
            selection_reason: a.selection_reason,
            nearest_distance: a.nearest_distance,
            sources: a.sources,
            // Do not dump binary data into debug JSON.
            asset_src_chars: a.asset_src.length,
          })),
          includedElements: context.allElements.map((e) => ({
            element_id: e.element_id,
            element_type: e.element_type,
            inclusion: e.inclusion,
            similarity: e.similarity,
            nearest_distance: e.nearest_distance,
            semantic_neighbor_similarity: e.semantic_neighbor_similarity,
            sources: e.sources,
          })),
          finalLlmPromptLength: built?.finalLlmPrompt.length ?? 0,
          imageAttachmentCount: built?.imageAttachments.length ?? 0,
        };
        const ok = await writeClipboard(JSON.stringify(payload, null, 2));
        if (!ok) {
          set({ error: 'Could not copy debug data.' });
          return false;
        }
        set({ statusMessage: 'Retrieval debug data copied', error: null });
        return true;
      },

      retrieve: async () => {
        const prompt = get().prompt.trim();
        if (!prompt) {
          set({ error: 'Enter a prompt to retrieve.' });
          return;
        }
        if (get().retrieving) return;

        // Snapshot editor selection + structure at prompt submit — stable for this request.
        const explicitSelectionIds = get().captureExplicitSelectionSnapshot();
        const selectedStructureId = get().captureStructureSnapshot();
        await get().captureRegionSelectionSnapshot();

        set({ retrieving: true, error: null, statusMessage: null });
        try {
          const boardId = useCanvasStore.getState().document.id;
          const result = await ragRetrievalService.retrieve({
            board_id: boardId,
            prompt,
          });
          const regionDebug = get().explicitRegionSelectionDebug;
          const regionNote =
            regionDebug?.imageAttachmentCreated
              ? ' · region image attached'
              : regionDebug?.kind === 'structured_only'
                ? ' · region text-only'
                : regionDebug?.kind === 'empty'
                  ? ' · empty region'
                  : '';
          set({
            candidates: result.candidates,
            selectedAnchorIds: [],
            explicitSelectionIds,
            selectedStructureId,
            semanticExpandResponse: null,
            semanticIncludedIds: [],
            lastQueryChunks: result.query_chunks,
            lastRetrieveMeta: {
              embedding_model: result.embedding_model,
              embedding_provider: result.embedding_provider,
              min_similarity: result.min_similarity,
            },
            promptIntent: result.prompt_intent ?? null,
            retrieving: false,
            statusMessage: `${result.candidates.length} semantic candidate(s) · ${explicitSelectionIds.length} editor selection(s)${regionNote}`,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Retrieve failed';
          set({
            retrieving: false,
            error: message,
            candidates: [],
            selectedAnchorIds: [],
            // Keep snapshot from this submit attempt for debugging.
            semanticExpandResponse: null,
            semanticIncludedIds: [],
            promptIntent: null,
          });
        }
      },

      sendWithContext: async () => {
        const state = get();

        if (isManualLlmMode(state.llmExecutionMode)) {
          set({
            error:
              'Manual LLM Mode is on — use Copy LLM Prompt → ChatGPT → Paste LLM Response (no API call).',
          });
          return;
        }

        if (!isAutomaticLlmMode(state.llmExecutionMode)) {
          set({ error: 'Unknown LLM execution mode.' });
          return;
        }

        const prompt = state.prompt.trim();
        if (!prompt) {
          set({ error: 'Enter a prompt.' });
          return;
        }
        // New submit → capture current editor selection + structure + region.
        get().captureExplicitSelectionSnapshot();
        get().captureStructureSnapshot();
        await get().captureRegionSelectionSnapshot();
        const submitted = get();
        if (!hasBuildableContext(submitted)) {
          set({
            error: 'Enter a prompt before sending.',
          });
          return;
        }
        if (state.sending) return;

        const { context } = computeDebugContext(submitted);
        const built = buildLlmPrompt({
          userPrompt: prompt,
          ragContext: context,
          selectedStructure: resolveSnapshottedStructure(submitted.selectedStructureId),
        });
        set({ sending: true, error: null, statusMessage: null, lastBuiltPrompt: built });

        try {
          if (
            context.imageAttachments.length > 0 &&
            !aiService.supportsImageInput()
          ) {
            const regionRequired = context.imageAttachments.some(
              (a) => a.selection_reason === 'explicit_region_selection',
            );
            const ids = context.imageAttachments.map((a) => a.element_id).join(', ');
            const message = regionRequired
              ? `This LLM provider does not support image input, but the selected canvas region requires visual context (${ids}). Switch to a vision-capable model — handwriting/sketches cannot be sent as text.`
              : `This LLM provider does not support image input, but ${context.imageAttachments.length} canvas image(s) are in context (${ids}). Switch to a vision-capable model or uncheck the images in Spatial.`;
            set({ sending: false, error: message });
            useAiStore.setState({
              status: 'error',
              errorMessage: message,
              expanded: true,
            });
            return;
          }

          // Region required an image but render failed / missing.
          if (
            submitted.explicitRegionInspection?.shouldRenderImage &&
            !submitted.explicitRegionImageSrc
          ) {
            const message =
              'Selected canvas region contains visual content that must be attached as an image, but the region render is unavailable.';
            set({ sending: false, error: message });
            useAiStore.setState({
              status: 'error',
              errorMessage: message,
              expanded: true,
            });
            return;
          }

          useAiStore.setState({
            status: 'loading',
            expanded: true,
            errorMessage: null,
            statusMessage: null,
            lastPrompt: prompt,
          });

          const result = await aiService.sendPrompt(prompt, undefined, {
            systemInstruction: CANVAS_EDITOR_SYSTEM_PROMPT,
            canvasContext: [context.serialized, built.noteStructureSection]
              .filter(Boolean)
              .join('\n\n'),
            imageAttachments: context.imageAttachments.map((a) => ({
              element_id: a.element_id,
              data_url: a.asset_src,
            })),
          });

          const allowedElementIds = new Set(
            context.allElements.map((e) => e.element_id),
          );
          const elementTypes = new Map(
            context.allElements.map(
              (e) => [e.element_id, e.element_type] as const,
            ),
          );
          let applied;
          try {
            applied = handleAgentResponse(result.text, {
              allowedElementIds,
              elementTypes,
              selectedStructure: resolveSnapshottedStructure(
                submitted.selectedStructureId,
              ),
            });
          } catch (err) {
            const message =
              err instanceof CanvasAgentParseError
                ? err.message
                : 'LLM response was not valid canvas operations JSON.';
            set({ sending: false, error: message });
            useAiStore.setState({
              status: 'error',
              errorMessage: message,
            });
            return;
          }

          set({
            sending: false,
            statusMessage: `Applied ${applied.response.operations.length} operation(s)`,
          });
          useAiStore.setState({
            status: 'success',
            errorMessage: null,
            prompt: '',
            statusMessage: 'AI plan applied to canvas',
            lastInsertedId:
              applied.execution?.createdIds[0] ??
              applied.execution?.updatedIds[0] ??
              null,
            expanded: true,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Send failed';
          set({ sending: false, error: message });
          useAiStore.setState({
            status: 'error',
            errorMessage: 'AI request failed. Please try again.',
            expanded: true,
          });
        }
      },
    };
  });
}

export const useRagDebugStore = createRagDebugStore();

/** Ids for canvas overlay — anchors take visual precedence. */
export function getDebugHighlightIds(state: DebugContextSlice): {
  semanticIds: string[];
  spatialIds: string[];
  semanticNeighborIds: string[];
} {
  const { context } = computeDebugContext(state);
  const semanticIds = context.semanticAnchors.map((e) => e.element_id);
  const spatialIds = context.spatialElements.map((e) => e.element_id);
  const semanticNeighborIds = context.semanticNeighborElements.map(
    (e) => e.element_id,
  );
  return { semanticIds, spatialIds, semanticNeighborIds };
}

export function findTextElement(id: string): TextElement | undefined {
  const el = useCanvasStore.getState().document.elements.find((e) => e.id === id);
  return el?.type === 'text' ? el : undefined;
}
