/**
 * Handwriting recognition + RAG sync pipeline.
 *
 * Detect regions → render lines → TrOCR → EmbeddingGemma index.
 * OCR text is for retrieval; LLM context uses original stroke images.
 */

import type { CanvasDocument, CanvasElement } from '../../types/canvas';
import { useCanvasStore } from '../../store/canvasStore';
import {
  detectHandwritingRegions,
  handwritingContentKey,
} from './handwritingRegionDetector';
import type {
  HandwritingDetectionResult,
  HandwritingLine,
  HandwritingRegion,
} from './handwritingTypes';
import { renderHandwritingStrokes } from './handwritingLineRenderer';
import {
  deleteHandwritingRegionIndex,
  indexHandwritingRegion,
  recognizeHandwritingLines,
  type HandwritingLineResultDto,
} from './handwritingRecognition';

export type HandwritingRecognitionStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'empty'
  | 'failed'
  | 'stale';

export interface HandwritingLineRecognition {
  lineId: string;
  recognizedText: string;
  status: HandwritingRecognitionStatus;
  error?: string | null;
}

export interface HandwritingRecognitionRecord {
  regionId: string;
  /** Stable RAG element id (content-addressed from stroke membership). */
  ragElementId: string;
  recognizedText: string;
  lineResults: HandwritingLineRecognition[];
  recognizerModel: string;
  recognizerVersion: string;
  recognitionTimestamp: number;
  sourceContentHash: string;
  status: HandwritingRecognitionStatus;
  bounds: { x: number; y: number; width: number; height: number };
  strokeIds: string[];
  lineIds: string[];
  embeddingIndexed: boolean;
  /** Cached stroke-only region crop for multimodal LLM context. */
  regionImageDataUrl?: string | null;
  error?: string | null;
}

/** Stable id from sorted stroke membership — survives pass renumbering of R1/R2. */
export function stableHandwritingRegionId(strokeIds: readonly string[]): string {
  const key = [...strokeIds].sort().join(',');
  // FNV-1a 32-bit for compact deterministic id (no crypto dependency).
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return `hw_${hex}`;
}

/**
 * Content hash of member stroke *shapes* for staleness.
 * Absolute position (x/y) is excluded so pure translation updates geometry
 * without forcing TrOCR re-recognition (req 64).
 */
export function regionSourceContentHash(
  elements: readonly CanvasElement[],
  strokeIds: readonly string[],
): string {
  const idSet = new Set(strokeIds);
  const parts: string[] = [];
  for (const el of elements) {
    if (el.type !== 'drawing' || !idSet.has(el.id)) continue;
    parts.push(
      `${el.id}:${el.points.join(',')},${el.strokeWidth},${el.strokeStyle},${el.color},${el.opacity}`,
    );
  }
  parts.sort();
  const key = parts.join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sortLinesReadingOrder(lines: HandwritingLine[]): HandwritingLine[] {
  return [...lines].sort(
    (a, b) =>
      a.rawBounds.y - b.rawBounds.y ||
      a.rawBounds.x - b.rawBounds.x ||
      a.id.localeCompare(b.id),
  );
}

export interface HandwritingSyncOptions {
  debounceMs?: number;
  /** Injectable for tests. */
  recognizeFn?: typeof recognizeHandwritingLines;
  indexFn?: typeof indexHandwritingRegion;
  deleteFn?: typeof deleteHandwritingRegionIndex;
  renderFn?: typeof renderHandwritingStrokes;
}

type Listener = () => void;

/**
 * Debounced recognizer/indexer. Derived state only — never mutates CanvasDocument.
 */
const EMPTY_RECOGNITION_RECORDS: HandwritingRecognitionRecord[] = [];

export class HandwritingRecognitionController {
  private records = new Map<string, HandwritingRecognitionRecord>();
  private knownRagIds = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private listeners = new Set<Listener>();
  private debounceMs: number;
  private recognizeFn: typeof recognizeHandwritingLines;
  private indexFn: typeof indexHandwritingRegion;
  private deleteFn: typeof deleteHandwritingRegionIndex;
  private renderFn: typeof renderHandwritingStrokes;
  private lastBoardDrawingKey = '';
  /** Stable snapshot for useSyncExternalStore — only replaced when records change. */
  private snapshot: HandwritingRecognitionRecord[] = EMPTY_RECOGNITION_RECORDS;

  constructor(options?: HandwritingSyncOptions) {
    this.debounceMs = options?.debounceMs ?? 900;
    this.recognizeFn = options?.recognizeFn ?? recognizeHandwritingLines;
    this.indexFn = options?.indexFn ?? indexHandwritingRegion;
    this.deleteFn = options?.deleteFn ?? deleteHandwritingRegionIndex;
    this.renderFn = options?.renderFn ?? renderHandwritingStrokes;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.snapshot =
      this.records.size === 0
        ? EMPTY_RECOGNITION_RECORDS
        : Array.from(this.records.values());
    for (const l of this.listeners) l();
  }

  /**
   * Cached list for React useSyncExternalStore.
   * Must return the same reference until records actually change.
   */
  getRecords(): HandwritingRecognitionRecord[] {
    return this.snapshot;
  }

  getRecord(ragElementId: string): HandwritingRecognitionRecord | undefined {
    return this.records.get(ragElementId);
  }

  /** Schedule recognition after pen idle. */
  scheduleFromCanvas(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runPipeline();
    }, this.debounceMs);
  }

  /** Force immediate run (debug Re-run / Reindex). */
  async refreshAll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.runPipeline({ force: true });
  }

  async reRecognizeRegion(ragElementId: string): Promise<void> {
    const doc = useCanvasStore.getState().document;
    const detection = detectHandwritingRegions(doc.elements);
    const region = detection.regions.find(
      (r) => stableHandwritingRegionId(r.strokeIds) === ragElementId,
    );
    if (!region) return;
    await this.processRegion(doc, detection, region, /* force */ true);
    this.emit();
  }

  private async runPipeline(options?: { force?: boolean }): Promise<void> {
    if (this.running) {
      // Coalesce: schedule another pass when current finishes.
      this.scheduleFromCanvas();
      return;
    }
    this.running = true;
    try {
      const doc = useCanvasStore.getState().document;
      const drawingKey = handwritingContentKey(doc.elements);
      if (!options?.force && drawingKey === this.lastBoardDrawingKey) {
        return;
      }
      this.lastBoardDrawingKey = drawingKey;

      const detection = detectHandwritingRegions(doc.elements);
      const liveIds = new Set<string>();

      for (const region of detection.regions) {
        const ragId = stableHandwritingRegionId(region.strokeIds);
        liveIds.add(ragId);
        await this.processRegion(doc, detection, region, options?.force ?? false);
      }

      // Cleanup stale derived records / embeddings.
      for (const id of [...this.knownRagIds]) {
        if (!liveIds.has(id)) {
          this.knownRagIds.delete(id);
          this.records.delete(id);
          try {
            await this.deleteFn(doc.id, id);
          } catch {
            // Non-fatal during cleanup.
          }
        }
      }
      for (const id of liveIds) this.knownRagIds.add(id);
      this.emit();
    } finally {
      this.running = false;
    }
  }

  private async processRegion(
    doc: CanvasDocument,
    detection: HandwritingDetectionResult,
    region: HandwritingRegion,
    force: boolean,
  ): Promise<void> {
    const ragId = stableHandwritingRegionId(region.strokeIds);
    const hash = regionSourceContentHash(doc.elements, region.strokeIds);
    const existing = this.records.get(ragId);

    if (
      !force &&
      existing &&
      existing.sourceContentHash === hash &&
      (existing.status === 'ready' || existing.status === 'empty')
    ) {
      // Geometry may have moved without content change — update bounds only.
      if (
        existing.bounds.x !== region.rawBounds.x ||
        existing.bounds.y !== region.rawBounds.y ||
        existing.bounds.width !== region.rawBounds.width ||
        existing.bounds.height !== region.rawBounds.height
      ) {
        let regionImageDataUrl = existing.regionImageDataUrl ?? null;
        try {
          const typicalH = Math.max(detection.scale.typicalStrokeHeight, 8);
          const rendered = await this.renderFn(
            doc,
            region.strokeIds,
            region.rawBounds,
            { paddingWorld: typicalH * 0.3, minDimension: 64 },
          );
          regionImageDataUrl = rendered.dataUrl;
        } catch {
          /* keep prior cache */
        }
        const updated = {
          ...existing,
          bounds: { ...region.rawBounds },
          regionImageDataUrl,
        };
        this.records.set(ragId, updated);
        if (updated.status === 'ready' && updated.recognizedText.trim()) {
          try {
            await this.indexFn({
              board_id: doc.id,
              element_id: ragId,
              element_type: 'handwriting_region',
              text: updated.recognizedText,
              x: region.rawBounds.x,
              y: region.rawBounds.y,
              width: Math.max(region.rawBounds.width, 1),
              height: Math.max(region.rawBounds.height, 1),
              element_revision: hash,
              metadata: {
                source_type: 'handwriting_region',
                stroke_ids: region.strokeIds,
                line_ids: region.lineIds,
                ocr_model: updated.recognizerModel,
              },
            });
          } catch {
            /* ignore */
          }
        }
      }
      return;
    }

    const pending: HandwritingRecognitionRecord = {
      regionId: region.id,
      ragElementId: ragId,
      recognizedText: existing?.recognizedText ?? '',
      lineResults: existing?.lineResults ?? [],
      recognizerModel: existing?.recognizerModel ?? '',
      recognizerVersion: existing?.recognizerVersion ?? '',
      recognitionTimestamp: Date.now(),
      sourceContentHash: hash,
      status: 'processing',
      bounds: { ...region.rawBounds },
      strokeIds: [...region.strokeIds],
      lineIds: [...region.lineIds],
      embeddingIndexed: false,
    };
    this.records.set(ragId, pending);
    this.emit();

    const regionLines = sortLinesReadingOrder(
      detection.lines.filter((l) => region.lineIds.includes(l.id)),
    );

    try {
      const typicalH = Math.max(detection.scale.typicalStrokeHeight, 8);
      const linePad = typicalH * 0.25;
      const linePayloads: { line_id: string; image_data: string }[] = [];

      for (const line of regionLines) {
        const rendered = await this.renderFn(
          doc,
          line.strokeIds,
          line.rawBounds,
          { paddingWorld: linePad, minDimension: 64 },
        );
        linePayloads.push({
          line_id: line.id,
          image_data: rendered.dataUrl,
        });
      }

      if (linePayloads.length === 0) {
        this.records.set(ragId, {
          ...pending,
          status: 'empty',
          recognizedText: '',
          lineResults: [],
        });
        await this.deleteFn(doc.id, ragId).catch(() => undefined);
        return;
      }

      const ocr = await this.recognizeFn({
        boardId: doc.id,
        regionId: ragId,
        lines: linePayloads,
      });

      const lineResults: HandwritingLineRecognition[] = ocr.line_results.map(
        (r: HandwritingLineResultDto) => ({
          lineId: r.line_id,
          recognizedText: r.recognized_text,
          status:
            r.status === 'ready'
              ? 'ready'
              : r.status === 'empty'
                ? 'empty'
                : 'failed',
          error: r.error,
        }),
      );

      const combined = (ocr.combined_text || '').trim();
      const status: HandwritingRecognitionStatus =
        ocr.status === 'ready'
          ? 'ready'
          : ocr.status === 'empty'
            ? 'empty'
            : 'failed';

      let embeddingIndexed = false;
      let regionImageDataUrl: string | null = null;
      try {
        const regionRendered = await this.renderFn(
          doc,
          region.strokeIds,
          region.rawBounds,
          { paddingWorld: typicalH * 0.3, minDimension: 64 },
        );
        regionImageDataUrl = regionRendered.dataUrl;
      } catch {
        regionImageDataUrl = null;
      }

      if (ocr.usable_for_embedding && combined) {
        await this.indexFn({
          board_id: doc.id,
          element_id: ragId,
          element_type: 'handwriting_region',
          text: combined,
          x: region.rawBounds.x,
          y: region.rawBounds.y,
          width: Math.max(region.rawBounds.width, 1),
          height: Math.max(region.rawBounds.height, 1),
          element_revision: hash,
          metadata: {
            source_type: 'handwriting_region',
            stroke_ids: region.strokeIds,
            line_ids: region.lineIds,
            ocr_model: ocr.recognizer_model,
            ocr_provider: ocr.recognizer_provider,
            line_results: lineResults,
          },
        });
        embeddingIndexed = true;
      } else {
        await this.deleteFn(doc.id, ragId).catch(() => undefined);
      }

      this.records.set(ragId, {
        ...pending,
        recognizedText: combined,
        lineResults,
        recognizerModel: ocr.recognizer_model,
        recognizerVersion: ocr.recognizer_provider,
        recognitionTimestamp: Date.now(),
        status,
        embeddingIndexed,
        regionImageDataUrl,
        error: status === 'failed' ? 'TrOCR recognition failed' : null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recognition failed';
      this.records.set(ragId, {
        ...pending,
        status: 'failed',
        error: message,
        embeddingIndexed: false,
      });
    }
  }
}

export const handwritingRecognitionController =
  new HandwritingRecognitionController();

/** Wire canvas drawing mutations → debounced OCR/index. */
export function startHandwritingRecognitionSync(): () => void {
  return useCanvasStore.subscribe((state, prev) => {
    if (state.document.elements === prev.document.elements) return;
    const key = handwritingContentKey(state.document.elements);
    const prevKey = handwritingContentKey(prev.document.elements);
    if (key === prevKey) return;
    handwritingRecognitionController.scheduleFromCanvas();
  });
}

/** Lookup live recognition for RAG resolve. */
export function resolveHandwritingRecognition(
  ragElementId: string,
): HandwritingRecognitionRecord | null {
  return handwritingRecognitionController.getRecord(ragElementId) ?? null;
}

/** Live ready handwriting regions as spatial-eligible records. */
export function handwritingRegionsAsSpatial(): Array<{
  id: string;
  type: 'handwriting_region';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}> {
  return handwritingRecognitionController
    .getRecords()
    .filter((r) => r.status === 'ready' && r.recognizedText.trim())
    .map((r) => ({
      id: r.ragElementId,
      type: 'handwriting_region' as const,
      x: r.bounds.x,
      y: r.bounds.y,
      width: r.bounds.width,
      height: r.bounds.height,
      text: r.recognizedText,
    }));
}
