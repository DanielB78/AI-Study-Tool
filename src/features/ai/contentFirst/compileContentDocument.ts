/**
 * Compile ContentDocument → CanvasAgentResponse (existing operation schema).
 * Reading order = node order. Layout = chronological single column.
 *
 * Adjacent paragraphs/lists are merged into one TextElement (multiple rich-text
 * blocks) so blank-line-per-sentence LLM output does not create one object per line.
 * Textbook feature components / auto associations are intentionally not applied.
 */

import type {
  AgentRichTextDocument,
  AgentRichTextSpan,
  CanvasAgentResponse,
  CanvasOperation,
  CreateGraphOperation,
  CreateTextOperation,
  CreateEquationOperation,
} from '../agent/operations';
import type {
  ContentDocument,
  ContentInlineSpan,
} from './types';

export type ContentAssociationPlan = {
  /** Operation ref of equation/graph/text. */
  childRef: string;
  /** Operation ref of section heading TextElement (when present). */
  sectionRef: string;
  kind: 'equation' | 'graph' | 'text' | 'component';
  /** When kind === 'component', the textbook component type to apply after create. */
  componentType?: 'definition' | 'example' | 'warning' | 'exercise';
};

export type CompileContentResult = {
  response: CanvasAgentResponse;
  /** Kept for API compatibility; content-first currently leaves this empty. */
  associationPlan: ContentAssociationPlan[];
  /** ref → sectionId from IR (for debug / post-association). */
  refSectionIds: Record<string, string | null>;
};

function spansToAgent(spans: ContentInlineSpan[]): AgentRichTextSpan[] {
  return spans.map((s) => {
    if (s.type === 'inline_math') {
      return { type: 'inline_math' as const, latex: s.latex };
    }
    const style =
      s.style?.bold || s.style?.italic
        ? {
            ...(s.style.bold ? { bold: true as const } : {}),
            ...(s.style.italic ? { italic: true as const } : {}),
          }
        : undefined;
    return style ? { text: s.text, style } : { text: s.text };
  });
}

function headingRichText(
  level: 1 | 2 | 3,
  spans: ContentInlineSpan[],
): AgentRichTextDocument {
  const size =
    level === 1 ? 'heading_large' : level === 2 ? 'heading' : 'subheading';
  return {
    blocks: [
      {
        type: 'heading',
        spans: spansToAgent(spans).map((s) => {
          if ('type' in s && s.type === 'inline_math') return s;
          return {
            text: 'text' in s ? s.text : '',
            style: { bold: true, font_size: size },
          };
        }),
      },
    ],
  };
}

type ProseChunk =
  | {
      kind: 'paragraph';
      spans: ContentInlineSpan[];
      text: string;
      sectionId: string | null;
    }
  | {
      kind: 'list';
      ordered: boolean;
      items: Array<{ spans: ContentInlineSpan[]; text: string }>;
      sectionId: string | null;
    }
  | {
      kind: 'table';
      columns: Array<{ alignment: 'left' | 'center' | 'right' }>;
      rows: Array<{
        header?: boolean;
        cells: Array<{ spans: ContentInlineSpan[]; text: string }>;
      }>;
      text: string;
      sectionId: string | null;
    };

/**
 * Compile IR nodes into validated-shaped canvas operations.
 * Does not invent coordinates — uses chronological_grid layout.
 */
export function compileContentDocument(
  doc: ContentDocument,
): CompileContentResult {
  const operations: CanvasOperation[] = [];
  const associationPlan: ContentAssociationPlan[] = [];
  const refSectionIds: Record<string, string | null> = {};
  let seq = 0;
  const nextRef = (prefix: string) => {
    seq += 1;
    return `${prefix}_${seq}`;
  };

  /** Buffer adjacent prose until a structural boundary (heading / eq / graph). */
  let proseBuf: ProseChunk[] = [];

  const flushProse = () => {
    if (proseBuf.length === 0) return;
    const sectionId = proseBuf[0]?.sectionId ?? null;
    const ref = nextRef('p');
    refSectionIds[ref] = sectionId;

    const blocks: AgentRichTextDocument['blocks'] = [];
    const plainParts: string[] = [];

    for (const chunk of proseBuf) {
      if (chunk.kind === 'paragraph') {
        const text = chunk.text.trim();
        if (!text) continue;
        blocks.push({
          type: 'paragraph',
          spans: spansToAgent(chunk.spans),
        });
        plainParts.push(text);
      } else if (chunk.kind === 'list') {
        for (const item of chunk.items) {
          blocks.push({
            type: chunk.ordered ? 'numbered' : 'bullet',
            spans: spansToAgent(item.spans),
          });
          plainParts.push(item.text);
        }
      } else {
        blocks.push({
          type: 'table',
          columns: chunk.columns.map((c) => ({ alignment: c.alignment })),
          rows: chunk.rows.map((r) => ({
            ...(r.header ? { header: true as const } : {}),
            cells: r.cells.map((c) => ({ spans: spansToAgent(c.spans) })),
          })),
        });
        plainParts.push(chunk.text);
      }
    }

    proseBuf = [];
    if (blocks.length === 0) return;

    const op: CreateTextOperation = {
      type: 'create_text',
      ref,
      layout_role: 'explanation',
      text: plainParts.join('\n\n'),
      rich_text: { blocks },
      placement: { mode: 'viewport_default' },
    };
    operations.push(op);
  };

  for (const node of doc.nodes) {
    switch (node.type) {
      case 'heading': {
        flushProse();
        const ref = nextRef('h');
        refSectionIds[ref] = node.sectionId;
        const op: CreateTextOperation = {
          type: 'create_text',
          ref,
          layout_role: node.level === 1 ? 'introduction' : 'explanation',
          text: node.text,
          rich_text: headingRichText(node.level, node.spans),
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        break;
      }
      case 'paragraph': {
        if (!node.text.trim()) break;
        proseBuf.push({
          kind: 'paragraph',
          spans: node.spans,
          text: node.text,
          sectionId: node.sectionId,
        });
        break;
      }
      case 'list': {
        proseBuf.push({
          kind: 'list',
          ordered: node.ordered,
          items: node.items,
          sectionId: node.sectionId,
        });
        break;
      }
      case 'table': {
        proseBuf.push({
          kind: 'table',
          columns: node.columns,
          rows: node.rows,
          text: node.text,
          sectionId: node.sectionId,
        });
        break;
      }
      case 'equation': {
        flushProse();
        const ref = nextRef('eq');
        refSectionIds[ref] = node.sectionId;
        const op: CreateEquationOperation = {
          type: 'create_equation',
          ref,
          layout_role: 'mathematical_step',
          latex: node.latex,
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        break;
      }
      case 'graph': {
        flushProse();
        const ref = nextRef('g');
        refSectionIds[ref] = node.sectionId;
        const op: CreateGraphOperation = {
          type: 'create_graph',
          ref,
          layout_role: 'visualisation',
          expressions: node.expressions.map((expression) => ({
            expression,
            visible: true,
            domain_min: null,
            domain_max: null,
          })),
          points: [],
          viewport: {
            x_min: node.xMin ?? -10,
            x_max: node.xMax ?? 10,
            y_min: node.yMin ?? -10,
            y_max: node.yMax ?? 10,
          },
          settings: {
            title: node.title,
            x_axis_label: node.xLabel,
            y_axis_label: node.yLabel,
            show_grid: true,
            show_x_axis: true,
            show_y_axis: true,
          },
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        break;
      }
      case 'component': {
        // Feature components on hold — treat body as ordinary prose in the buffer.
        if (!node.text.trim()) break;
        proseBuf.push({
          kind: 'paragraph',
          spans: node.spans,
          text: node.text,
          sectionId: node.sectionId,
        });
        break;
      }
    }
  }
  flushProse();

  const response: CanvasAgentResponse = {
    output_type: 'lesson',
    layout: {
      type: 'chronological_grid',
      placement: { mode: 'viewport_default' },
    },
    operations,
  };

  return { response, associationPlan, refSectionIds };
}
