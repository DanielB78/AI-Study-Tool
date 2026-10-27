/**
 * Parse :::structure … :::endstructure Markdown directives.
 *
 * Slot identity comes from the natural-language description after `:::`.
 * Nested :::graph (and other :::…::: blocks) use a nesting depth so they do
 * not terminate the outer slot.
 */

import { ContentParseError } from '../ai/contentFirst/types';
import {
  directiveLabelFromDescription,
  matchSlotLabelToId,
  normalizeSlotDescription,
  RESERVED_STRUCTURE_MARKERS,
} from './slotLabels';
import type { NoteStructure, NoteStructureField } from './types';
import { isGenerativeField, isStructureField } from './types';

export type ParsedStructureSlot = {
  /** Exact marker text from the LLM (before normalisation). */
  marker: string;
  /** Normalised directive label. */
  label: string;
  /** Matched template slot id (after resolve). */
  slotId: string | null;
  /** Raw Markdown / LaTeX / nested graph body. */
  body: string;
};

export type ParsedStructureInstance = {
  /** Template name from `:::structure Name`. */
  templateName: string;
  slots: ParsedStructureSlot[];
  /** Character offset in the source for error messages. */
  sourceIndex: number;
};

export type ParsedStructureDocument = {
  /** Markdown outside structure blocks (ordinary content-first). */
  preamble: string;
  instances: ParsedStructureInstance[];
  raw: string;
};

const STRUCTURE_OPEN = /^:::structure\s+(.+?)\s*$/i;
const STRUCTURE_END = /^:::endstructure\s*$/i;
/** Opening marker that starts a nested block needing a closing `:::`. */
const NESTED_OPEN = /^:::(graph|json|definition|example|warning|exercise)\s*$/i;
/** Generic slot / close marker: :::Something or ::: alone. */
const MARKER_LINE = /^:::(.*)$/;

function isFenceOpen(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trim());
}

function fenceCloser(openLine: string): string | null {
  const m = /^(`{3,}|~{3,})/.exec(openLine.trim());
  if (!m) return null;
  const ticks = m[1]!;
  return ticks[0] === '`' ? '`'.repeat(ticks.length) : '~'.repeat(ticks.length);
}

/**
 * Split a Markdown document into ordinary preamble + structure instances.
 * Fenced code blocks are skipped so examples containing :::structure are inert.
 */
export function splitStructureDocument(raw: string): ParsedStructureDocument {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const preambleLines: string[] = [];
  const instances: ParsedStructureInstance[] = [];
  let i = 0;
  let charOffset = 0;

  const lineStartOffset = (lineIndex: number): number => {
    let off = 0;
    for (let k = 0; k < lineIndex; k++) off += lines[k]!.length + 1;
    return off;
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip fenced code — structure markers inside are documentation only.
    if (isFenceOpen(line)) {
      const closer = fenceCloser(line);
      preambleLines.push(line);
      i += 1;
      while (i < lines.length) {
        preambleLines.push(lines[i]!);
        const trimmed = lines[i]!.trim();
        if (closer && trimmed.startsWith(closer) && trimmed.length === closer.length) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    const open = STRUCTURE_OPEN.exec(line.trim());
    if (open) {
      const templateName = open[1]!.trim();
      if (!templateName) {
        throw new ContentParseError(
          'invalid_instruction',
          ':::structure requires a template name.',
        );
      }
      const startIndex = lineStartOffset(i);
      i += 1;
      const bodyLines: string[] = [];
      let closed = false;
      while (i < lines.length) {
        if (STRUCTURE_END.test(lines[i]!.trim())) {
          closed = true;
          i += 1;
          break;
        }
        // Nested :::structure is illegal.
        if (STRUCTURE_OPEN.test(lines[i]!.trim())) {
          throw new ContentParseError(
            'invalid_instruction',
            'Nested :::structure blocks are not allowed.',
          );
        }
        bodyLines.push(lines[i]!);
        i += 1;
      }
      if (!closed) {
        throw new ContentParseError(
          'unclosed_marker',
          `Unclosed :::structure ${templateName} — missing :::endstructure.`,
        );
      }
      instances.push({
        templateName,
        slots: parseStructureSlots(bodyLines.join('\n')),
        sourceIndex: startIndex,
      });
      continue;
    }

    // Lone :::endstructure outside a block.
    if (STRUCTURE_END.test(line.trim())) {
      throw new ContentParseError(
        'invalid_instruction',
        ':::endstructure without a matching :::structure.',
      );
    }

    preambleLines.push(line);
    i += 1;
    charOffset = lineStartOffset(i);
  }

  void charOffset;
  return {
    preamble: preambleLines.join('\n').trim(),
    instances,
    raw,
  };
}

/**
 * Parse slot markers inside one structure body.
 * Nested :::graph / :::json / component markers consume their own closing :::.
 * Each slot must end with a bare `:::`.
 */
export function parseStructureSlots(body: string): ParsedStructureSlot[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const slots: ParsedStructureSlot[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i]!.trim()) {
      i += 1;
      continue;
    }
    const trimmed = lines[i]!.trim();
    const markerMatch = MARKER_LINE.exec(trimmed);
    if (!markerMatch) {
      throw new ContentParseError(
        'invalid_instruction',
        `Unexpected content in structure body: "${trimmed.slice(0, 60)}"`,
      );
    }
    const markerRest = (markerMatch[1] ?? '').trim();
    if (!markerRest || NESTED_OPEN.test(trimmed) || STRUCTURE_END.test(trimmed)) {
      throw new ContentParseError(
        'invalid_instruction',
        `Invalid slot marker at structure body boundary.`,
      );
    }
    const marker = markerRest;
    i += 1;
    const buf: string[] = [];
    let nest = 0;
    let inFence: string | null = null;
    let closed = false;

    while (i < lines.length) {
      const L = lines[i]!;
      const t = L.trim();

      if (inFence) {
        buf.push(L);
        if (t.startsWith(inFence) && t.length === inFence.length) inFence = null;
        i += 1;
        continue;
      }
      if (isFenceOpen(L)) {
        inFence = fenceCloser(L);
        buf.push(L);
        i += 1;
        continue;
      }
      if (NESTED_OPEN.test(t)) {
        nest += 1;
        buf.push(L);
        i += 1;
        continue;
      }
      if (t === ':::') {
        if (nest > 0) {
          nest -= 1;
          buf.push(L);
          i += 1;
          continue;
        }
        closed = true;
        i += 1;
        break;
      }
      if (
        MARKER_LINE.test(t) &&
        !NESTED_OPEN.test(t) &&
        nest === 0
      ) {
        throw new ContentParseError(
          'unclosed_marker',
          `Unclosed slot ":::${marker}" before next marker.`,
        );
      }
      buf.push(L);
      i += 1;
    }

    if (!closed) {
      throw new ContentParseError(
        'unclosed_marker',
        `Unclosed slot ":::${marker}" — missing closing :::`,
      );
    }
    if (nest > 0 || inFence) {
      throw new ContentParseError(
        'unclosed_marker',
        `Unclosed nested directive inside slot ":::${marker}".`,
      );
    }

    slots.push({
      marker,
      label: directiveLabelFromDescription(marker),
      slotId: null,
      body: buf.join('\n').replace(/^\n+/, '').replace(/\n+$/, ''),
    });
  }

  return slots;
}

export type ResolvedStructureInstance = {
  template: NoteStructure;
  templateName: string;
  /** slotId → raw body */
  slotBodies: Map<string, string>;
  sourceIndex: number;
};

/**
 * Resolve structure instances against a selected template (by name).
 * Validates required slots, duplicates, unknown markers, and content kinds.
 */
export function resolveStructureInstances(
  doc: ParsedStructureDocument,
  selected: NoteStructure | null | undefined,
): ResolvedStructureInstance[] {
  if (doc.instances.length === 0) return [];

  if (!selected) {
    throw new ContentParseError(
      'invalid_instruction',
      ':::structure blocks require a selected structure template.',
    );
  }

  const expectedName = normalizeSlotDescription(selected.name);
  const generativeSlots = selected.fields.filter(isGenerativeField);

  return doc.instances.map((inst) => {
    const name = normalizeSlotDescription(inst.templateName);
    if (name !== expectedName) {
      throw new ContentParseError(
        'invalid_instruction',
        `Unknown structure "${inst.templateName}". Selected template is "${selected.name}".`,
      );
    }

    const slotMeta = generativeSlots.map((f) => ({
      id: f.id,
      description: f.instruction,
    }));

    const slotBodies = new Map<string, string>();
    const seenLabels = new Set<string>();

    for (const slot of inst.slots) {
      if (seenLabels.has(slot.label)) {
        throw new ContentParseError(
          'invalid_instruction',
          `Duplicate slot assignment "${slot.label}" in one structure instance.`,
        );
      }
      seenLabels.add(slot.label);

      let slotId: string;
      try {
        slotId = matchSlotLabelToId(slot.marker, slotMeta);
      } catch (err) {
        throw new ContentParseError(
          'invalid_instruction',
          err instanceof Error ? err.message : String(err),
        );
      }

      const field = generativeSlots.find((f) => f.id === slotId)!;
      validateSlotBodyKind(field, slot.body);
      slotBodies.set(slotId, slot.body);
    }

    for (const field of generativeSlots) {
      if (field.required && !slotBodies.has(field.id)) {
        throw new ContentParseError(
          'invalid_instruction',
          `Missing required slot "${directiveLabelFromDescription(field.instruction)}" ` +
            `for structure "${selected.name}".`,
        );
      }
    }

    return {
      template: selected,
      templateName: selected.name,
      slotBodies,
      sourceIndex: inst.sourceIndex,
    };
  });
}

function validateSlotBodyKind(field: NoteStructureField, body: string): void {
  const trimmed = body.trim();
  if (field.contentType === 'equation') {
    // Must contain display math or raw latex; empty required already handled.
    if (!trimmed) {
      throw new ContentParseError(
        'empty_body',
        `Equation slot "${field.instruction}" is empty.`,
      );
    }
    return;
  }
  if (field.contentType === 'graph') {
    if (!/^:::graph\s*$/m.test(trimmed) && !/^expression\s*:/m.test(trimmed)) {
      throw new ContentParseError(
        'invalid_graph',
        `Graph slot "${field.instruction}" must contain a :::graph definition.`,
      );
    }
    return;
  }
  // text — any markdown, including empty for optional
  if (field.required && !trimmed) {
    throw new ContentParseError(
      'empty_body',
      `Text slot "${field.instruction}" is empty.`,
    );
  }
}

/** Generative fields in reading order for prompts / validation. */
export function generativeSlotsInReadingOrder(
  structure: NoteStructure,
): NoteStructureField[] {
  return structure.fields
    .filter(isGenerativeField)
    .sort(
      (a, b) =>
        a.readingOrder - b.readingOrder ||
        a.relativeY - b.relativeY ||
        a.relativeX - b.relativeX,
    );
}

/** True when the response contains at least one top-level :::structure block. */
export function hasStructureDirectives(raw: string): boolean {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let inFence: string | null = null;
  for (const line of lines) {
    if (inFence) {
      const t = line.trim();
      if (t.startsWith(inFence) && t.length === inFence.length) inFence = null;
      continue;
    }
    if (isFenceOpen(line)) {
      inFence = fenceCloser(line);
      // Document wrapper ```markdown should NOT hide structure — only inner fences.
      // Heuristic: ```markdown / ```md at start is the pasteable wrapper; strip later.
      const lang = /^(`{3,}|~{3,})\s*(\w+)/.exec(line.trim());
      if (lang && /^(markdown|md)$/i.test(lang[2]!)) {
        // Treat as wrapper: don't enter fence-skip for structure detection? 
        // Actually splitStructureDocument handles fences; for detection we want
        // structures inside ```markdown wrappers to count.
        inFence = null;
        continue;
      }
      continue;
    }
    if (STRUCTURE_OPEN.test(line.trim())) return true;
  }
  return false;
}

export function isReservedSlotMarker(marker: string): boolean {
  return RESERVED_STRUCTURE_MARKERS.has(
    normalizeSlotDescription(marker).toLowerCase(),
  );
}

export { isStructureField, isGenerativeField };
