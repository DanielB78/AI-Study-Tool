import type { EquationElement, TextElement } from '../../types/canvas';
import { RAG_API_BASE_URL } from './config';

export type IndexableCanvasElement = TextElement | EquationElement;

export interface ElementIndexPayload {
  board_id: string;
  element_id: string;
  element_type: 'text' | 'equation';
  /** Prose for text; LaTeX source for equations. */
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** @deprecated Prefer ElementIndexPayload — kept for existing call sites. */
export type TextIndexPayload = ElementIndexPayload;

export interface IndexResult {
  element_id: string;
  chunk_count: number;
  content_changed: boolean;
}

export interface RagIndexer {
  indexTextElement(payload: ElementIndexPayload): Promise<IndexResult>;
  updateGeometry(
    boardId: string,
    elementId: string,
    geometry: { x: number; y: number; width: number; height: number },
  ): Promise<void>;
  deleteElement(boardId: string, elementId: string): Promise<void>;
  reindexBoard(boardId: string, elements: ElementIndexPayload[]): Promise<void>;
}

export function toPayload(
  boardId: string,
  el: IndexableCanvasElement,
): ElementIndexPayload {
  return {
    board_id: boardId,
    element_id: el.id,
    element_type: el.type,
    text: el.type === 'text' ? el.text : el.latex,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  };
}

export function createRagIndexer(baseUrl: string = RAG_API_BASE_URL): RagIndexer {
  return {
    async indexTextElement(payload) {
      const res = await fetch(`${baseUrl}/api/rag/elements/text`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RAG index failed (${res.status}): ${body}`);
      }
      return (await res.json()) as IndexResult;
    },

    async updateGeometry(boardId, elementId, geometry) {
      const res = await fetch(
        `${baseUrl}/api/rag/elements/${encodeURIComponent(boardId)}/${encodeURIComponent(elementId)}/geometry`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geometry),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RAG geometry update failed (${res.status}): ${body}`);
      }
    },

    async deleteElement(boardId, elementId) {
      const res = await fetch(
        `${baseUrl}/api/rag/elements/${encodeURIComponent(boardId)}/${encodeURIComponent(elementId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RAG delete failed (${res.status}): ${body}`);
      }
    },

    async reindexBoard(boardId, elements) {
      const res = await fetch(
        `${baseUrl}/api/rag/boards/${encodeURIComponent(boardId)}/reindex`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ elements }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`RAG reindex failed (${res.status}): ${body}`);
      }
    },
  };
}

export const ragIndexer: RagIndexer = createRagIndexer();
