/**
 * Shared LLM response handler — structured canvas operations (preferred)
 * with optional plain-text create fallback disabled for agent mode.
 */

import type { CanvasAgentResponse, CanvasOperation } from '../agent/operations';
import {
  CanvasAgentParseError,
  describeOperationPlan,
  parseCanvasAgentResponse,
  type ParseContext,
} from '../agent/parser';
import {
  executeAgentOperationsLive,
} from '../agent/liveExecutor';
import type { ExecuteAgentOpsResult } from '../agent/executor';

export interface HandleAgentResponseResult {
  kind: 'operations';
  response: CanvasAgentResponse;
  plan: string[];
  execution?: ExecuteAgentOpsResult;
}

export interface ParsedAgentPlan {
  response: CanvasAgentResponse;
  plan: string[];
}

/**
 * Parse + validate without applying. Use for AI Plan preview.
 */
export function parseAgentResponsePlan(
  raw: string,
  ctx: ParseContext,
): ParsedAgentPlan {
  const response = parseCanvasAgentResponse(raw, ctx);
  return {
    response,
    plan: describeOperationPlan(response.operations),
  };
}

/**
 * Validate then execute operations atomically via the editor store.
 */
export function applyAgentOperations(
  operations: readonly CanvasOperation[],
): ExecuteAgentOpsResult {
  return executeAgentOperationsLive(operations);
}

/**
 * Parse, validate, and execute in one step (after user confirms plan).
 */
export function handleAgentResponse(
  raw: string,
  ctx: ParseContext,
): HandleAgentResponseResult {
  const response = parseCanvasAgentResponse(raw, ctx);
  const plan = describeOperationPlan(response.operations);
  const execution = applyAgentOperations(response.operations);
  return { kind: 'operations', response, plan, execution };
}

export { CanvasAgentParseError };
