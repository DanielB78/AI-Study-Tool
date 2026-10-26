/**
 * Parse Markdown (+ optional :::json directives) → compile ops → validate → execute.
 *
 * Textbook feature associations / component chrome are intentionally not applied
 * in this pass (kept in codebase for later). Layout comes from chronological_grid
 * for ordinary generation; relative_to_element for add_text.
 */

import type { CanvasAgentResponse, CanvasOperation } from '../agent/operations';
import {
  describeOperationPlan,
  parseCanvasAgentResponse,
  type ParseContext,
} from '../agent/parser';
import { executeAgentOperationsLive } from '../agent/liveExecutor';
import type { ExecuteAgentOpsResult } from '../agent/executor';
import { parseContentDocument } from './contentParser';
import {
  compileContentDocument,
  type CompileContentResult,
} from './compileContentDocument';
import { compileJsonSegments } from './compileJsonInstructions';
import { splitContentFirstEnvelope } from './jsonDirective';
import type { ContentDocument, ContentFirstEnvelope } from './types';
import { ContentParseError } from './types';

export type ContentFirstHandleResult = {
  kind: 'content_first';
  document: ContentDocument | null;
  envelope: ContentFirstEnvelope;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  plan: string[];
  execution?: ExecuteAgentOpsResult;
};

function mergeCompile(
  preamble: CompileContentResult | null,
  jsonOps: CanvasOperation[],
): CompileContentResult {
  const operations: CanvasOperation[] = [
    ...(preamble?.response.operations ?? []),
    ...jsonOps,
  ];
  if (operations.length === 0) {
    throw new ContentParseError(
      'empty',
      'No educational content or JSON instructions were produced.',
    );
  }

  const hasChronologicalCreates = (preamble?.response.operations ?? []).some(
    (op) =>
      op.type === 'create_text' ||
      op.type === 'create_equation' ||
      op.type === 'create_graph',
  );

  const response: CanvasAgentResponse = {
    output_type: preamble?.response.output_type ?? 'lesson',
    ...(hasChronologicalCreates
      ? {
          layout: {
            type: 'chronological_grid' as const,
            placement: { mode: 'viewport_default' as const },
          },
        }
      : {}),
    operations,
  };

  return {
    response,
    associationPlan: preamble?.associationPlan ?? [],
    refSectionIds: preamble?.refSectionIds ?? {},
  };
}

export function parseContentFirstToAgentResponse(
  raw: string,
  ctx: ParseContext,
): {
  document: ContentDocument | null;
  envelope: ContentFirstEnvelope;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  plan: string[];
} {
  const envelope = splitContentFirstEnvelope(raw);

  // Validate + compile ALL JSON segments before mutating (throws on first failure).
  const jsonOps = compileJsonSegments(envelope.segments, ctx);

  let preambleCompile: CompileContentResult | null = null;
  let document: ContentDocument | null = null;
  if (envelope.preamble.trim()) {
    document = parseContentDocument(envelope.preamble);
    preambleCompile = compileContentDocument(document);
  } else if (envelope.segments.length === 0) {
    throw new ContentParseError('empty', 'Content response is empty.');
  }

  const compile = mergeCompile(preambleCompile, jsonOps);

  // Re-validate through the canonical agent parser (factories / schema / targets).
  const response = parseCanvasAgentResponse(
    JSON.stringify(compile.response),
    ctx,
  );
  const plan = describeOperationPlan(response.operations, {
    layout: response.layout,
  });
  return { document, envelope, compile, response, plan };
}

/** Parse + compile + validate without applying. */
export function previewContentFirstPlan(
  raw: string,
  ctx: ParseContext,
): ContentFirstHandleResult {
  const parsed = parseContentFirstToAgentResponse(raw, ctx);
  return {
    kind: 'content_first',
    ...parsed,
  };
}

/** Parse, validate, and execute. One undoable agent transaction. */
export function handleContentFirstResponse(
  raw: string,
  ctx: ParseContext,
): ContentFirstHandleResult {
  const parsed = parseContentFirstToAgentResponse(raw, ctx);
  const execution = executeAgentOperationsLive(parsed.response);
  return {
    kind: 'content_first',
    ...parsed,
    execution,
  };
}

export { ContentParseError };
