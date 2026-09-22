import type { CanvasDocument, CanvasElement } from '../types/canvas';
import { DOCUMENT_VERSION, createEmptyDocument } from '../types/canvas';

const STORAGE_KEY = 'ai-study-tool:canvas-document:v1';

export interface PersistenceService {
  load(): CanvasDocument | null;
  save(document: CanvasDocument): void;
  clear(): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isElement(value: unknown): value is CanvasElement {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.type !== 'string') return false;
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return false;
  return true;
}

/** Explicit deserialize — never trust raw Konva / arbitrary JSON blindly. */
export function deserializeDocument(raw: unknown): CanvasDocument | null {
  if (!isObject(raw)) return null;
  if (raw.version !== DOCUMENT_VERSION) return null;
  if (!Array.isArray(raw.elements)) return null;
  if (!isObject(raw.camera)) return null;

  const camera = raw.camera;
  if (
    typeof camera.x !== 'number' ||
    typeof camera.y !== 'number' ||
    typeof camera.zoom !== 'number'
  ) {
    return null;
  }

  const elements = raw.elements.filter(isElement) as CanvasElement[];

  return {
    version: DOCUMENT_VERSION,
    elements,
    camera: {
      x: camera.x,
      y: camera.y,
      zoom: camera.zoom,
    },
  };
}

export function serializeDocument(document: CanvasDocument): string {
  const payload: CanvasDocument = {
    version: DOCUMENT_VERSION,
    elements: document.elements,
    camera: { ...document.camera },
  };
  return JSON.stringify(payload);
}

export function parseDocument(json: string): CanvasDocument | null {
  try {
    return deserializeDocument(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

export function createLocalStoragePersistence(
  key = STORAGE_KEY,
): PersistenceService {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return parseDocument(raw);
      } catch {
        return null;
      }
    },
    save(document: CanvasDocument) {
      try {
        localStorage.setItem(key, serializeDocument(document));
      } catch {
        // Quota / private mode — ignore for Phase 1.
      }
    },
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export function loadOrCreateDocument(
  persistence: PersistenceService = createLocalStoragePersistence(),
): CanvasDocument {
  return persistence.load() ?? createEmptyDocument();
}
