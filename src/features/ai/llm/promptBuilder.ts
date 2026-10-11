/**
 * LlmPromptBuilder — builds the COMPLETE text that would be sent to an LLM.
 * Now includes the Canvas Editor Agent instructions + JSON output contract.
 *
 * Image attachments are listed as markers in the text prompt; actual image
 * bytes travel separately as multimodal input (see BuiltLlmPrompt.imageAttachments).
 */

import type {
  RagContext,
  RagContextElement,
  RagContextImageAttachment,
} from '../../rag/contextBuilder';
import {
  formatNoStructureSelected,
  formatNoteStructureForPrompt,
} from '../../structures/formatForPrompt';
import type { NoteStructure } from '../../structures/types';
import {
  CANVAS_EDITOR_RESPONSE_INSTRUCTIONS,
  CANVAS_EDITOR_SYSTEM_PROMPT,
} from '../agent/prompts/loadAgentPrompt';
import { CANVAS_AGENT_OUTPUT_CONTRACT } from '../agent/operations';

export interface BuiltLlmPrompt {
  /** Original user request (never overwritten by system/context). */
  userPrompt: string;
  systemInstructions: string;
  /** Canvas context section body (without outer USER REQUEST). */
  ragContextSection: string;
  /** Selected note structure section (output format — not knowledge). */
  noteStructureSection: string;
  /** Full deterministic prompt ready to paste into ChatGPT. */
  finalLlmPrompt: string;
  /** Multimodal image attachments (actual assets — not encoded into prompt text). */
  imageAttachments: RagContextImageAttachment[];
}

function formatRetrieval(el: RagContextElement): string[] {
  const lines: string[] = [];
  const kinds = [...new Set(el.sources.map((s) => s.type))];
  lines.push('RETRIEVAL:');
  lines.push(kinds.join(' + '));

  if (el.sources.some((s) => s.type === 'explicit_selection')) {
    lines.push('');
    lines.push('EXPLICIT SELECTION: yes');
  }

  if (el.sources.some((s) => s.type === 'explicit_region_selection')) {
    lines.push('');
    lines.push('EXPLICIT REGION SELECTION: yes');
  }

  if (el.similarity !== null) {
    lines.push('');
    lines.push('SIMILARITY:');
    lines.push(el.similarity.toFixed(4));
  }

  const spatial = el.sources.filter((s) => s.type === 'spatial');
  for (const s of spatial) {
    if (s.type !== 'spatial') continue;
    lines.push('');
    lines.push('SPATIAL ANCHOR:');
    lines.push(s.anchor_element_id);
    lines.push('');
    lines.push('DISTANCE:');
    lines.push(s.distance.toFixed(1));
  }

  const neighbors = el.sources.filter((s) => s.type === 'semantic_neighbor');
  for (const s of neighbors) {
    if (s.type !== 'semantic_neighbor') continue;
    lines.push('');
    lines.push('SEMANTIC NEIGHBOR:');
    lines.push(`root: ${s.root_anchor_element_id}`);
    lines.push(`parent: ${s.parent_element_id}`);
    lines.push(`depth: ${s.depth}`);
    lines.push(`similarity: ${s.similarity.toFixed(4)}`);
  }
  return lines;
}

function formatElementBlock(el: RagContextElement): string {
  const g = el.geometry;
  if (el.element_type === 'graph') {
    return [
      el.text || 'GRAPH ELEMENT\n\n(empty graph)',
      '',
      'POSITION:',
      `x: ${g.x}`,
      `y: ${g.y}`,
      `width: ${g.width}`,
      `height: ${g.height}`,
      '',
      ...formatRetrieval(el),
    ].join('\n');
  }

  if (el.element_type === 'handwriting_region') {
    return [
      'HANDWRITTEN CANVAS CONTEXT',
      '',
      `Element/Region ID: ${el.element_id}`,
      `TYPE: handwriting_region`,
      '',
      'This region was retrieved because its local OCR transcription was semantically related to the request.',
      'The ORIGINAL handwritten region is attached as an image.',
      'Interpret the attached handwriting directly.',
      '',
      ...(el.text.trim()
        ? [
            'DERIVED OCR TRANSCRIPTION — MAY CONTAIN ERRORS (retrieval aid only):',
            el.text,
            '',
          ]
        : []),
      'ATTACHED HANDWRITING REGION IMAGE:',
      el.element_id,
      '',
      'POSITION:',
      `x: ${g.x}`,
      `y: ${g.y}`,
      `width: ${g.width}`,
      `height: ${g.height}`,
      '',
      ...formatRetrieval(el),
    ].join('\n');
  }

  const isImage = el.element_type === 'image';
  const contentLines = isImage
    ? [
        'ATTACHED CANVAS IMAGE:',
        el.element_id,
        '(image bytes supplied as multimodal attachment — not described here)',
      ]
    : ['TEXT:', el.text || '(empty)'];

  const parts = [
    'CANVAS ELEMENT',
    '',
    `ID: ${el.element_id}`,
    `TYPE: ${el.element_type}`,
    '',
    ...contentLines,
    '',
    'POSITION:',
    `x: ${g.x}`,
    `y: ${g.y}`,
    `width: ${g.width}`,
    `height: ${g.height}`,
    '',
    ...formatRetrieval(el),
  ];
  return parts.join('\n');
}

function formatImageContextSection(
  attachments: readonly RagContextImageAttachment[],
): string {
  if (attachments.length === 0) return '';

  const regionAtts = attachments.filter(
    (a) => a.selection_reason === 'explicit_region_selection',
  );
  const handwritingAtts = attachments.filter(
    (a) =>
      a.element_type === 'handwriting_region' ||
      a.selection_reason === 'semantic_handwriting',
  );
  const imageAtts = attachments.filter(
    (a) =>
      a.selection_reason !== 'explicit_region_selection' &&
      a.element_type !== 'handwriting_region' &&
      a.selection_reason !== 'semantic_handwriting',
  );

  const parts: string[] = [];

  if (regionAtts.length > 0) {
    const blocks = regionAtts.map((att) => {
      const g = att.geometry;
      return [
        'SELECTED CANVAS REGION IMAGE',
        '',
        'Attachment required — attach this image alongside the prompt.',
        'Status: Attachment required',
        '',
        'SOURCE: explicit_region_selection',
        '',
        'BOUNDS:',
        `x: ${g.x}`,
        `y: ${g.y}`,
        `width: ${g.width}`,
        `height: ${g.height}`,
        '',
        'INCLUDED ELEMENT IDS:',
        att.region?.included_element_ids.join(', ') || '(none)',
        '',
        'ATTACHED CANVAS REGION IMAGE:',
        att.element_id,
        '',
        '[MANUAL ATTACHMENT]',
        `Attach the selected canvas region image (${att.element_id}) as a multimodal image input.`,
        'Clipboard text cannot include the binary image — attach the thumbnail/export manually.',
      ].join('\n');
    });
    parts.push(
      [
        'SELECTED CANVAS REGION',
        '',
        'The user explicitly selected the following region of the canvas.',
        'The corresponding image is attached.',
        'The region may contain handwritten text, mathematics, sketches, diagrams, or relationships between canvas elements.',
        'Use the visual content when interpreting references such as:',
        '"this"',
        '"these"',
        '"what I wrote"',
        '"this diagram"',
        '',
        'Do NOT invent a machine transcription.',
        '',
        blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
      ].join('\n'),
    );
  }

  if (handwritingAtts.length > 0) {
    const blocks = handwritingAtts.map((att) => {
      const g = att.geometry;
      return [
        'HANDWRITTEN REGION',
        '',
        `ID: ${att.element_id}`,
        `SOURCE: ${att.selection_reason}`,
        att.nearest_distance != null
          ? `DISTANCE: ${att.nearest_distance.toFixed(1)}`
          : null,
        '',
        'Attachment required — attach this handwriting region image alongside the prompt.',
        'Status: Attachment required',
        '',
        ...(att.ocr_transcription
          ? [
              'DERIVED OCR TRANSCRIPTION — MAY CONTAIN ERRORS (retrieval aid only):',
              att.ocr_transcription,
              '',
            ]
          : []),
        'BOUNDS:',
        `x: ${g.x}`,
        `y: ${g.y}`,
        `width: ${g.width}`,
        `height: ${g.height}`,
        '',
        'ATTACHED HANDWRITING REGION IMAGE:',
        att.element_id,
        '',
        '[MANUAL ATTACHMENT]',
        `Attach handwriting region ${att.element_id} as a multimodal image input.`,
        'Interpret the original handwriting image; do not treat OCR text as ground truth.',
      ]
        .filter((line): line is string => line != null)
        .join('\n');
    });
    parts.push(
      [
        'HANDWRITTEN CANVAS CONTEXT',
        '',
        'These regions were retrieved via local OCR text used only for semantic search.',
        'The ORIGINAL handwritten strokes are attached as images.',
        'Interpret the attached handwriting directly.',
        '',
        blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
      ].join('\n'),
    );
  }

  if (imageAtts.length > 0) {
    const blocks = imageAtts.map((att) => {
      const reasonLines: string[] = [];
      if (att.selection_reason === 'explicit_selection') {
        reasonLines.push('Included because the user explicitly selected this image.');
      } else {
        const spatial = att.sources.find((s) => s.type === 'spatial');
        if (spatial && spatial.type === 'spatial') {
          reasonLines.push(
            `The following image was included because it is spatially near ${spatial.anchor_element_id}.`,
          );
        } else {
          reasonLines.push(
            'The following image was included because it is spatially near a semantic anchor.',
          );
        }
      }
      for (const s of att.sources) {
        if (s.type === 'spatial') {
          reasonLines.push(`SPATIAL ANCHOR: ${s.anchor_element_id}`);
          reasonLines.push(`DISTANCE: ${s.distance.toFixed(1)}`);
        }
      }
      return [
        'IMAGE',
        '',
        ...reasonLines,
        '',
        'IMAGE ELEMENT ID:',
        att.element_id,
        '',
        'ATTACHED CANVAS IMAGE:',
        att.element_id,
        '',
        'BOUNDS:',
        `x: ${att.geometry.x}`,
        `y: ${att.geometry.y}`,
        `width: ${att.geometry.width}`,
        `height: ${att.geometry.height}`,
      ].join('\n');
    });
    parts.push(
      [
        'CANVAS IMAGE CONTEXT',
        '',
        'Inspect the attached images directly. Do not invent captions or descriptions.',
        '',
        blocks.join(`\n\n${'-'.repeat(50)}\n\n`),
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}

/**
 * Format the CANVAS CONTEXT section for the full LLM prompt.
 * Explicit selection is listed first; retrieved supporting context follows.
 * Image elements appear as attachment markers (not textual descriptions).
 */
export function formatCanvasContextSection(context: RagContext): string {
  if (
    context.allElements.length === 0 &&
    context.imageAttachments.length === 0 &&
    !context.regionImageContext
  ) {
    return ['CANVAS CONTEXT', '', '(none selected)'].join('\n');
  }

  const parts: string[] = [
    'CANVAS CONTEXT',
    '',
    'Element IDs are stable. POSITION values are canvas world coordinates.',
  ];

  const textualExplicit = context.explicitlySelectedElements.filter(
    (el) => el.element_type !== 'image',
  );
  if (textualExplicit.length > 0) {
    parts.push('');
    parts.push('EXPLICIT USER SELECTION');
    parts.push('');
    parts.push(
      'The following elements were selected by the user when this request was submitted.',
    );
    parts.push(
      'Selection is a strong contextual signal but does not by itself require modification.',
    );
    parts.push(
      'When the user says "this" / "these" / "this one", prefer these selected element(s).',
    );
    parts.push('');
    parts.push(
      textualExplicit
        .map((el) => formatElementBlock(el))
        .join(`\n\n${'-'.repeat(50)}\n\n`),
    );
  }

  const supporting = context.allElements.filter(
    (el) =>
      el.element_type !== 'image' &&
      !el.sources.some(
        (s) =>
          s.type === 'explicit_selection' || s.type === 'explicit_region_selection',
      ),
  );
  if (supporting.length > 0) {
    parts.push('');
    parts.push('RETRIEVED CANVAS CONTEXT');
    parts.push('');
    parts.push(
      'The following elements were retrieved for relevance (not user-selected).',
    );
    parts.push('');
    parts.push(
      supporting
        .map((el) => formatElementBlock(el))
        .join(`\n\n${'-'.repeat(50)}\n\n`),
    );
  }

  const imageSection = formatImageContextSection(context.imageAttachments);
  if (imageSection) {
    parts.push('');
    parts.push(imageSection);
  }

  return parts.join('\n');
}

export interface BuildLlmPromptInput {
  userPrompt: string;
  ragContext: RagContext;
  /** Snapshot of the structure selected for this request (null = No Structure). */
  selectedStructure?: NoteStructure | null;
  systemInstructions?: string;
  responseInstructions?: string;
}

/**
 * Build the complete copyable LLM prompt for Manual LLM Mode.
 * Deterministic: same inputs → same string.
 *
 * Separation:
 * - CANVAS CONTEXT = factual/contextual knowledge
 * - CANVAS IMAGE CONTEXT = attachment markers (bytes stay out of the string)
 * - SELECTED NOTE STRUCTURE = output format
 * - USER REQUEST = task
 */
export function buildLlmPrompt(input: BuildLlmPromptInput): BuiltLlmPrompt {
  const userPrompt = input.userPrompt.trim();
  const systemInstructions = (
    input.systemInstructions ?? CANVAS_EDITOR_SYSTEM_PROMPT
  ).trim();
  const responseInstructions = (
    input.responseInstructions ?? CANVAS_EDITOR_RESPONSE_INSTRUCTIONS
  ).trim();
  const ragContextSection = formatCanvasContextSection(input.ragContext);
  const noteStructureSection = input.selectedStructure
    ? formatNoteStructureForPrompt(input.selectedStructure)
    : formatNoStructureSelected();
  const imageAttachments = [...input.ragContext.imageAttachments];

  const finalLlmPrompt = [
    'SYSTEM INSTRUCTIONS',
    '',
    systemInstructions,
    '',
    '='.repeat(50),
    '',
    'OUTPUT CONTRACT',
    '',
    CANVAS_AGENT_OUTPUT_CONTRACT,
    '',
    '='.repeat(50),
    '',
    ragContextSection,
    '',
    '='.repeat(50),
    '',
    noteStructureSection,
    '',
    '='.repeat(50),
    '',
    'USER REQUEST',
    '',
    userPrompt || '(empty)',
    '',
    '='.repeat(50),
    '',
    'RESPONSE INSTRUCTIONS',
    '',
    responseInstructions,
    '',
  ].join('\n');

  return {
    userPrompt,
    systemInstructions,
    ragContextSection,
    noteStructureSection,
    finalLlmPrompt,
    imageAttachments,
  };
}
