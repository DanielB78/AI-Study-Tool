import type { CanvasElement, TextElement } from '../../types/canvas';
import { createRagIndexer, toPayload, type RagIndexer } from './ragIndexer';

/**
 * Fire-and-forget RAG sync. Never blocks the editor UI.
 * Failures are logged for later full-board reindex repair.
 */
export class RagSyncController {
  private readonly indexer: RagIndexer;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(indexer: RagIndexer = createRagIndexer()) {
    this.indexer = indexer;
  }

  indexText(boardId: string, element: TextElement): void {
    const payload = toPayload(boardId, element);
    void this.indexer.indexTextElement(payload).catch((err) => {
      console.warn('[rag] indexText failed', element.id, err);
    });
  }

  updateGeometry(boardId: string, element: TextElement): void {
    void this.indexer
      .updateGeometry(boardId, element.id, {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })
      .catch((err) => {
        console.warn('[rag] updateGeometry failed', element.id, err);
      });
  }

  deleteElement(boardId: string, elementId: string): void {
    void this.indexer.deleteElement(boardId, elementId).catch((err) => {
      console.warn('[rag] deleteElement failed', elementId, err);
    });
  }

  deleteMany(boardId: string, elementIds: string[]): void {
    for (const id of elementIds) {
      this.deleteElement(boardId, id);
    }
  }

  /**
   * After undo/redo (or bulk mutations), reconcile index with current text elements.
   * Debounced so rapid history steps coalesce.
   */
  scheduleReconcile(boardId: string, elements: CanvasElement[]): void {
    if (this.reconcileTimer !== null) {
      clearTimeout(this.reconcileTimer);
    }
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      const texts = elements.filter((el): el is TextElement => el.type === 'text');
      const payloads = texts.map((el) => toPayload(boardId, el));
      void this.indexer.reindexBoard(boardId, payloads).catch((err) => {
        console.warn('[rag] reconcile/reindex failed', boardId, err);
      });
    }, 400);
  }
}

export const ragSync = new RagSyncController();
