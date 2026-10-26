/**
 * Compile ContentDocument → CanvasAgentResponse (existing operation schema).
 * Reading order = node order. Layout = chronological single column.
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
  ContentDocumentNode,
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
  associationPlan: ContentAssociationPlan[];
  /** ref → sectionId from IR (for debug / post-association). */
  refSectionIds: Record<string, string | null>;
};

function spansToAgent(
  spans: ContentInlineSpan[],
): AgentRichTextSpan[] {
  return spans.map((s) => {
    if (s.type === 'inline_math') {
      return { type: 'inline_math' as const, latex: s.latex };
    }
    return { text: s.text };
  });
}

function paragraphRichText(spans: ContentInlineSpan[]): AgentRichTextDocument {
  return {
    blocks: [
      {
        type: 'paragraph',
        spans: spansToAgent(spans),
      },
    ],
  };
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

function listRichText(
  ordered: boolean,
  items: Array<{ spans: ContentInlineSpan[] }>,
): AgentRichTextDocument {
  return {
    blocks: items.map((item) => ({
      type: ordered ? ('numbered' as const) : ('bullet' as const),
      spans: spansToAgent(item.spans),
    })),
  };
}

function plainFromSpans(spans: ContentInlineSpan[]): string {
  return spans
    .map((s) => (s.type === 'text' ? s.text : s.latex))
    .join('')
    .trim();
}

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
  /** sectionId → heading operation ref */
  const sectionHeadingRef = new Map<string, string>();
  let seq = 0;
  const nextRef = (prefix: string) => {
    seq += 1;
    return `${prefix}_${seq}`;
  };

  for (const node of doc.nodes) {
    compileNode(node);
  }

  function compileNode(node: ContentDocumentNode): void {
    switch (node.type) {
      case 'heading': {
        const ref = nextRef('h');
        sectionHeadingRef.set(node.sectionId, ref);
        refSectionIds[ref] = node.sectionId;
        const op: CreateTextOperation = {
          type: 'create_text',
          ref,
          layout_cell: node.sectionId,
          layout_role: node.level === 1 ? 'introduction' : 'explanation',
          text: node.text,
          rich_text: headingRichText(node.level, node.spans),
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        break;
      }
      case 'paragraph': {
        const ref = nextRef('p');
        refSectionIds[ref] = node.sectionId;
        const op: CreateTextOperation = {
          type: 'create_text',
          ref,
          ...(node.sectionId ? { layout_cell: node.sectionId } : {}),
          layout_role: 'explanation',
          text: node.text,
          rich_text: paragraphRichText(node.spans),
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        if (node.sectionId) {
          const sectionRef = sectionHeadingRef.get(node.sectionId);
          if (sectionRef) {
            associationPlan.push({
              childRef: ref,
              sectionRef,
              kind: 'text',
            });
          }
        }
        break;
      }
      case 'list': {
        const ref = nextRef('list');
        refSectionIds[ref] = node.sectionId;
        const text = node.items.map((it) => it.text).join('\n');
        const op: CreateTextOperation = {
          type: 'create_text',
          ref,
          ...(node.sectionId ? { layout_cell: node.sectionId } : {}),
          layout_role: 'explanation',
          text,
          rich_text: listRichText(node.ordered, node.items),
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        break;
      }
      case 'equation': {
        const ref = nextRef('eq');
        refSectionIds[ref] = node.sectionId;
        const op: CreateEquationOperation = {
          type: 'create_equation',
          ref,
          ...(node.sectionId ? { layout_cell: node.sectionId } : {}),
          layout_role: 'mathematical_step',
          latex: node.latex,
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        if (node.sectionId) {
          const sectionRef = sectionHeadingRef.get(node.sectionId);
          if (sectionRef) {
            associationPlan.push({
              childRef: ref,
              sectionRef,
              kind: 'equation',
            });
          }
        }
        break;
      }
      case 'graph': {
        const ref = nextRef('g');
        refSectionIds[ref] = node.sectionId;
        const op: CreateGraphOperation = {
          type: 'create_graph',
          ref,
          ...(node.sectionId ? { layout_cell: node.sectionId } : {}),
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
        if (node.sectionId) {
          const sectionRef = sectionHeadingRef.get(node.sectionId);
          if (sectionRef) {
            associationPlan.push({
              childRef: ref,
              sectionRef,
              kind: 'graph',
            });
          }
        }
        break;
      }
      case 'component': {
        // Emit as chronological create_text so reading order + layout stay consistent;
        // textbook component styling is applied after execute via associationPlan.
        const ref = nextRef(node.component);
        refSectionIds[ref] = node.sectionId;
        const label =
          node.component.charAt(0).toUpperCase() + node.component.slice(1);
        const op: CreateTextOperation = {
          type: 'create_text',
          ref,
          ...(node.sectionId ? { layout_cell: node.sectionId } : {}),
          layout_role: 'explanation',
          text: `${label}\n${node.text}`,
          rich_text: {
            blocks: [
              {
                type: 'heading',
                spans: [
                  {
                    text: label,
                    style: { bold: true, font_size: 'subheading' },
                  },
                ],
              },
              {
                type: 'paragraph',
                spans: spansToAgent(node.spans),
              },
            ],
          },
          placement: { mode: 'viewport_default' },
        };
        operations.push(op);
        const sectionRef = node.sectionId
          ? sectionHeadingRef.get(node.sectionId)
          : undefined;
        associationPlan.push({
          childRef: ref,
          sectionRef: sectionRef ?? ref,
          kind: 'component',
          componentType: node.component,
        });
        break;
      }
    }
  }

  void plainFromSpans;

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
