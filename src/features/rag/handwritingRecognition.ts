/**
 * Frontend client for local TrOCR handwriting recognition + indexing.
 */

import { RAG_API_BASE_URL } from './config';

export interface HandwritingLineImagePayload {
  line_id: string;
  image_data: string;
}

export interface HandwritingLineResultDto {
  line_id: string;
  recognized_text: string;
  status: 'ready' | 'empty' | 'failed';
  error?: string | null;
}

export interface HandwritingRecognizeResponseDto {
  region_id: string | null;
  combined_text: string;
  line_results: HandwritingLineResultDto[];
  recognizer_model: string;
  recognizer_provider: string;
  status: 'ready' | 'empty' | 'failed';
  usable_for_embedding: boolean;
}

export interface HandwritingIndexPayload {
  board_id: string;
  element_id: string;
  element_type: 'handwriting_region';
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  element_revision?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface HandwritingIndexResult {
  element_id: string;
  chunk_count: number;
  content_changed: boolean;
  embeddings_updated?: boolean;
}

export async function recognizeHandwritingLines(input: {
  boardId?: string;
  regionId?: string;
  lines: HandwritingLineImagePayload[];
  baseUrl?: string;
}): Promise<HandwritingRecognizeResponseDto> {
  const baseUrl = input.baseUrl ?? RAG_API_BASE_URL;
  const res = await fetch(`${baseUrl}/api/rag/handwriting/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: input.boardId ?? null,
      region_id: input.regionId ?? null,
      lines: input.lines,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Handwriting OCR failed (${res.status}): ${body}`);
  }
  return (await res.json()) as HandwritingRecognizeResponseDto;
}

export async function indexHandwritingRegion(
  payload: HandwritingIndexPayload,
  baseUrl: string = RAG_API_BASE_URL,
): Promise<HandwritingIndexResult> {
  const res = await fetch(`${baseUrl}/api/rag/handwriting/elements`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Handwriting index failed (${res.status}): ${body}`);
  }
  return (await res.json()) as HandwritingIndexResult;
}

export async function deleteHandwritingRegionIndex(
  boardId: string,
  regionId: string,
  baseUrl: string = RAG_API_BASE_URL,
): Promise<void> {
  const res = await fetch(
    `${baseUrl}/api/rag/elements/${encodeURIComponent(boardId)}/${encodeURIComponent(regionId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Handwriting index delete failed (${res.status}): ${body}`);
  }
}
