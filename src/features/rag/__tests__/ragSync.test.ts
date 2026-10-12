import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRagIndexer } from '../ragIndexer';
import { RagSyncController } from '../ragSync';
import type { TextElement } from '../../../types/canvas';

function sampleText(partial?: Partial<TextElement>): TextElement {
  return {
    id: 'el-1',
    type: 'text',
    text: 'Hello world',
    x: 10,
    y: 20,
    width: 200,
    height: 80,
    rotation: 0,
    zIndex: 1,
    opacity: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
    fontSize: 18,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontItalic: false,
    underline: false,
    strikethrough: false,
    color: '#000',
    alignment: 'left',
    lineHeight: 1.35,
    backgroundColor: '#fff',
    padding: 8,
    cornerRadius: 8,
    ...partial,
  };
}

describe('ragIndexer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('PUTs text element payloads', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ element_id: 'el-1', chunk_count: 1, content_changed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const indexer = createRagIndexer('http://example.test');
    const result = await indexer.indexTextElement({
      board_id: 'b1',
      element_id: 'el-1',
      element_type: 'text',
      text: 'hi',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(result.chunk_count).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/api/rag/elements/text',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

describe('RagSyncController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not await indexing (fire-and-forget) and swallows failures', async () => {
    const indexTextElement = vi.fn(async () => {
      throw new Error('network down');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sync = new RagSyncController({
      indexTextElement,
      updateGeometry: vi.fn(),
      deleteElement: vi.fn(),
      reindexBoard: vi.fn(),
    });

    // Must return immediately even though the promise rejects.
    sync.indexText('board', sampleText());
    expect(indexTextElement).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
  });

  it('updates geometry after movement without reindexing text', () => {
    const updateGeometry = vi.fn(async () => {});
    const indexTextElement = vi.fn(async () => ({
      element_id: 'el-1',
      chunk_count: 1,
      content_changed: false,
    }));
    const sync = new RagSyncController({
      indexTextElement,
      updateGeometry,
      deleteElement: vi.fn(),
      reindexBoard: vi.fn(),
    });
    sync.updateGeometry('board', sampleText({ x: 50, y: 60 }));
    expect(updateGeometry).toHaveBeenCalledWith('board', 'el-1', {
      x: 50,
      y: 60,
      width: 200,
      height: 80,
    });
    expect(indexTextElement).not.toHaveBeenCalled();
  });

  it('deletes element index entries', () => {
    const deleteElement = vi.fn(async () => {});
    const sync = new RagSyncController({
      indexTextElement: vi.fn(),
      updateGeometry: vi.fn(),
      deleteElement,
      reindexBoard: vi.fn(),
    });
    sync.deleteMany('board', ['a', 'b']);
    expect(deleteElement).toHaveBeenCalledWith('board', 'a');
    expect(deleteElement).toHaveBeenCalledWith('board', 'b');
  });

  it('debounces reconcile/reindex after undo-style changes', async () => {
    vi.useFakeTimers();
    const reindexBoard = vi.fn(async () => {});
    const sync = new RagSyncController({
      indexTextElement: vi.fn(),
      updateGeometry: vi.fn(),
      deleteElement: vi.fn(),
      reindexBoard,
    });
    const el = sampleText();
    sync.scheduleReconcile('board', [el]);
    sync.scheduleReconcile('board', [el]);
    expect(reindexBoard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(reindexBoard).toHaveBeenCalledTimes(1);
    expect(reindexBoard).toHaveBeenCalledWith(
      'board',
      expect.arrayContaining([expect.objectContaining({ element_id: 'el-1' })]),
    );
  });
});
