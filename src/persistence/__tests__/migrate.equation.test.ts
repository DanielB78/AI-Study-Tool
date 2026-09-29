import { describe, expect, it } from 'vitest';
import { migrateDocument } from '../migrate';
import { DOCUMENT_VERSION } from '../../types/canvas';

describe('migrateDocument equation support', () => {
  it('loads v3 docs without equations', () => {
    const doc = migrateDocument({
      version: 3,
      id: 'board-old',
      camera: { x: 0, y: 0, zoom: 1 },
      elements: [
        {
          id: 't1',
          type: 'text',
          x: 10,
          y: 20,
          width: 100,
          height: 40,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: {},
          text: 'Hello',
          fontSize: 16,
          fontFamily: 'sans',
          fontWeight: 'normal',
          fontItalic: false,
          underline: false,
          strikethrough: false,
          color: '#111',
          alignment: 'left',
          lineHeight: 1.3,
          backgroundColor: null,
          padding: 8,
          cornerRadius: 4,
        },
      ],
    });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(DOCUMENT_VERSION);
    expect(doc!.elements).toHaveLength(1);
    expect(doc!.elements[0]!.type).toBe('text');
  });

  it('round-trips equation elements at v4', () => {
    const doc = migrateDocument({
      version: 4,
      id: 'board-eq',
      camera: { x: 1, y: 2, zoom: 1.2 },
      elements: [
        {
          id: 'eq1',
          type: 'equation',
          x: 40,
          y: 50,
          width: 120,
          height: 48,
          rotation: 0,
          zIndex: 1,
          opacity: 1,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
          metadata: { source: 'test' },
          latex: 'E=mc^2',
          fontSize: 28,
          color: '#1a1a1a',
          displayMode: 'display',
        },
      ],
    });
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(4);
    const eq = doc!.elements[0]!;
    expect(eq.type).toBe('equation');
    if (eq.type === 'equation') {
      expect(eq.latex).toBe('E=mc^2');
      expect(eq.displayMode).toBe('display');
      expect(eq.fontSize).toBe(28);
    }
  });

  it('accepts versions 1|2|3|4', () => {
    for (const version of [1, 2, 3, 4]) {
      const doc = migrateDocument({
        version,
        camera: { x: 0, y: 0, zoom: 1 },
        elements: [],
      });
      expect(doc?.version).toBe(DOCUMENT_VERSION);
    }
  });
});
