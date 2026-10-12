export type ParseErrorCode =
  | 'empty'
  | 'invalid_json'
  | 'schema'
  | 'unknown_operation'
  | 'empty_text'
  | 'missing_target'
  | 'target_not_in_context'
  | 'target_not_text'
  | 'missing_anchor'
  | 'anchor_not_in_context'
  | 'invalid_relation'
  | 'invalid_coordinates'
  | 'structure_not_selected'
  | 'structure_mismatch'
  | 'unknown_structure_field'
  | 'missing_required_field'
  | 'invalid_field_payload'
  | 'invalid_latex'
  | 'hierarchy_too_deep'
  | 'hierarchy_too_large'
  | 'hierarchy_too_many_children'
  | 'invalid_graph_expression'
  | 'invalid_graph_viewport'
  | 'invalid_graph_domain'
  | 'empty_graph_content'
  | 'target_not_graph'
  | 'expression_not_on_graph'
  | 'point_not_on_graph';

export class CanvasAgentParseError extends Error {
  readonly code: ParseErrorCode;
  readonly detail?: string;

  constructor(code: ParseErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'CanvasAgentParseError';
    this.code = code;
    this.detail = detail;
  }
}

export type ExecuteErrorStage =
  | 'apply'
  | 'measure'
  | 'layout'
  | 'create'
  | 'update'
  | 'text_feature'
  | 'text_component';

/** Structured execution failure — never report success for a failed op. */
export class CanvasAgentExecuteError extends Error {
  readonly opIndex: number;
  readonly opType: string;
  readonly targetId?: string;
  readonly stage: ExecuteErrorStage;
  readonly causeMessage?: string;

  constructor(opts: {
    opIndex: number;
    opType: string;
    targetId?: string;
    stage: ExecuteErrorStage;
    message: string;
    cause?: unknown;
  }) {
    const causeMessage =
      opts.cause instanceof Error
        ? opts.cause.message
        : opts.cause != null
          ? String(opts.cause)
          : undefined;
    const target = opts.targetId ? ` target=${opts.targetId}` : '';
    const causePart = causeMessage ? ` — ${causeMessage}` : '';
    super(
      `Operation ${opts.opIndex + 1} (${opts.opType}) failed at ${opts.stage}${target}${causePart}`,
    );
    this.name = 'CanvasAgentExecuteError';
    this.opIndex = opts.opIndex;
    this.opType = opts.opType;
    this.targetId = opts.targetId;
    this.stage = opts.stage;
    this.causeMessage = causeMessage;
    if (opts.cause instanceof Error) {
      this.cause = opts.cause;
    }
  }
}
