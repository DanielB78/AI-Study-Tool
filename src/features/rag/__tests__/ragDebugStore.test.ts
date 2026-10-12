import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRagDebugStore } from '../ragDebugStore';
import type { RetrievedCandidate } from '../ragRetrieval';

const candidates: RetrievedCandidate[] = [
  {
    element_id: 'tb-a',
    element_type: 'text',
    score: 0.9,
    matched_chunks: [{ chunk_id: '1', chunk_index: 0, text: 'Gauss', similarity: 0.9 }],
    geometry: { x: 0, y: 0, width: 10, height: 10 },
  },
  {
    element_id: 'tb-b',
    element_type: 'text',
    score: 0.8,
    matched_chunks: [{ chunk_id: '2', chunk_index: 0, text: 'Sphere', similarity: 0.8 }],
    geometry: { x: 20, y: 0, width: 10, height: 10 },
  },
  {
    element_id: 'tb-c',
    element_type: 'text',
    score: 0.7,
    matched_chunks: [{ chunk_id: '3', chunk_index: 0, text: 'Flux', similarity: 0.7 }],
    geometry: { x: 40, y: 0, width: 10, height: 10 },
  },
  {
    element_id: 'tb-d',
    element_type: 'text',
    score: 0.6,
    matched_chunks: [{ chunk_id: '4', chunk_index: 0, text: 'Faraday', similarity: 0.6 }],
    geometry: { x: 60, y: 0, width: 10, height: 10 },
  },
  {
    element_id: 'tb-e',
    element_type: 'text',
    score: 0.5,
    matched_chunks: [{ chunk_id: '5', chunk_index: 0, text: 'Quantum', similarity: 0.5 }],
    geometry: { x: 80, y: 0, width: 10, height: 10 },
  },
  {
    element_id: 'tb-f',
    element_type: 'text',
    score: 0.4,
    matched_chunks: [{ chunk_id: '6', chunk_index: 0, text: 'Extra', similarity: 0.4 }],
    geometry: { x: 100, y: 0, width: 10, height: 10 },
  },
];

describe('ragDebugStore selection', () => {
  let store: ReturnType<typeof createRagDebugStore>;

  beforeEach(() => {
    store = createRagDebugStore();
    store.setState({ candidates, selectedAnchorIds: [], prompt: 'test' });
  });

  it('selectTopN(1) selects first candidate', () => {
    store.getState().selectTopN(1);
    expect(store.getState().selectedAnchorIds).toEqual(['tb-a']);
  });

  it('selectTopN(3) selects first three', () => {
    store.getState().selectTopN(3);
    expect(store.getState().selectedAnchorIds).toEqual(['tb-a', 'tb-b', 'tb-c']);
  });

  it('selectTopN(5) selects first five', () => {
    store.getState().selectTopN(5);
    expect(store.getState().selectedAnchorIds).toEqual([
      'tb-a',
      'tb-b',
      'tb-c',
      'tb-d',
      'tb-e',
    ]);
  });

  it('selectTopN with fewer candidates selects all available', () => {
    store.setState({ candidates: candidates.slice(0, 2) });
    store.getState().selectTopN(5);
    expect(store.getState().selectedAnchorIds).toEqual(['tb-a', 'tb-b']);
  });

  it('manual checkbox override after Top N', () => {
    store.getState().selectTopN(3);
    store.getState().toggleAnchor('tb-b');
    store.getState().toggleAnchor('tb-f');
    expect(store.getState().selectedAnchorIds).toEqual(['tb-a', 'tb-c', 'tb-f']);
  });

  it('clearAnchors empties selection', () => {
    store.getState().selectTopN(3);
    store.getState().clearAnchors();
    expect(store.getState().selectedAnchorIds).toEqual([]);
  });

  it('setRadius does not call fetch / LLM', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    store.getState().setRadius(500);
    store.getState().setRadius(100);
    expect(store.getState().radius).toBe(100);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
