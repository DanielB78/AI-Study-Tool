import { create } from 'zustand';
import type {
  Camera,
  CanvasDocument,
  CanvasElement,
  ConnectorElement,
  DrawingElement,
  ImageElement,
  ShapeElement,
  StyleDefaults,
  TextElement,
  ToolType,
} from '../types/canvas';
import { DEFAULT_STYLE, createEmptyDocument } from '../types/canvas';
import { cloneElement, createBaseFields, createId, touch } from '../utils/ids';
import { boundsFromPoints, rebasePoints } from '../utils/coordinates';
import {
  createLocalStoragePersistence,
  loadOrCreateDocument,
  type PersistenceService,
} from '../persistence/storage';

const MAX_HISTORY = 80;
const persistence: PersistenceService = createLocalStoragePersistence();

export interface TransientUI {
  selectedIds: string[];
  activeTool: ToolType;
  editingTextId: string | null;
  isSpacePanning: boolean;
  marquee: { x: number; y: number; width: number; height: number } | null;
  draftPoints: number[] | null;
  draftShape: {
    kind: 'rectangle' | 'ellipse' | 'line' | 'arrow';
    x: number;
    y: number;
    width: number;
    height: number;
    x2?: number;
    y2?: number;
  } | null;
  clipboard: CanvasElement[];
}

interface HistorySlice {
  past: CanvasDocument[];
  future: CanvasDocument[];
  /** When true, mutations skip pushing history (mid-drag frames). */
  historySuspended: boolean;
}

export interface CanvasStore extends TransientUI, HistorySlice {
  document: CanvasDocument;
  style: StyleDefaults;

  setTool: (tool: ToolType) => void;
  setStyle: (partial: Partial<StyleDefaults>) => void;
  setCamera: (camera: Camera | ((c: Camera) => Camera)) => void;
  setSpacePanning: (value: boolean) => void;
  setMarquee: (marquee: TransientUI['marquee']) => void;
  setDraftPoints: (points: number[] | null) => void;
  setDraftShape: (draft: TransientUI['draftShape']) => void;

  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  setEditingTextId: (id: string | null) => void;

  /** Snapshot document into history before a meaningful change. */
  pushHistory: () => void;
  beginInteraction: () => void;
  endInteraction: () => void;
  undo: () => void;
  redo: () => void;

  addElement: (element: CanvasElement, select?: boolean) => void;
  updateElement: (id: string, updater: (el: CanvasElement) => CanvasElement) => void;
  updateElements: (
    ids: string[],
    updater: (el: CanvasElement) => CanvasElement,
  ) => void;
  deleteSelected: () => void;
  replaceElements: (elements: CanvasElement[]) => void;

  nextZIndex: () => number;
  bringForward: () => void;
  sendBackward: () => void;
  bringToFront: () => void;
  sendToBack: () => void;

  copySelected: () => void;
  pasteClipboard: () => void;
  duplicateSelected: () => void;

  createTextAt: (worldX: number, worldY: number) => string;
  commitDrawing: (absolutePoints: number[]) => void;
  commitShape: (draft: NonNullable<TransientUI['draftShape']>) => void;
  addImageFromFile: (file: File, worldX: number, worldY: number) => Promise<void>;
  addImageFromSrc: (
    src: string,
    naturalWidth: number,
    naturalHeight: number,
    worldX: number,
    worldY: number,
  ) => void;

  applyStyleToSelection: () => void;
  persist: () => void;
  hydrate: () => void;
}

function snapshotDoc(doc: CanvasDocument): CanvasDocument {
  return structuredClone(doc);
}

function sortByZ(elements: CanvasElement[]): CanvasElement[] {
  return [...elements].sort((a, b) => a.zIndex - b.zIndex);
}

function withUpdatedElements(
  doc: CanvasDocument,
  elements: CanvasElement[],
): CanvasDocument {
  return { ...doc, elements: sortByZ(elements) };
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  document: createEmptyDocument(),
  style: { ...DEFAULT_STYLE },
  selectedIds: [],
  activeTool: 'select',
  editingTextId: null,
  isSpacePanning: false,
  marquee: null,
  draftPoints: null,
  draftShape: null,
  clipboard: [],
  past: [],
  future: [],
  historySuspended: false,

  hydrate: () => {
    const doc = loadOrCreateDocument(persistence);
    set({ document: doc, selectedIds: [], editingTextId: null });
  },

  persist: () => {
    persistence.save(get().document);
  },

  setTool: (tool) => {
    set({
      activeTool: tool,
      editingTextId: null,
      draftPoints: null,
      draftShape: null,
      marquee: null,
    });
  },

  setStyle: (partial) => {
    set((s) => ({ style: { ...s.style, ...partial } }));
  },

  setCamera: (camera) => {
    set((s) => ({
      document: {
        ...s.document,
        camera: typeof camera === 'function' ? camera(s.document.camera) : camera,
      },
    }));
  },

  setSpacePanning: (value) => set({ isSpacePanning: value }),
  setMarquee: (marquee) => set({ marquee }),
  setDraftPoints: (points) => set({ draftPoints: points }),
  setDraftShape: (draft) => set({ draftShape: draft }),
  setEditingTextId: (id) => set({ editingTextId: id }),

  select: (ids, additive = false) => {
    set((s) => {
      if (!additive) return { selectedIds: ids, editingTextId: null };
      const next = new Set(s.selectedIds);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return { selectedIds: [...next], editingTextId: null };
    });
  },

  clearSelection: () => set({ selectedIds: [], editingTextId: null }),

  pushHistory: () => {
    const { document, past, historySuspended } = get();
    if (historySuspended) return;
    const nextPast = [...past, snapshotDoc(document)].slice(-MAX_HISTORY);
    set({ past: nextPast, future: [] });
  },

  beginInteraction: () => {
    get().pushHistory();
    set({ historySuspended: true });
  },

  endInteraction: () => {
    set({ historySuspended: false });
    get().persist();
  },

  undo: () => {
    const { past, document, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1]!;
    set({
      past: past.slice(0, -1),
      future: [snapshotDoc(document), ...future].slice(0, MAX_HISTORY),
      document: previous,
      selectedIds: [],
      editingTextId: null,
    });
    get().persist();
  },

  redo: () => {
    const { past, document, future } = get();
    if (future.length === 0) return;
    const next = future[0]!;
    set({
      past: [...past, snapshotDoc(document)].slice(-MAX_HISTORY),
      future: future.slice(1),
      document: next,
      selectedIds: [],
      editingTextId: null,
    });
    get().persist();
  },

  nextZIndex: () => {
    const elements = get().document.elements;
    if (elements.length === 0) return 1;
    return Math.max(...elements.map((e) => e.zIndex)) + 1;
  },

  addElement: (element, select = true) => {
    get().pushHistory();
    set((s) => ({
      document: withUpdatedElements(s.document, [...s.document.elements, element]),
      selectedIds: select ? [element.id] : s.selectedIds,
    }));
    get().persist();
  },

  updateElement: (id, updater) => {
    set((s) => ({
      document: withUpdatedElements(
        s.document,
        s.document.elements.map((el) => (el.id === id ? touch(updater(el)) : el)),
      ),
    }));
  },

  updateElements: (ids, updater) => {
    const idSet = new Set(ids);
    set((s) => ({
      document: withUpdatedElements(
        s.document,
        s.document.elements.map((el) => (idSet.has(el.id) ? touch(updater(el)) : el)),
      ),
    }));
  },

  deleteSelected: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    set({
      document: withUpdatedElements(
        document,
        document.elements.filter((el) => !idSet.has(el.id)),
      ),
      selectedIds: [],
      editingTextId: null,
    });
    get().persist();
  },

  replaceElements: (elements) => {
    set((s) => ({
      document: withUpdatedElements(s.document, elements),
    }));
  },

  bringForward: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const sorted = sortByZ(document.elements);
    const idSet = new Set(selectedIds);
    const next = [...sorted];
    for (let i = next.length - 2; i >= 0; i--) {
      if (idSet.has(next[i]!.id) && !idSet.has(next[i + 1]!.id)) {
        const tmp = next[i]!;
        next[i] = next[i + 1]!;
        next[i + 1] = tmp;
      }
    }
    const reindexed = next.map((el, index) =>
      el.zIndex === index + 1 ? el : touch({ ...el, zIndex: index + 1 }),
    );
    set({ document: withUpdatedElements(document, reindexed) });
    get().persist();
  },

  sendBackward: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const sorted = sortByZ(document.elements);
    const idSet = new Set(selectedIds);
    const next = [...sorted];
    for (let i = 1; i < next.length; i++) {
      if (idSet.has(next[i]!.id) && !idSet.has(next[i - 1]!.id)) {
        const tmp = next[i]!;
        next[i] = next[i - 1]!;
        next[i - 1] = tmp;
      }
    }
    const reindexed = next.map((el, index) =>
      el.zIndex === index + 1 ? el : touch({ ...el, zIndex: index + 1 }),
    );
    set({ document: withUpdatedElements(document, reindexed) });
    get().persist();
  },

  bringToFront: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const rest = document.elements.filter((el) => !idSet.has(el.id));
    const selected = document.elements.filter((el) => idSet.has(el.id));
    const merged = [...sortByZ(rest), ...sortByZ(selected)].map((el, index) =>
      touch({ ...el, zIndex: index + 1 }),
    );
    set({ document: withUpdatedElements(document, merged) });
    get().persist();
  },

  sendToBack: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const rest = document.elements.filter((el) => !idSet.has(el.id));
    const selected = document.elements.filter((el) => idSet.has(el.id));
    const merged = [...sortByZ(selected), ...sortByZ(rest)].map((el, index) =>
      touch({ ...el, zIndex: index + 1 }),
    );
    set({ document: withUpdatedElements(document, merged) });
    get().persist();
  },

  copySelected: () => {
    const { selectedIds, document } = get();
    const idSet = new Set(selectedIds);
    const copied = document.elements.filter((el) => idSet.has(el.id)).map((el) => structuredClone(el));
    set({ clipboard: copied });
  },

  pasteClipboard: () => {
    const { clipboard } = get();
    if (clipboard.length === 0) return;
    get().pushHistory();
    let z = get().nextZIndex();
    const pasted = clipboard.map((el) => {
      const clone = cloneElement(el, 24);
      clone.zIndex = z++;
      return clone;
    });
    set((s) => ({
      document: withUpdatedElements(s.document, [...s.document.elements, ...pasted]),
      selectedIds: pasted.map((el) => el.id),
      clipboard: pasted.map((el) => structuredClone(el)),
    }));
    get().persist();
  },

  duplicateSelected: () => {
    get().copySelected();
    get().pasteClipboard();
  },

  createTextAt: (worldX, worldY) => {
    const { style } = get();
    const id = createId();
    const element: TextElement = {
      ...createBaseFields({
        x: worldX,
        y: worldY,
        width: 220,
        height: 40,
        zIndex: get().nextZIndex(),
      }),
      id,
      type: 'text',
      text: 'Text',
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontStyle: style.fontBold ? 'bold' : 'normal',
      color: style.textColor,
      alignment: style.textAlignment,
    };
    get().addElement(element, true);
    set({ editingTextId: id, activeTool: 'select' });
    return id;
  },

  commitDrawing: (absolutePoints) => {
    if (absolutePoints.length < 4) {
      set({ draftPoints: null });
      return;
    }
    const { style } = get();
    const bounds = boundsFromPoints(absolutePoints);
    const pad = style.strokeWidth;
    const x = bounds.minX - pad;
    const y = bounds.minY - pad;
    const points = rebasePoints(absolutePoints, x, y);
    const element: DrawingElement = {
      ...createBaseFields({
        x,
        y,
        width: Math.max(bounds.width + pad * 2, 1),
        height: Math.max(bounds.height + pad * 2, 1),
        zIndex: get().nextZIndex(),
      }),
      type: 'drawing',
      points,
      color: style.strokeColor,
      strokeWidth: style.strokeWidth,
    };
    set({ draftPoints: null });
    get().addElement(element, true);
  },

  commitShape: (draft) => {
    const { style } = get();
    set({ draftShape: null });

    if (draft.kind === 'line' || draft.kind === 'arrow') {
      const x1 = draft.x;
      const y1 = draft.y;
      const x2 = draft.x2 ?? draft.x + draft.width;
      const y2 = draft.y2 ?? draft.y + draft.height;
      if (Math.hypot(x2 - x1, y2 - y1) < 3) return;
      const minX = Math.min(x1, x2);
      const minY = Math.min(y1, y2);
      const element: ConnectorElement = {
        ...createBaseFields({
          x: minX,
          y: minY,
          width: Math.max(Math.abs(x2 - x1), 1),
          height: Math.max(Math.abs(y2 - y1), 1),
          zIndex: get().nextZIndex(),
        }),
        type: 'connector',
        connectorType: draft.kind,
        points: [x1 - minX, y1 - minY, x2 - minX, y2 - minY],
        stroke: style.strokeColor,
        strokeWidth: style.strokeWidth,
        startBindingId: null,
        endBindingId: null,
      };
      get().addElement(element, true);
      return;
    }

    if (draft.width < 3 && draft.height < 3) return;
    const element: ShapeElement = {
      ...createBaseFields({
        x: draft.x,
        y: draft.y,
        width: Math.max(draft.width, 1),
        height: Math.max(draft.height, 1),
        zIndex: get().nextZIndex(),
      }),
      type: 'shape',
      shapeType: draft.kind,
      fill: style.fillColor,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
    };
    get().addElement(element, true);
  },

  addImageFromSrc: (src, naturalWidth, naturalHeight, worldX, worldY) => {
    const maxDim = 420;
    const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    const element: ImageElement = {
      ...createBaseFields({
        x: worldX - width / 2,
        y: worldY - height / 2,
        width,
        height,
        zIndex: get().nextZIndex(),
      }),
      type: 'image',
      src,
      naturalWidth,
      naturalHeight,
    };
    get().addElement(element, true);
    set({ activeTool: 'select' });
  },

  addImageFromFile: async (file, worldX, worldY) => {
    if (!file.type.startsWith('image/')) return;
    const src = await readFileAsDataURL(file);
    const { width, height } = await loadImageSize(src);
    get().addImageFromSrc(src, width, height, worldX, worldY);
  },

  applyStyleToSelection: () => {
    const { selectedIds, style, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const elements = document.elements.map((el) => {
      if (!idSet.has(el.id)) return el;
      switch (el.type) {
        case 'text':
          return touch({
            ...el,
            color: style.textColor,
            fontSize: style.fontSize,
            fontStyle: style.fontBold ? 'bold' : 'normal',
            alignment: style.textAlignment,
            fontFamily: style.fontFamily,
          });
        case 'shape':
          return touch({
            ...el,
            fill: style.fillColor,
            stroke: style.strokeColor,
            strokeWidth: style.strokeWidth,
          });
        case 'drawing':
          return touch({
            ...el,
            color: style.strokeColor,
            strokeWidth: style.strokeWidth,
          });
        case 'connector':
          return touch({
            ...el,
            stroke: style.strokeColor,
            strokeWidth: style.strokeWidth,
          });
        default:
          return el;
      }
    });
    set({ document: withUpdatedElements(document, elements) });
    get().persist();
  },
}));

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/** Convenience selectors for future AI/query layers. */
export function getElementsByType<T extends CanvasElement['type']>(
  type: T,
): Extract<CanvasElement, { type: T }>[] {
  return useCanvasStore
    .getState()
    .document.elements.filter((el): el is Extract<CanvasElement, { type: T }> => el.type === type);
}

export function getElementById(id: string): CanvasElement | undefined {
  return useCanvasStore.getState().document.elements.find((el) => el.id === id);
}

export function getDocumentSnapshot(): CanvasDocument {
  return snapshotDoc(useCanvasStore.getState().document);
}
