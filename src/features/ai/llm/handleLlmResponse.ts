/**
 * Shared LLM response handler — structured canvas operations (preferred)
 * with optional plain-text create fallback disabled for agent mode.
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

function planOptionsFromContext(ctx: ParseContext): DescribePlanOptions | undefined {
  const structure = ctx.selectedStructure;
  if (!structure) return undefined;
  return {
    structureNames: new Map([[structure.id, structure.name]]),
    structureFieldLabels: new Map([
      [structure.id, new Map(structure.fields.map((f) => [f.id, f.label]))],
    ]),
  };
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
    plan: describeOperationPlan(response.operations, planOptionsFromContext(ctx)),
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
  const plan = describeOperationPlan(response.operations, planOptionsFromContext(ctx));
  const execution = applyAgentOperations(response.operations);
  return { kind: 'operations', response, plan, execution };
}

export { CanvasAgentParseError };
