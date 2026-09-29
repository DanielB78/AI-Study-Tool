/**
 * Deterministic AI action summaries shared by View AI Plan + Interaction Memory.
 * No LLM calls.
 */

import type { CanvasOperation, Placement } from './operations';
import { describeStylePatch, summarizeStylePatch, type TextStylePatch } from './textStyle';
import { validateLatex } from '../../equations/latex';

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

function placementPhrase(placement: Placement, noun = 'textbox'): string {
  if (placement.mode === 'viewport_default') return 'to the viewport default position';
  if (placement.mode === 'absolute') return `to (${placement.x}, ${placement.y})`;
  if (placement.anchor_element_id) {
    return `${placement.relation.replace(/_/g, ' ')} ${noun} ${placement.anchor_element_id}`;
  }
  if (placement.anchor_operation_index !== undefined) {
    return `${placement.relation.replace(/_/g, ' ')} operation ${placement.anchor_operation_index}`;
  }
  return `${placement.relation.replace(/_/g, ' ')} unknown anchor`;
}

function joinAnd(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function formatPlacementLine(p: Placement): string {
  if (p.mode === 'viewport_default') return 'viewport_default';
  if (p.mode === 'absolute') return `absolute (${p.x}, ${p.y})`;
  if (p.anchor_element_id) return `${p.relation} ${p.anchor_element_id}`;
  if (p.anchor_operation_index !== undefined) {
    return `${p.relation} op[${p.anchor_operation_index}]`;
  }
  return p.relation;
}

/** Natural one-line phrasing for a single update_text_style. */
export function summarizeStyleUpdate(id: string, patch: TextStylePatch): string {
  const hasColor = patch.text_color !== undefined;
  const hasBg = patch.background_color !== undefined;
  const flagsOn: string[] = [];
  const flagsOff: string[] = [];
  if (patch.bold === true) flagsOn.push('bold');
  if (patch.bold === false) flagsOff.push('not bold');
  if (patch.italic === true) flagsOn.push('italic');
  if (patch.italic === false) flagsOff.push('not italic');
  if (patch.underline === true) flagsOn.push('underlined');
  if (patch.underline === false) flagsOff.push('not underlined');

  const onlyPositiveFlags =
    !hasColor && !hasBg && flagsOn.length > 0 && flagsOff.length === 0;
  if (onlyPositiveFlags) {
    return `Made textbox ${id} ${joinAnd(flagsOn)}.`;
  }

  const onlyTextColor =
    hasColor && !hasBg && flagsOn.length === 0 && flagsOff.length === 0;
  if (onlyTextColor) {
    return `Changed textbox ${id} to ${patch.text_color} text.`;
  }

  const onlyFill =
    !hasColor && hasBg && flagsOn.length === 0 && flagsOff.length === 0;
  if (onlyFill) {
    if (patch.background_color === null) {
      return `Cleared textbox ${id} background.`;
    }
    return `Filled textbox ${id} ${patch.background_color}.`;
  }

  return `Styled textbox ${id}: ${summarizeStylePatch(patch)}.`;
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
        return `Created textbox ${id} ${placementPhrase(placement)} about ${topic}.`;
      }
      return `Created textbox ${id} about ${topic}.`;
    }
    if (op.type === 'create_equation') {
      const id = createdIds[0] ?? 'new equation';
      const topic = topicFromPrompt(userPrompt) || previewPhrase(op.latex);
      const placement = op.placement;
      if (placement.mode === 'relative_to_element') {
        return `Created equation ${id} ${placementPhrase(placement, 'element')} (${topic}).`;
      }
      return `Created equation ${id} (${topic}).`;
    }
    if (op.type === 'update_text') {
      const prev = previews[op.target_element_id];
      let topic: string | undefined = topicFromPrompt(userPrompt);
      if (!topic && prev?.text) topic = previewPhrase(prev.text);
      if (!topic) topic = previewPhrase(op.text);
      const missing = prev && prev.exists === false ? ' (element no longer exists)' : '';
      return `Updated textbox ${op.target_element_id}${missing}${aboutSuffix(topic)}.`;
    }
    if (op.type === 'update_equation') {
      const topic = topicFromPrompt(userPrompt) || previewPhrase(op.latex);
      return `Updated equation ${op.target_element_id}${aboutSuffix(topic)}.`;
    }
    if (op.type === 'move_text') {
      return `Moved textbox ${op.target_element_id} ${placementPhrase(op.placement)}.`;
    }
    if (op.type === 'move_equation') {
      return `Moved equation ${op.target_element_id} ${placementPhrase(op.placement, 'element')}.`;
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
    if (op.type === 'resize_equation') {
      const parts: string[] = [];
      if (op.width != null) parts.push(`width ${op.width}`);
      if (op.height != null) parts.push(`height ${op.height}`);
      const dims =
        op.width != null && op.height != null
          ? `${op.width} × ${op.height}`
          : parts.join(', ');
      return `Resized equation ${op.target_element_id} to ${dims}.`;
    }
    if (op.type === 'delete_text') {
      const prev = previews[op.target_element_id];
      const topic = previewPhrase(prev?.text);
      return `Deleted textbox ${op.target_element_id}${aboutSuffix(topic)}.`;
    }
    if (op.type === 'delete_equation') {
      const prev = previews[op.target_element_id];
      const topic = previewPhrase(prev?.text);
      return `Deleted equation ${op.target_element_id}${aboutSuffix(topic)}.`;
    }
    if (op.type === 'update_text_style') {
      return summarizeStyleUpdate(op.target_element_id, op.style);
    }
  }

  const parts: string[] = [];
  let createIdx = 0;
  for (const op of operations) {
    if (op.type === 'create_text') {
      const id = createdIds[createIdx++] ?? 'new textbox';
      parts.push(`created ${id}`);
    } else if (op.type === 'create_equation') {
      const id = createdIds[createIdx++] ?? 'new equation';
      parts.push(`created equation ${id}`);
    } else if (op.type === 'update_text') {
      parts.push(`updated ${op.target_element_id}`);
    } else if (op.type === 'update_equation') {
      parts.push(`updated equation ${op.target_element_id}`);
    } else if (op.type === 'move_text') {
      parts.push(`moved ${op.target_element_id}`);
    } else if (op.type === 'move_equation') {
      parts.push(`moved equation ${op.target_element_id}`);
    } else if (op.type === 'resize_text') {
      parts.push(`resized ${op.target_element_id}`);
    } else if (op.type === 'resize_equation') {
      parts.push(`resized equation ${op.target_element_id}`);
    } else if (op.type === 'delete_text') {
      parts.push(`deleted ${op.target_element_id}`);
    } else if (op.type === 'delete_equation') {
      parts.push(`deleted equation ${op.target_element_id}`);
    } else if (op.type === 'update_text_style') {
      parts.push(`styled ${op.target_element_id}`);
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
    if (op.type === 'update_equation') {
      const preview = op.latex.replace(/\s+/g, ' ').slice(0, 80);
      const validation = validateLatex(op.latex, true);
      const lines = [
        `${n}. UPDATE EQUATION`,
        `   Target: ${op.target_element_id}`,
        `   LaTeX: ${preview}${op.latex.length > 80 ? '…' : ''}`,
      ];
      if (!validation.ok) {
        lines.push(`   ⚠ Validation: ${validation.error ?? 'invalid LaTeX'}`);
      }
      return lines.join('\n');
    }
    if (op.type === 'move_text') {
      return `${n}. MOVE TEXTBOX\n   Target: ${op.target_element_id}\n   Placement: ${formatPlacementLine(op.placement)}`;
    }
    if (op.type === 'move_equation') {
      return `${n}. MOVE EQUATION\n   Target: ${op.target_element_id}\n   Placement: ${formatPlacementLine(op.placement)}`;
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
    if (op.type === 'resize_equation') {
      const dims = [
        op.width != null ? `width ${op.width}` : null,
        op.height != null ? `height ${op.height}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      return `${n}. RESIZE EQUATION\n   Target: ${op.target_element_id}\n   New size: ${dims}`;
    }
    if (op.type === 'delete_text') {
      return `${n}. ⚠ DELETE TEXTBOX\n   Target: ${op.target_element_id}`;
    }
    if (op.type === 'delete_equation') {
      return `${n}. ⚠ DELETE EQUATION\n   Target: ${op.target_element_id}`;
    }
    if (op.type === 'update_text_style') {
      const styleLines = describeStylePatch(op.style)
        .map((line) => `   ${line}`)
        .join('\n');
      return `${n}. STYLE TEXTBOX\n   Target: ${op.target_element_id}\n${styleLines}`;
    }
    if (op.type === 'create_equation') {
      const preview = op.latex.replace(/\s+/g, ' ').slice(0, 80);
      const validation = validateLatex(op.latex, true);
      const lines = [
        `${n}. CREATE EQUATION`,
        `   Placement: ${formatPlacementLine(op.placement)}`,
        `   LaTeX: ${preview}${op.latex.length > 80 ? '…' : ''}`,
      ];
      if (!validation.ok) {
        lines.push(`   ⚠ Validation: ${validation.error ?? 'invalid LaTeX'}`);
      }
      return lines.join('\n');
    }
    // create_text
    const preview = op.text.replace(/\s+/g, ' ').slice(0, 80);
    const lines = [
      `${n}. CREATE TEXT`,
      `   Placement: ${formatPlacementLine(op.placement)}`,
      `   Text: ${preview}${op.text.length > 80 ? '…' : ''}`,
    ];
    if (op.style) {
      for (const line of describeStylePatch(op.style)) {
        lines.push(`   ${line}`);
      }
    }
    return lines.join('\n');
  });
}
