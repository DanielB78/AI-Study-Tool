/**
 * Parse Markdown → compile ops → validate via existing parser path → execute.
 *
 * Textbook feature associations / component chrome are intentionally not applied
 * in this pass (kept in codebase for later). Layout comes only from chronological_grid.
 */

import type { CanvasAgentResponse } from '../agent/operations';
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
import type { ContentDocument } from './types';
import { ContentParseError } from './types';

export type ContentFirstHandleResult = {
  kind: 'content_first';
  document: ContentDocument;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  plan: string[];
  execution?: ExecuteAgentOpsResult;
};

export function parseContentFirstToAgentResponse(
  raw: string,
  ctx: ParseContext,
): {
  document: ContentDocument;
  compile: CompileContentResult;
  response: CanvasAgentResponse;
  plan: string[];
} {
  const document = parseContentDocument(raw);
  const compile = compileContentDocument(document);
  // Re-validate through the canonical agent parser (factories / schema).
  const response = parseCanvasAgentResponse(
    JSON.stringify(compile.response),
    ctx,
  );
  const plan = describeOperationPlan(response.operations, {
    layout: response.layout,
  });
  return { document, compile, response, plan };
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

/** Parse, validate, and execute. No feature-component / association reflow. */
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
