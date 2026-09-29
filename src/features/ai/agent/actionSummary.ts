/**
 * Deterministic AI action summaries shared by View AI Plan + Interaction Memory.
 * No LLM calls.
 */

import type { CanvasOperation, Placement } from './operations';

export interface SummaryElementPreview {
  id: string;
  text?: string;
  exists?: boolean;
}

function previewPhrase(text: string | undefined, max = 48): string {
  if (!text) return 'a note';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'a note';
  const first = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1)}…`;
}

function aboutSuffix(topic: string): string {
  if (!topic || topic === 'a note') return '';
  return ` about ${topic}`;
}

function topicFromPrompt(userPrompt: string): string | undefined {
  const t = userPrompt.trim();
  if (!t) return undefined;
  const m = /\b(?:about|of|regarding)\s+(.+)$/i.exec(t);
  if (m?.[1]) return m[1]!.replace(/[.!?]+$/, '').trim();
  return undefined;
}

function placementPhrase(placement: Placement): string {
  if (placement.mode === 'viewport_default') return 'to the viewport default position';
  if (placement.mode === 'absolute') return `to (${placement.x}, ${placement.y})`;
  return `${placement.relation.replace(/_/g, ' ')} textbox ${placement.anchor_element_id}`;
}

/** Compact one-line action summary for interaction memory. */
export function summarizeAiActions(input: {
  userPrompt: string;
  operations: readonly CanvasOperation[];
  elementPreviews?: Record<string, SummaryElementPreview>;
  createdIds?: string[];
}): string {
  const { operations, userPrompt } = input;
  const previews = input.elementPreviews ?? {};
  const createdIds = input.createdIds ?? [];
  if (operations.length === 0) return 'No canvas changes were applied.';

  if (operations.length === 1) {
    const op = operations[0]!;
    if (op.type === 'create_text') {
      const id = createdIds[0] ?? 'new textbox';
      const topic = topicFromPrompt(userPrompt) || previewPhrase(op.text);
      const placement = op.placement;
      if (placement.mode === 'relative_to_element') {
        return `Created textbox ${id} ${placement.relation.replace(/_/g, ' ')} textbox ${placement.anchor_element_id} about ${topic}.`;
      }
      return `Created textbox ${id} about ${topic}.`;
    }
    if (op.type === 'update_text') {
      const prev = previews[op.target_element_id];
      let topic: string | undefined = topicFromPrompt(userPrompt);
      if (!topic && prev?.text) topic = previewPhrase(prev.text);
      if (!topic) topic = previewPhrase(op.text);
      const missing = prev && prev.exists === false ? ' (element no longer exists)' : '';
      return `Updated textbox ${op.target_element_id}${missing}${aboutSuffix(topic)}.`;
    }
    if (op.type === 'move_text') {
      return `Moved textbox ${op.target_element_id} ${placementPhrase(op.placement)}.`;
    }
    if (op.type === 'resize_text') {
      const parts: string[] = [];
      if (op.width != null) parts.push(`width ${op.width}`);
      if (op.height != null) parts.push(`height ${op.height}`);
      const dims =
        op.width != null && op.height != null
          ? `${op.width} × ${op.height}`
          : parts.join(', ');
      return `Resized textbox ${op.target_element_id} to ${dims}.`;
    }
    if (op.type === 'delete_text') {
      const prev = previews[op.target_element_id];
      const topic = previewPhrase(prev?.text);
      return `Deleted textbox ${op.target_element_id}${aboutSuffix(topic)}.`;
    }
  }

  const parts: string[] = [];
  let createIdx = 0;
  for (const op of operations) {
    if (op.type === 'create_text') {
      const id = createdIds[createIdx++] ?? 'new textbox';
      parts.push(`created ${id}`);
    } else if (op.type === 'update_text') {
      parts.push(`updated ${op.target_element_id}`);
    } else if (op.type === 'move_text') {
      parts.push(`moved ${op.target_element_id}`);
    } else if (op.type === 'resize_text') {
      parts.push(`resized ${op.target_element_id}`);
    } else if (op.type === 'delete_text') {
      parts.push(`deleted ${op.target_element_id}`);
    }
  }
  if (parts.length === 0) return 'Applied canvas operations.';
  if (parts.length === 1) return `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}.`;
  const last = parts[parts.length - 1]!;
  return `${parts
    .slice(0, -1)
    .map((p, i) => (i === 0 ? `${p[0]!.toUpperCase()}${p.slice(1)}` : p))
    .join(', ')} and ${last}.`;
}

/** Build semantic embedding document (NOT raw JSON). */
export function buildInteractionEmbeddingDocument(
  userPrompt: string,
  actionSummary: string,
): string {
  return [
    'USER REQUEST:',
    userPrompt.trim() || '(empty)',
    '',
    'ACTION PERFORMED:',
    actionSummary.trim() || '(none)',
  ].join('\n');
}

/** Human-readable plan lines for AI Plan preview (reuse in UI). */
export function describeOperationPlanLines(ops: readonly CanvasOperation[]): string[] {
  return ops.map((op, i) => {
    const n = i + 1;
    if (op.type === 'update_text') {
      const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
      return `${n}. UPDATE TEXT\n   Target: ${op.target_element_id}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
    }
    if (op.type === 'move_text') {
      const p = op.placement;
      let placementLine = '';
      if (p.mode === 'viewport_default') placementLine = 'viewport_default';
      else if (p.mode === 'absolute') placementLine = `absolute (${p.x}, ${p.y})`;
      else placementLine = `${p.relation} ${p.anchor_element_id}`;
      return `${n}. MOVE TEXTBOX\n   Target: ${op.target_element_id}\n   Placement: ${placementLine}`;
    }
    if (op.type === 'resize_text') {
      const dims = [
        op.width != null ? `width ${op.width}` : null,
        op.height != null ? `height ${op.height}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${n}. RESIZE TEXTBOX\n   Target: ${op.target_element_id}\n   New size: ${dims}`;
    }
    if (op.type === 'delete_text') {
      return `${n}. ⚠ DELETE TEXTBOX\n   Target: ${op.target_element_id}`;
    }
    const p = op.placement;
    let placementLine = '';
    if (p.mode === 'viewport_default') placementLine = 'viewport_default';
    else if (p.mode === 'absolute') placementLine = `absolute (${p.x}, ${p.y})`;
    else placementLine = `${p.relation} ${p.anchor_element_id}`;
    const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
    return `${n}. CREATE TEXT\n   Placement: ${placementLine}\n   Text: ${preview}${op.text.length > 80 ? '…' : ''}`;
  });
}
