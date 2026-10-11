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
