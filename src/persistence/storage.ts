import type { CanvasDocument } from '../types/canvas';
import { DOCUMENT_VERSION, createEmptyDocument } from '../types/canvas';
import { migrateDocument } from './migrate';

const STORAGE_KEY = 'ai-study-tool:canvas-document:v1';

export interface PersistenceService {
  load(): CanvasDocument | null;
  save(document: CanvasDocument): void;
  clear(): void;
}

export function serializeDocument(document: CanvasDocument): string {
  const payload: CanvasDocument = {
    version: DOCUMENT_VERSION,
    id: document.id,
    elements: document.elements,
    camera: { ...document.camera },
  };
  return JSON.stringify(payload);
}

export function parseDocument(json: string): CanvasDocument | null {
  try {
    return migrateDocument(JSON.parse(json) as unknown);
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
