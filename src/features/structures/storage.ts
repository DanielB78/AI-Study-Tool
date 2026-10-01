/**
 * Persist note structures outside CanvasDocument (cross-board library).
 */

import type { NoteStructure } from './types';
import { NOTE_STRUCTURE_VERSION } from './types';

const STORAGE_KEY = 'ai-study-tool:note-structures:v1';

export interface NoteStructureLibrary {
  version: typeof NOTE_STRUCTURE_VERSION;
  structures: NoteStructure[];
}

function emptyLibrary(): NoteStructureLibrary {
  return { version: NOTE_STRUCTURE_VERSION, structures: [] };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function serializeStructureLibrary(library: NoteStructureLibrary): string {
  return JSON.stringify({
    version: NOTE_STRUCTURE_VERSION,
    structures: library.structures,
  });
}

export function parseStructureLibrary(json: string): NoteStructureLibrary {
  try {
    const raw = JSON.parse(json) as unknown;
    if (!isObject(raw) || !Array.isArray(raw.structures)) return emptyLibrary();
    const structures = raw.structures.filter(
      (s): s is NoteStructure =>
        isObject(s) &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        Array.isArray(s.fields),
    );
    return { version: NOTE_STRUCTURE_VERSION, structures };
  } catch {
    return emptyLibrary();
  }
}

export function loadStructureLibrary(): NoteStructureLibrary {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLibrary();
    return parseStructureLibrary(raw);
  } catch {
    return emptyLibrary();
  }
}

export function saveStructureLibrary(library: NoteStructureLibrary): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeStructureLibrary(library));
  } catch {
    // quota / private mode
  }
}

export { STORAGE_KEY as NOTE_STRUCTURE_STORAGE_KEY };
