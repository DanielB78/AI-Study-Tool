import { create } from 'zustand';
import type {
  Camera,
  CanvasDocument,
  CanvasElement,
  ConnectorElement,
  DrawingElement,
  ImageElement,
  ShapeElement,
  ShapeType,
  StyleDefaults,
  TextElement,
  ToolType,
} from '../types/canvas';
import {
  DEFAULT_STYLE,
  createEmptyDocument,
  isShapeTool,
} from '../types/canvas';
import { cloneElement, createBaseFields, createId, touch } from '../utils/ids';
import { boundsFromPoints, rebasePoints } from '../utils/coordinates';
import {
  createLocalStoragePersistence,
  type PersistenceService,
} from '../persistence/storage';
import { styleFromElement } from '../persistence/migrate';

const MAX_HISTORY = 80;
const persistence: PersistenceService = createLocalStoragePersistence();

export type DraftShapeKind = ShapeType | 'line' | 'arrow';

export interface TransientUI {
  selectedIds: string[];
  activeTool: ToolType;
  editingTextId: string | null;
  /** Shape id currently editing its label. */
  editingShapeLabelId: string | null;
  isSpacePanning: boolean;
  marquee: { x: number; y: number; width: number; height: number } | null;
  draftPoints: number[] | null;
  draftShape: {
    kind: DraftShapeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    x2?: number;
    y2?: number;
  } | null;
  clipboard: CanvasElement[];
  /** Transient snap guides in world coords. */
  snapGuides: { orientation: 'h' | 'v'; position: number }[];
}

interface HistorySlice {
  past: CanvasDocument[];
  future: CanvasDocument[];
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
  setSnapGuides: (guides: TransientUI['snapGuides']) => void;

  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  setEditingTextId: (id: string | null) => void;
  setEditingShapeLabelId: (id: string | null) => void;

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
  toggleLockSelected: () => void;

  alignSelected: (
    mode:
      | 'left'
      | 'centerX'
      | 'right'
      | 'top'
      | 'centerY'
      | 'bottom'
      | 'distributeX'
      | 'distributeY',
  ) => void;

  createTextAt: (worldX: number, worldY: number, width?: number) => string;
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

  applyStyleToSelection: (partial?: Partial<StyleDefaults>) => void;
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

function reindex(elements: CanvasElement[]): CanvasElement[] {
  return elements.map((el, index) =>
    el.zIndex === index + 1 ? el : touch({ ...el, zIndex: index + 1 }),
  );
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  document: createEmptyDocument(),
  style: { ...DEFAULT_STYLE },
  selectedIds: [],
  activeTool: 'select',
  editingTextId: null,
  editingShapeLabelId: null,
  isSpacePanning: false,
  marquee: null,
  draftPoints: null,
  draftShape: null,
  clipboard: [],
  snapGuides: [],
  past: [],
  future: [],
  historySuspended: false,

  hydrate: () => {
    const loaded = persistence.load();
    const doc = loaded ?? createEmptyDocument();
    // Rewrite upgraded documents so v1 boards become durable v2 on disk.
    if (loaded) persistence.save(doc);
    set({
      document: doc,
      selectedIds: [],
      editingTextId: null,
      editingShapeLabelId: null,
    });
  },

  persist: () => {
    persistence.save(get().document);
  },

  setTool: (tool) => {
    set({
      activeTool: tool,
      editingTextId: null,
      editingShapeLabelId: null,
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
  setSnapGuides: (guides) => set({ snapGuides: guides }),
  setEditingTextId: (id) => set({ editingTextId: id, editingShapeLabelId: null }),
  setEditingShapeLabelId: (id) =>
    set({ editingShapeLabelId: id, editingTextId: null }),

  select: (ids, additive = false) => {
    set((s) => {
      let selectedIds: string[];
      if (!additive) selectedIds = ids;
      else {
        const next = new Set(s.selectedIds);
        for (const id of ids) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        selectedIds = [...next];
      }

      const primary =
        selectedIds.length === 1
          ? s.document.elements.find((el) => el.id === selectedIds[0])
          : undefined;

      return {
        selectedIds,
        editingTextId: null,
        editingShapeLabelId: null,
        style: primary ? styleFromElement(primary, s.style) : s.style,
      };
    });
  },

  clearSelection: () =>
    set({ selectedIds: [], editingTextId: null, editingShapeLabelId: null }),

  pushHistory: () => {
    const { document, past, historySuspended } = get();
    if (historySuspended) return;
    set({
      past: [...past, snapshotDoc(document)].slice(-MAX_HISTORY),
      future: [],
    });
  },

  beginInteraction: () => {
    get().pushHistory();
    set({ historySuspended: true });
  },

  endInteraction: () => {
    set({ historySuspended: false, snapGuides: [] });
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
      editingShapeLabelId: null,
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
      editingShapeLabelId: null,
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
    const idSet = new Set(selectedIds);
    const locked = document.elements.some((el) => idSet.has(el.id) && el.locked);
    if (locked && selectedIds.every((id) => document.elements.find((e) => e.id === id)?.locked)) {
      return;
    }
    get().pushHistory();
    set({
      document: withUpdatedElements(
        document,
        document.elements.filter((el) => !idSet.has(el.id) || el.locked),
      ),
      selectedIds: selectedIds.filter(
        (id) => document.elements.find((e) => e.id === id)?.locked,
      ),
      editingTextId: null,
      editingShapeLabelId: null,
    });
    get().persist();
  },

  replaceElements: (elements) => {
    set((s) => ({ document: withUpdatedElements(s.document, elements) }));
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
    set({ document: withUpdatedElements(document, reindex(next)) });
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
    set({ document: withUpdatedElements(document, reindex(next)) });
    get().persist();
  },

  bringToFront: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const rest = document.elements.filter((el) => !idSet.has(el.id));
    const selected = document.elements.filter((el) => idSet.has(el.id));
    set({
      document: withUpdatedElements(
        document,
        reindex([...sortByZ(rest), ...sortByZ(selected)]),
      ),
    });
    get().persist();
  },

  sendToBack: () => {
    const { selectedIds, document } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const rest = document.elements.filter((el) => !idSet.has(el.id));
    const selected = document.elements.filter((el) => idSet.has(el.id));
    set({
      document: withUpdatedElements(
        document,
        reindex([...sortByZ(selected), ...sortByZ(rest)]),
      ),
    });
    get().persist();
  },

  copySelected: () => {
    const { selectedIds, document } = get();
    const idSet = new Set(selectedIds);
    set({
      clipboard: document.elements
        .filter((el) => idSet.has(el.id))
        .map((el) => structuredClone(el)),
    });
  },

  pasteClipboard: () => {
    const { clipboard } = get();
    if (clipboard.length === 0) return;
    get().pushHistory();
    let z = get().nextZIndex();
    const pasted = clipboard.map((el) => {
      const clone = cloneElement(el, 24);
      clone.zIndex = z++;
      clone.locked = false;
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

  toggleLockSelected: () => {
    const { selectedIds } = get();
    if (selectedIds.length === 0) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const selected = get().document.elements.filter((el) => idSet.has(el.id));
    const shouldLock = selected.some((el) => !el.locked);
    get().updateElements(selectedIds, (el) => ({ ...el, locked: shouldLock }));
    get().persist();
  },

  alignSelected: (mode) => {
    const { selectedIds, document } = get();
    if (selectedIds.length < 2) return;
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const selected = document.elements.filter((el) => idSet.has(el.id) && !el.locked);
    if (selected.length < 2) return;

    const minX = Math.min(...selected.map((e) => e.x));
    const maxX = Math.max(...selected.map((e) => e.x + e.width));
    const minY = Math.min(...selected.map((e) => e.y));
    const maxY = Math.max(...selected.map((e) => e.y + e.height));
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    let updates: CanvasElement[] = selected;

    if (mode === 'distributeX' || mode === 'distributeY') {
      if (selected.length < 3) return;
      const sorted =
        mode === 'distributeX'
          ? [...selected].sort((a, b) => a.x - b.x)
          : [...selected].sort((a, b) => a.y - b.y);
      if (mode === 'distributeX') {
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        const span = last.x - first.x;
        const step = span / (sorted.length - 1);
        updates = sorted.map((el, i) =>
          touch({ ...el, x: first.x + step * i }),
        );
      } else {
        const first = sorted[0]!;
        const last = sorted[sorted.length - 1]!;
        const span = last.y - first.y;
        const step = span / (sorted.length - 1);
        updates = sorted.map((el, i) =>
          touch({ ...el, y: first.y + step * i }),
        );
      }
    } else {
      updates = selected.map((el) => {
        switch (mode) {
          case 'left':
            return touch({ ...el, x: minX });
          case 'centerX':
            return touch({ ...el, x: midX - el.width / 2 });
          case 'right':
            return touch({ ...el, x: maxX - el.width });
          case 'top':
            return touch({ ...el, y: minY });
          case 'centerY':
            return touch({ ...el, y: midY - el.height / 2 });
          case 'bottom':
            return touch({ ...el, y: maxY - el.height });
          default:
            return el;
        }
      });
    }

    const byId = new Map(updates.map((el) => [el.id, el]));
    set({
      document: withUpdatedElements(
        document,
        document.elements.map((el) => byId.get(el.id) ?? el),
      ),
    });
    get().persist();
  },

  createTextAt: (worldX, worldY, width = 220) => {
    const { style } = get();
    const id = createId();
    const element: TextElement = {
      ...createBaseFields({
        x: worldX,
        y: worldY,
        width,
        height: Math.max(40, style.fontSize * style.lineHeight + style.textPadding * 2),
        zIndex: get().nextZIndex(),
        opacity: style.opacity,
      }),
      id,
      type: 'text',
      text: 'Text',
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      fontItalic: style.fontItalic,
      underline: style.underline,
      strikethrough: style.strikethrough,
      color: style.textColor,
      alignment: style.textAlignment,
      lineHeight: style.lineHeight,
      backgroundColor: style.textBackgroundColor,
      padding: style.textPadding,
      cornerRadius: style.textCornerRadius,
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
        opacity: style.opacity,
      }),
      type: 'drawing',
      points,
      color: style.strokeColor ?? '#1a1a1a',
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
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
          opacity: style.opacity,
        }),
        type: 'connector',
        connectorType: draft.kind,
        points: [x1 - minX, y1 - minY, x2 - minX, y2 - minY],
        stroke: style.strokeColor ?? '#1a1a1a',
        strokeWidth: style.strokeWidth,
        strokeStyle: style.strokeStyle,
        arrowHeads:
          draft.kind === 'arrow'
            ? style.arrowHeads === 'none'
              ? 'end'
              : style.arrowHeads
            : 'none',
        startBindingId: null,
        endBindingId: null,
      };
      get().addElement(element, true);
      return;
    }

    if (draft.width < 3 && draft.height < 3) return;
    const shapeType = draft.kind;
    const element: ShapeElement = {
      ...createBaseFields({
        x: draft.x,
        y: draft.y,
        width: Math.max(draft.width, 1),
        height: Math.max(draft.height, 1),
        zIndex: get().nextZIndex(),
        opacity: style.opacity,
      }),
      type: 'shape',
      shapeType,
      fill: style.fillColor,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeStyle: style.strokeStyle,
      cornerRadius:
        shapeType === 'roundedRect' ? Math.max(style.cornerRadius, 8) : 0,
      starPoints: 5,
      starInnerRatio: 0.45,
      label: '',
      labelFontSize: style.fontSize,
      labelFontFamily: style.fontFamily,
      labelFontWeight: style.fontWeight,
      labelFontItalic: style.fontItalic,
      labelColor: style.textColor,
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
        opacity: get().style.opacity,
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

  applyStyleToSelection: (partial) => {
    const { selectedIds, style: currentStyle, document } = get();
    if (selectedIds.length === 0) return;
    if (partial) get().setStyle(partial);
    const style = { ...currentStyle, ...partial };
    get().pushHistory();
    const idSet = new Set(selectedIds);
    const elements = document.elements.map((el) => {
      if (!idSet.has(el.id) || el.locked) return el;
      switch (el.type) {
        case 'text':
          return touch({
            ...el,
            color: style.textColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontItalic: style.fontItalic,
            underline: style.underline,
            strikethrough: style.strikethrough,
            alignment: style.textAlignment,
            fontFamily: style.fontFamily,
            lineHeight: style.lineHeight,
            backgroundColor: style.textBackgroundColor,
            padding: style.textPadding,
            cornerRadius: style.textCornerRadius,
            opacity: style.opacity,
          });
        case 'shape':
          return touch({
            ...el,
            fill: style.fillColor,
            stroke: style.strokeColor,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            cornerRadius:
              el.shapeType === 'roundedRect' ? style.cornerRadius : el.cornerRadius,
            opacity: style.opacity,
            labelFontSize: style.fontSize,
            labelFontFamily: style.fontFamily,
            labelFontWeight: style.fontWeight,
            labelFontItalic: style.fontItalic,
            labelColor: style.textColor,
          });
        case 'drawing':
          return touch({
            ...el,
            color: style.strokeColor ?? el.color,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            opacity: style.opacity,
          });
        case 'connector':
          return touch({
            ...el,
            stroke: style.strokeColor ?? el.stroke,
            strokeWidth: style.strokeWidth,
            strokeStyle: style.strokeStyle,
            opacity: style.opacity,
            arrowHeads:
              el.connectorType === 'arrow' ? style.arrowHeads : el.arrowHeads,
          });
        case 'image':
          return touch({ ...el, opacity: style.opacity });
        default:
          return el;
      }
    });
    set({ document: withUpdatedElements(document, elements), style });
    get().persist();
  },
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __STUDYBOARD_STORE__: typeof useCanvasStore }).__STUDYBOARD_STORE__ =
    useCanvasStore;
}

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

export function getElementById(id: string): CanvasElement | undefined {
  return useCanvasStore.getState().document.elements.find((el) => el.id === id);
}

export function getDocumentSnapshot(): CanvasDocument {
  return snapshotDoc(useCanvasStore.getState().document);
}

export { isShapeTool };
