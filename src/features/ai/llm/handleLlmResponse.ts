/**
 * Shared LLM response handler — structured canvas operations (preferred)
 * with content-first Markdown compilation when that generation mode is active.
 */

import type { CanvasAgentResponse, CanvasOperation } from '../agent/operations';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
  type DescribePlanOptions,
  type ParseContext,
} from '../agent/parser';
import {
  executeAgentOperationsLive,
} from '../agent/liveExecutor';
import type { ExecuteAgentOpsResult } from '../agent/executor';
import {
  handleContentFirstResponse,
  isContentFirstMode,
  looksLikeContentMarkdown,
  looksLikeOperationsJson,
  previewContentFirstPlan,
  ContentParseError,
  type ContentFirstHandleResult,
} from '../contentFirst';
import { extractActionSummary } from '../../interactions/actionSummaryFence';

export interface HandleAgentResponseResult {
  kind: 'operations';
  response: CanvasAgentResponse;
  plan: string[];
  execution?: ExecuteAgentOpsResult;
  /** LLM :::summary body when present; never applied to the canvas. */
  actionSummary: string | null;
}

export type HandleGenerationResult =
  | HandleAgentResponseResult
  | ContentFirstHandleResult;

export interface ParsedAgentPlan {
  response: CanvasAgentResponse;
  plan: string[];
  actionSummary: string | null;
}

function planOptionsFromContext(
  ctx: ParseContext,
  response?: { layout?: CanvasAgentResponse['layout'] },
): DescribePlanOptions | undefined {
  const structure = ctx.selectedStructure;
  const base: DescribePlanOptions = {
    layout: response?.layout,
  };
  if (!structure) {
    return response?.layout ? base : undefined;
  }
  return {
    ...base,
    structureNames: new Map([[structure.id, structure.name]]),
    structureFieldLabels: new Map([
      [structure.id, new Map(structure.fields.map((f) => [f.id, f.label]))],
    ]),
  };
}

/**
 * Parse + validate without applying. Use for AI Plan preview.
 * Respects content-first mode (and Markdown heuristic when mode is content_first).
 */
export function parseAgentResponsePlan(
  raw: string,
  ctx: ParseContext,
): ParsedAgentPlan {
  const { summary, body } = extractActionSummary(raw);
  if (shouldUseContentFirst(body)) {
    const preview = previewContentFirstPlan(body, ctx);
    return {
      response: preview.response,
      plan: preview.plan,
      actionSummary: summary ?? preview.actionSummary,
    };
  }
  const response = parseCanvasAgentResponse(body, ctx);
  return {
    response,
    plan: describeOperationPlan(
      response.operations,
      planOptionsFromContext(ctx, response),
    ),
    actionSummary: summary,
  };
}

function shouldUseContentFirst(raw: string): boolean {
  if (isContentFirstMode()) {
    // Content-first mode: Markdown unless the paste is clearly operations JSON
    // (so editing/ops pastes still work while experimenting).
    if (looksLikeOperationsJson(raw) && !looksLikeContentMarkdown(raw)) {
      return false;
    }
    return true;
  }
  return false;
}

/**
 * Validate then execute operations atomically via the editor store.
 * Accepts a full response (preferred — includes layout) or a bare ops list.
 */
export function applyAgentOperations(
  plan: CanvasAgentResponse | readonly CanvasOperation[],
): ExecuteAgentOpsResult {
  return executeAgentOperationsLive(plan);
}

/**
 * Parse, validate, and execute in one step (after user confirms plan).
 */
export function handleAgentResponse(
  raw: string,
  ctx: ParseContext,
): HandleGenerationResult {
  const { summary, body } = extractActionSummary(raw);
  if (shouldUseContentFirst(body)) {
    const result = handleContentFirstResponse(body, ctx);
    return {
      ...result,
      actionSummary: summary ?? result.actionSummary,
    };
  }
  const response = parseCanvasAgentResponse(body, ctx);
  const plan = describeOperationPlan(
    response.operations,
    planOptionsFromContext(ctx, response),
  );
  const execution = applyAgentOperations(response);
  return {
    kind: 'operations',
    response,
    plan,
    execution,
    actionSummary: summary,
  };
}

export { CanvasAgentParseError, ContentParseError };
