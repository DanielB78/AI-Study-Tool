/**
 * Parse Markdown (+ optional :::json directives) → compile ops → validate → execute.
 *
 * Textbook feature associations / component chrome are intentionally not applied
 * in this pass (kept in codebase for later).
 *
 * Batches:
 * - Ordinary preamble → chronological_grid (viewport_default)
 * - Consecutive edit instructions → one no-layout update batch
 * - Each add_text → chronological_grid group placed relative_to_element
 *
 * All batches run in one undoable agent transaction.
 */

import type { CanvasAgentResponse, CanvasOperation } from '../agent/operations';
import {
  describeOperationPlan,
  parseCanvasAgentResponse,
  type ParseContext,
} from '../agent/parser';
import {
  createLiveAgentExecutorTarget,
} from '../agent/liveExecutor';
import {
  executeCanvasOperations,
  type ExecuteAgentOpsResult,
} from '../agent/executor';
import { parseContentDocument } from './contentParser';
import {
  compileContentDocument,
  type CompileContentResult,
} from './compileContentDocument';
import {
  compileAddTextBatch,
  compileJsonEditSegment,
} from './compileJsonInstructions';
import { splitContentFirstEnvelope } from './jsonDirective';
import type { ContentDocument, ContentFirstEnvelope } from './types';
import { ContentParseError } from './types';

export type ContentFirstHandleResult = {
  kind: 'content_first';
  document: ContentDocument | null;
  envelope: ContentFirstEnvelope;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  /** Individual validated batches applied in order (one undo transaction). */
  batches: CanvasAgentResponse[];
  plan: string[];
  execution?: ExecuteAgentOpsResult;
};

function emptyCompile(operations: CanvasOperation[]): CompileContentResult {
  return {
    response: { output_type: 'lesson', operations },
    associationPlan: [],
    refSectionIds: {},
  };
}

/**
 * Compile + validate every batch before any mutation.
 * Throws ContentParseError / CanvasAgentParseError on the first failure.
 */
export function compileContentFirstBatches(
  raw: string,
  ctx: ParseContext,
): {
  document: ContentDocument | null;
  envelope: ContentFirstEnvelope;
  batches: CanvasAgentResponse[];
  compile: CompileContentResult;
} {
  const envelope = splitContentFirstEnvelope(raw);
  const batches: CanvasAgentResponse[] = [];
  let document: ContentDocument | null = null;
  let preambleCompile: CompileContentResult | null = null;

  if (envelope.preamble.trim()) {
    document = parseContentDocument(envelope.preamble);
    preambleCompile = compileContentDocument(document);
    batches.push(preambleCompile.response);
  } else if (envelope.segments.length === 0) {
    throw new ContentParseError('empty', 'Content response is empty.');
  }

  let editOps: CanvasOperation[] = [];
  const flushEdits = () => {
    if (editOps.length === 0) return;
    batches.push({ output_type: 'lesson', operations: editOps });
    editOps = [];
  };

  for (const segment of envelope.segments) {
    if (segment.instruction.action === 'edit') {
      editOps.push(...compileJsonEditSegment(segment, ctx));
      continue;
    }
    flushEdits();
    batches.push(
      compileAddTextBatch(segment.instruction, segment.markdown, ctx),
    );
  }
  flushEdits();

  if (batches.length === 0) {
    throw new ContentParseError(
      'empty',
      'No educational content or JSON instructions were produced.',
    );
  }

  // Validate each batch through the canonical agent parser before applying.
  const validated = batches.map((batch) =>
    parseCanvasAgentResponse(JSON.stringify(batch), ctx),
  );

  const flatOps = validated.flatMap((b) => b.operations);
  const compile: CompileContentResult = preambleCompile
    ? {
        ...preambleCompile,
        response: {
          ...preambleCompile.response,
          operations: flatOps,
          // Preserve a representative layout for plan display when present.
          layout: validated.find((b) => b.layout)?.layout,
        },
      }
    : emptyCompile(flatOps);

  // Prefer showing the first layout that exists (preamble or add_text group).
  if (!compile.response.layout) {
    const withLayout = validated.find((b) => b.layout);
    if (withLayout?.layout) {
      compile.response.layout = withLayout.layout;
    }
  }

  return { document, envelope, batches: validated, compile };
}

export function parseContentFirstToAgentResponse(
  raw: string,
  ctx: ParseContext,
): {
  document: ContentDocument | null;
  envelope: ContentFirstEnvelope;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  batches: CanvasAgentResponse[];
  plan: string[];
} {
  const compiled = compileContentFirstBatches(raw, ctx);
  const response = compiled.compile.response;
  const plan = describeOperationPlan(response.operations, {
    layout: response.layout,
  });
  return { ...compiled, response, plan };
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

/** Parse, validate, and execute all batches as one undoable transaction. */
export function handleContentFirstResponse(
  raw: string,
  ctx: ParseContext,
): ContentFirstHandleResult {
  const parsed = parseContentFirstToAgentResponse(raw, ctx);
  const target = createLiveAgentExecutorTarget();
  target.beginInteraction();
  let committed = false;
  const merged: ExecuteAgentOpsResult = {
    createdIds: [],
    updatedIds: [],
    affectedIds: [],
    structureInstanceIds: [],
    planRefMap: new Map(),
  };
  try {
    for (const batch of parsed.batches) {
      const result = executeCanvasOperations(batch, target, {
        manageInteraction: false,
      });
      merged.createdIds.push(...result.createdIds);
      merged.updatedIds.push(...result.updatedIds);
      merged.affectedIds.push(...result.affectedIds);
      merged.structureInstanceIds.push(...result.structureInstanceIds);
      for (const [k, v] of result.planRefMap ?? []) {
        merged.planRefMap?.set(k, v);
      }
      if (result.layoutDebug) merged.layoutDebug = result.layoutDebug;
    }
    committed = true;
  } finally {
    if (committed) target.endInteraction();
    else target.rollbackInteraction();
  }

  return {
    kind: 'content_first',
    ...parsed,
    execution: merged,
  };
}

export { ContentParseError };
