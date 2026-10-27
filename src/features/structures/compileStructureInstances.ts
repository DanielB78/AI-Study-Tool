/**
 * Compile resolved :::structure instances → create_structured_note operations.
 * Each instance is one layout unit for the chronological packer.
 */

import type {
  CanvasAgentResponse,
  CreateStructuredNoteOperation,
  StructuredFieldPayload,
} from '../ai/agent/operations';
import { parseContentDocument } from '../ai/contentFirst/contentParser';
import { documentToSingleRichText } from '../ai/contentFirst/compileJsonInstructions';
import { ContentParseError } from '../ai/contentFirst/types';
import { stripMarkdownDocumentFence } from '../ai/contentFirst/markdownFences';
import { sanitizeLatexSource, validateLatex } from '../equations/latex';
import { encodeGraphExpression } from '../graphs/expressionCodec';
import type { NoteStructure, NoteStructureField } from './types';
import { isGenerativeField, isStructureField } from './types';
import {
  resolveStructureInstances,
  splitStructureDocument,
  type ResolvedStructureInstance,
} from './structureDirective';
import type { ParseContext } from '../ai/agent/parser';

function extractEquationLatex(body: string): string {
  const trimmed = body.trim();
  const display = /^\$\$([\s\S]*?)\$\$$/.exec(trimmed);
  if (display) {
    return sanitizeLatexSource(display[1]!.trim());
  }
  // Multi-line $$ form
  const lines = trimmed.split('\n');
  if (lines[0]?.trim() === '$$' && lines[lines.length - 1]?.trim() === '$$') {
    return sanitizeLatexSource(lines.slice(1, -1).join('\n').trim());
  }
  // Bare latex fallback
  return sanitizeLatexSource(trimmed);
}

function extractGraphPayload(body: string): Extract<
  StructuredFieldPayload,
  { expressions: string[] }
> {
  let graphBody = body.trim();
  const wrapped = /^:::graph\s*\n([\s\S]*?)\n:::\s*$/i.exec(graphBody);
  if (wrapped) {
    graphBody = wrapped[1]!.trim();
  } else if (/^:::graph\s*$/im.test(graphBody)) {
    // Strip open/close markers if present with looser whitespace
    graphBody = graphBody
      .replace(/^:::graph\s*/i, '')
      .replace(/\n?:::\s*$/i, '')
      .trim();
  }

  const lines = graphBody.split('\n').map((l) => l.trim()).filter(Boolean);
  const expressions: string[] = [];
  let title: string | null = null;
  let xMin: number | null = null;
  let xMax: number | null = null;
  let yMin: number | null = null;
  let yMax: number | null = null;
  let xLabel: string | null = null;
  let yLabel: string | null = null;

  for (const line of lines) {
    const m = /^([a-z_]+)\s*:\s*(.+)$/i.exec(line);
    if (!m) {
      throw new ContentParseError(
        'invalid_graph',
        `Invalid graph line "${line}". Expected key: value.`,
      );
    }
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    switch (key) {
      case 'expression': {
        const encoded = encodeGraphExpression(value, 'strict');
        if (!encoded.ok) {
          throw new ContentParseError(
            'invalid_expression',
            `Invalid graph expression "${value}": ${encoded.error}`,
          );
        }
        expressions.push(encoded.canonical);
        break;
      }
      case 'title':
        title = value;
        break;
      case 'x_min':
        xMin = Number(value);
        break;
      case 'x_max':
        xMax = Number(value);
        break;
      case 'y_min':
        yMin = Number(value);
        break;
      case 'y_max':
        yMax = Number(value);
        break;
      case 'x_label':
        xLabel = value;
        break;
      case 'y_label':
        yLabel = value;
        break;
      default:
        throw new ContentParseError(
          'invalid_graph',
          `Unknown graph key "${key}".`,
        );
    }
  }

  if (expressions.length === 0) {
    throw new ContentParseError(
      'invalid_graph',
      'Graph slot requires at least one expression: line.',
    );
  }

  return {
    expressions,
    title,
    x_min: xMin,
    x_max: xMax,
    y_min: yMin,
    y_max: yMax,
    x_label: xLabel,
    y_label: yLabel,
  };
}

function compileTextSlot(body: string): StructuredFieldPayload {
  const doc = parseContentDocument(body);
  // Graph nodes inside a text slot are not allowed.
  if (doc.nodes.some((n) => n.type === 'graph')) {
    throw new ContentParseError(
      'invalid_instruction',
      'Text slots cannot contain :::graph — use a graph slot instead.',
    );
  }
  const rich_text = documentToSingleRichText(doc);
  const content =
    rich_text.blocks
      .map((b) =>
        'spans' in b
          ? b.spans
              .map((s) =>
                'type' in s && s.type === 'inline_math'
                  ? s.latex
                  : 'type' in s && s.type === 'inline_code'
                    ? s.text
                    : 'text' in s
                      ? s.text
                      : '',
              )
              .join('')
          : '',
      )
      .join('\n')
      .trim() || body.trim();
  return { content, rich_text };
}

function compileEquationSlot(body: string): StructuredFieldPayload {
  const latex = extractEquationLatex(body);
  const check = validateLatex(latex, true);
  if (!check.ok) {
    throw new ContentParseError(
      'invalid_latex',
      `Invalid display LaTeX in equation slot: ${check.error}`,
    );
  }
  return { latex };
}

function compileSlotBody(
  field: NoteStructureField,
  body: string,
): StructuredFieldPayload {
  if (field.contentType === 'equation') return compileEquationSlot(body);
  if (field.contentType === 'graph') return extractGraphPayload(body);
  return compileTextSlot(body);
}

export function compileResolvedInstance(
  instance: ResolvedStructureInstance,
  ref = `structure_inst_${instance.sourceIndex}`,
): CreateStructuredNoteOperation {
  const fields: Record<string, StructuredFieldPayload> = {};
  for (const field of instance.template.fields) {
    if (!isGenerativeField(field)) continue;
    const body = instance.slotBodies.get(field.id);
    if (body == null) {
      fields[field.id] = null;
      continue;
    }
    fields[field.id] = compileSlotBody(field, body);
  }

  return {
    type: 'create_structured_note',
    structure_id: instance.template.id,
    fields,
    placement: { mode: 'viewport_default' },
    ref,
  };
}

/**
 * Parse Markdown that may contain :::structure blocks and compile instances.
 * Returns preamble (ordinary Markdown) + structured-note operations.
 */
export function compileStructureMarkdown(
  raw: string,
  selectedStructure: NoteStructure | null | undefined,
): {
  preamble: string;
  operations: CreateStructuredNoteOperation[];
  instances: ResolvedStructureInstance[];
} {
  const stripped = stripMarkdownDocumentFence(raw);
  const doc = splitStructureDocument(stripped);
  const instances = resolveStructureInstances(doc, selectedStructure);
  const operations = instances.map((inst, index) =>
    compileResolvedInstance(inst, `structure_inst_${index + 1}`),
  );
  return {
    preamble: doc.preamble,
    operations,
    instances,
  };
}

/**
 * Build a chronological_grid agent response from one or more structure instances.
 */
export function structureInstancesToAgentResponse(
  operations: CreateStructuredNoteOperation[],
): CanvasAgentResponse {
  return {
    output_type: 'lesson',
    layout: {
      type: 'chronological_grid',
      placement: { mode: 'viewport_default' },
    },
    operations,
  };
}

/** True when raw content should take the structure-directive path. */
export function shouldCompileStructureDirectives(
  raw: string,
  ctx: ParseContext,
): boolean {
  if (!ctx.selectedStructure) return false;
  const stripped = stripMarkdownDocumentFence(raw);
  return /(?:^|\n):::structure\s+\S+/i.test(stripped);
}

export { isStructureField };
