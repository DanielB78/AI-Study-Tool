/**
 * Intermediate representation for content-first (Markdown) generation.
 * No canvas coordinates — compiled into existing CanvasOperations.
 */

export type ContentTextSpanStyle = {
  bold?: boolean;
  italic?: boolean;
};

export type ContentInlineSpan =
  | { type: 'text'; text: string; style?: ContentTextSpanStyle }
  | { type: 'inline_math'; latex: string };

export type ContentHeadingNode = {
  type: 'heading';
  level: 1 | 2 | 3;
  spans: ContentInlineSpan[];
  /** Plain extract for associations / search. */
  text: string;
  sectionId: string;
};

export type ContentParagraphNode = {
  type: 'paragraph';
  spans: ContentInlineSpan[];
  text: string;
  sectionId: string | null;
};

export type ContentListNode = {
  type: 'list';
  ordered: boolean;
  items: Array<{ spans: ContentInlineSpan[]; text: string }>;
  sectionId: string | null;
};

export type ContentEquationNode = {
  type: 'equation';
  latex: string;
  sectionId: string | null;
};

export type ContentGraphNode = {
  type: 'graph';
  title: string | null;
  expressions: string[];
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
  xLabel: string | null;
  yLabel: string | null;
  sectionId: string | null;
};

export type ContentComponentKind =
  | 'definition'
  | 'example'
  | 'warning'
  | 'exercise';

export type ContentComponentNode = {
  type: 'component';
  component: ContentComponentKind;
  spans: ContentInlineSpan[];
  text: string;
  sectionId: string | null;
};

export type ContentDocumentNode =
  | ContentHeadingNode
  | ContentParagraphNode
  | ContentListNode
  | ContentEquationNode
  | ContentGraphNode
  | ContentComponentNode;

export type ContentDocument = {
  nodes: ContentDocumentNode[];
  /** Raw LLM response preserved for inspection on failure / debug. */
  raw: string;
  warnings: string[];
};

export class ContentParseError extends Error {
  readonly code:
    | 'empty'
    | 'unclosed_fence'
    | 'unclosed_math'
    | 'unclosed_marker'
    | 'invalid_graph'
    | 'invalid_latex'
    | 'invalid_expression';

  constructor(code: ContentParseError['code'], message: string) {
    super(message);
    this.name = 'ContentParseError';
    this.code = code;
  }
}
