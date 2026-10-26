/**
 * Parse Markdown → compile ops → validate via existing parser path → execute.
 * Applies section associations after create using plan refs.
 */

import { useCanvasStore } from '../../../store/canvasStore';
import { applyComponentStyleToElement } from '../../text/textComponents';
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
  type ContentAssociationPlan,
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

function applyAssociations(
  associationPlan: ContentAssociationPlan[],
  refMap: ReadonlyMap<string, string>,
): void {
  if (associationPlan.length === 0) return;
  const store = useCanvasStore.getState();
  for (const link of associationPlan) {
    const childId = refMap.get(link.childRef);
    const parentId = refMap.get(link.sectionRef);
    if (!childId || !parentId) continue;
    if (link.kind === 'equation' || link.kind === 'graph') {
      store.updateElement(childId, (el) => {
        if (el.type !== 'equation' && el.type !== 'graph') return el;
        return {
          ...el,
          association: {
            associatedElementId: parentId,
            placementMode: el.association?.placementMode ?? 'auto',
            order: el.association?.order,
          },
        };
      });
    } else if (link.kind === 'text') {
      store.updateElement(childId, (el) => {
        if (el.type !== 'text') return el;
        return {
          ...el,
          componentMeta: {
            ...(el.componentMeta ?? { placementMode: 'auto' }),
            associatedElementId: parentId,
            placementMode: el.componentMeta?.placementMode ?? 'auto',
            role: el.componentMeta?.role,
          },
        };
      });
    } else if (link.kind === 'component' && link.componentType) {
      store.updateElement(childId, (el) => {
        if (el.type !== 'text') return el;
        const associated =
          parentId !== childId ? parentId : el.componentMeta?.associatedElementId;
        return applyComponentStyleToElement(el, link.componentType!, {
          placementMode: 'auto',
          ...(associated ? { associatedElementId: associated } : {}),
          label:
            link.componentType!.charAt(0).toUpperCase() +
            link.componentType!.slice(1),
        });
      });
    }
  }
  store.persist();
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

/** Parse, validate, execute, then wire section associations. */
export function handleContentFirstResponse(
  raw: string,
  ctx: ParseContext,
): ContentFirstHandleResult {
  const parsed = parseContentFirstToAgentResponse(raw, ctx);
  const execution = executeAgentOperationsLive(parsed.response);
  const refMap = execution.planRefMap ?? new Map<string, string>();
  applyAssociations(parsed.compile.associationPlan, refMap);
  return {
    kind: 'content_first',
    ...parsed,
    execution,
  };
}

export { ContentParseError };
