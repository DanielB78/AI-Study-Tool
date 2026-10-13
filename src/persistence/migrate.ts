import type {
  BaseElement,
  CanvasDocument,
  CanvasElement,
  ConnectorElement,
  DrawingElement,
  EquationElement,
  GraphElement,
  ImageElement,
  ShapeElement,
  StyleDefaults,
  TextElement,
} from '../types/canvas';
import { DOCUMENT_VERSION, DEFAULT_STYLE, createEmptyDocument } from '../types/canvas';
import { nanoid } from 'nanoid';
import {
  DEFAULT_GRAPH_SETTINGS,
  DEFAULT_GRAPH_VIEWPORT,
  nextExpressionColor,
} from '../features/graphs/types';
import { migrateToCanonicalSource } from '../features/graphs/expressionCodec';
import { parseRichTextDocument } from '../features/text/richTextValidate';
import { ensureBlockIds, newFeatureId } from '../features/text/textFeatures';
import type {
  TextComment,
  TextNote,
  TextTitle,
} from '../features/text/textFeatureTypes';
import {
  TEXT_COMMENT_TYPES,
  TEXT_NOTE_TYPES,
} from '../features/text/textFeatureTypes';
import {
  applyComponentStyleToElement,
  createTextComponentElement,
  isTextComponentType,
  type ComponentRole,
  type TextComponentType,
} from '../features/text/textComponents';
import { COMPONENT_LAYOUT } from '../features/text/textComponents';

/**
 * Convert legacy parser-native sources (x^2, 2x, …) to canonical GraphMathSyntax.
 * On failure, keep the original string — never silently corrupt graphs.
 */
function migrateGraphSourceText(raw: string): string {
  if (!raw.trim()) return '';
  const result = migrateToCanonicalSource(raw);
  if (result.ok) return result.canonical;
  return raw;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function colorOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  if (value === 'transparent') return null;
  if (typeof value === 'string') return value;
  return fallback;
}

function migrateBase(raw: Record<string, unknown>, zFallback: number): BaseElement {
  const t = Date.now();
  return {
    id: str(raw.id, `migrated-${Math.random().toString(36).slice(2, 10)}`),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: num(raw.width, 0),
    height: num(raw.height, 0),
    rotation: num(raw.rotation, 0),
    zIndex: num(raw.zIndex, zFallback),
    opacity: num(raw.opacity, 1),
    locked: bool(raw.locked, false),
    createdAt: num(raw.createdAt, t),
    updatedAt: num(raw.updatedAt, t),
    metadata: isObject(raw.metadata) ? (raw.metadata as Record<string, unknown>) : {},
  };
}

function migrateTitle(raw: unknown): TextTitle | undefined {
  if (typeof raw === 'string' && raw.trim()) {
    return { id: newFeatureId('title'), text: raw.trim() };
  }
  if (!isObject(raw)) return undefined;
  const text = str(raw.text, '').trim();
  if (!text) return undefined;
  return { id: str(raw.id, newFeatureId('title')), text };
}

function migrateNotes(raw: unknown): TextNote[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const notes: TextNote[] = [];
  raw.forEach((item, i) => {
    if (!isObject(item)) return;
    const text = str(item.text, '').trim();
    if (!text) return;
    const noteType = TEXT_NOTE_TYPES.includes(item.noteType as never)
      ? (item.noteType as TextNote['noteType'])
      : 'extra_information';
    notes.push({
      id: str(item.id, newFeatureId('note')),
      text,
      noteType,
      layoutMode: item.layoutMode === 'manual' ? 'manual' : 'auto',
      offsetX: typeof item.offsetX === 'number' ? item.offsetX : undefined,
      offsetY: typeof item.offsetY === 'number' ? item.offsetY : undefined,
      order: num(item.order, i),
    });
  });
  return notes.length ? notes : undefined;
}

function migrateComments(raw: unknown): TextComment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const comments: TextComment[] = [];
  for (const item of raw) {
    if (!isObject(item) || !isObject(item.anchor)) continue;
    const text = str(item.text, '').trim();
    if (!text) continue;
    const quote = str(item.anchor.quote, '').trim();
    const blockId = str(item.anchor.blockId, '').trim();
    if (!quote || !blockId) continue;
    const commentType = TEXT_COMMENT_TYPES.includes(item.commentType as never)
      ? (item.commentType as TextComment['commentType'])
      : 'explanation';
    comments.push({
      id: str(item.id, newFeatureId('comment')),
      text,
      commentType,
      displayState: item.displayState === 'open' ? 'open' : 'collapsed',
      panelOffsetX:
        typeof item.panelOffsetX === 'number' ? item.panelOffsetX : undefined,
      panelOffsetY:
        typeof item.panelOffsetY === 'number' ? item.panelOffsetY : undefined,
      anchor: {
        blockId,
        start: Math.max(0, num(item.anchor.start, 0)),
        end: Math.max(0, num(item.anchor.end, quote.length)),
        quote,
        status: item.anchor.status === 'unresolved' ? 'unresolved' : 'resolved',
      },
    });
  }
  return comments.length ? comments : undefined;
}

function migrateText(raw: Record<string, unknown>, z: number): TextElement {
  const legacyBold =
    raw.fontStyle === 'bold' || raw.fontWeight === 'bold';
  let richText: TextElement['richText'];
  if (raw.richText != null) {
    try {
      richText = parseRichTextDocument(raw.richText);
    } catch {
      richText = undefined;
    }
  }
  if (richText) richText = ensureBlockIds(richText);
  const title = migrateTitle(raw.title);
  const notes = migrateNotes(raw.notes);
  const comments = migrateComments(raw.comments);
  const componentType = isTextComponentType(raw.componentType)
    ? (raw.componentType as TextComponentType)
    : isTextComponentType(raw.metadata && isObject(raw.metadata) ? raw.metadata.componentType : null)
      ? (raw.metadata as Record<string, unknown>).componentType as TextComponentType
      : undefined;
  let componentMeta: TextElement['componentMeta'];
  if (isObject(raw.componentMeta)) {
    componentMeta = {
      placementMode:
        raw.componentMeta.placementMode === 'manual' ? 'manual' : 'auto',
      ...(typeof raw.componentMeta.associatedElementId === 'string'
        ? { associatedElementId: raw.componentMeta.associatedElementId }
        : {}),
      ...(typeof raw.componentMeta.label === 'string'
        ? { label: raw.componentMeta.label }
        : {}),
      ...(typeof raw.componentMeta.number === 'number'
        ? { number: raw.componentMeta.number }
        : {}),
      ...(typeof raw.componentMeta.variant === 'string'
        ? {
            variant: raw.componentMeta.variant as
              | 'warning'
              | 'common_mistake'
              | 'important_caution',
          }
        : {}),
      ...(typeof raw.componentMeta.role === 'string'
        ? { role: raw.componentMeta.role as ComponentRole }
        : {}),
      ...(isObject(raw.componentMeta.anchor)
        ? {
            anchor: {
              targetElementId: str(raw.componentMeta.anchor.targetElementId, ''),
              blockId: str(raw.componentMeta.anchor.blockId, ''),
              start: num(raw.componentMeta.anchor.start, 0),
              end: num(raw.componentMeta.anchor.end, 0),
              quote: str(raw.componentMeta.anchor.quote, ''),
              status:
                raw.componentMeta.anchor.status === 'unresolved'
                  ? 'unresolved'
                  : 'resolved',
            },
          }
        : {}),
      ...(isObject(raw.componentMeta.graphAnchor)
        ? {
            graphAnchor: {
              targetGraphId: str(
                raw.componentMeta.graphAnchor.targetGraphId,
                '',
              ),
              ...(typeof raw.componentMeta.graphAnchor.expressionId === 'string'
                ? { expressionId: raw.componentMeta.graphAnchor.expressionId }
                : {}),
              ...(typeof raw.componentMeta.graphAnchor.pointId === 'string'
                ? { pointId: raw.componentMeta.graphAnchor.pointId }
                : {}),
              ...(typeof raw.componentMeta.graphAnchor.x === 'number'
                ? { x: raw.componentMeta.graphAnchor.x }
                : {}),
              status:
                raw.componentMeta.graphAnchor.status === 'unresolved'
                  ? 'unresolved'
                  : 'resolved',
            },
          }
        : {}),
    };
  }
  return {
    ...migrateBase(raw, z),
    type: 'text',
    text: str(raw.text, ''),
    ...(richText ? { richText } : {}),
    ...(componentType ? { componentType } : {}),
    ...(componentMeta ? { componentMeta } : {}),
    ...(title ? { title } : {}),
    ...(notes ? { notes } : {}),
    ...(comments ? { comments } : {}),
    fontSize: num(raw.fontSize, DEFAULT_STYLE.fontSize),
    fontFamily: str(raw.fontFamily, DEFAULT_STYLE.fontFamily),
    fontWeight: legacyBold ? 'bold' : 'normal',
    fontItalic: bool(raw.fontItalic, raw.fontStyle === 'italic'),
    underline: bool(raw.underline, false),
    strikethrough: bool(raw.strikethrough, false),
    color: str(raw.color, DEFAULT_STYLE.textColor),
    alignment:
      raw.alignment === 'center' || raw.alignment === 'right' ? raw.alignment : 'left',
    lineHeight: num(raw.lineHeight, DEFAULT_STYLE.lineHeight),
    backgroundColor: colorOrNull(raw.backgroundColor, null),
    padding: num(raw.padding, DEFAULT_STYLE.textPadding),
    cornerRadius: num(raw.cornerRadius, DEFAULT_STYLE.textCornerRadius),
  };
}

/**
 * Convert legacy nested title/notes/comments into standalone textbook
 * TextElements. Preserves content; strips nested fields from the parent.
 */
function flattenLegacyTextFeatures(elements: CanvasElement[]): CanvasElement[] {
  const out: CanvasElement[] = [];
  let zBoost = 0;
  for (const el of elements) {
    if (el.type !== 'text') {
      out.push(el);
      continue;
    }
    let main: TextElement = {
      ...el,
      componentType: el.componentType ?? 'main_text',
    };
    if (!main.componentType) main.componentType = 'main_text';

    if (main.title?.text.trim()) {
      const titleEl = createTextComponentElement({
        componentType: 'title',
        text: main.title.text,
        position: {
          x: main.x,
          y: main.y - 40 - COMPONENT_LAYOUT.titleGap,
        },
        zIndex: main.zIndex + ++zBoost,
        meta: {
          placementMode: 'auto',
          associatedElementId: main.id,
        },
        metadata: { migratedFrom: 'legacy_title', legacyTitleId: main.title.id },
      });
      out.push(titleEl);
    }

    for (const note of main.notes ?? []) {
      const kind: TextComponentType =
        note.noteType === 'caution'
          ? 'warning'
          : note.noteType === 'important'
            ? 'definition'
            : 'example';
      const noteEl = createTextComponentElement({
        componentType: kind,
        text: note.text,
        position: {
          x: main.x + (note.offsetX ?? 0),
          y: main.y + main.height + COMPONENT_LAYOUT.stackGap + (note.offsetY ?? 0),
        },
        zIndex: main.zIndex + ++zBoost,
        meta: {
          placementMode: note.layoutMode === 'manual' ? 'manual' : 'auto',
          associatedElementId: main.id,
          label: note.noteType === 'extra_information' ? 'Note' : undefined,
          variant: note.noteType === 'caution' ? 'important_caution' : undefined,
        },
        metadata: { migratedFrom: 'legacy_note', legacyNoteId: note.id },
      });
      out.push(noteEl);
    }

    for (const comment of main.comments ?? []) {
      const commentEl = createTextComponentElement({
        componentType: 'linked_comment',
        text: comment.text,
        position: {
          x: main.x + main.width + COMPONENT_LAYOUT.sideGap,
          y: main.y + (comment.panelOffsetY ?? 0),
        },
        zIndex: main.zIndex + ++zBoost,
        meta: {
          placementMode: 'auto',
          associatedElementId: main.id,
          label: 'Comment',
          anchor: {
            targetElementId: main.id,
            blockId: comment.anchor.blockId,
            start: comment.anchor.start,
            end: comment.anchor.end,
            quote: comment.anchor.quote,
            status: comment.anchor.status,
          },
        },
        metadata: {
          migratedFrom: 'legacy_comment',
          legacyCommentId: comment.id,
        },
      });
      out.push(commentEl);
    }

    // Strip nested bags — content now lives in sibling elements.
    const {
      title: _t,
      notes: _n,
      comments: _c,
      ...rest
    } = main;
    main = applyComponentStyleToElement(
      { ...rest, componentType: rest.componentType ?? 'main_text' },
      rest.componentType ?? 'main_text',
      rest.componentMeta,
    );
    // Preserve original geometry/style for main_text when already user-styled
    if (!el.componentType) {
      main = {
        ...main,
        fontSize: el.fontSize,
        fontFamily: el.fontFamily,
        fontWeight: el.fontWeight,
        color: el.color,
        backgroundColor: el.backgroundColor,
        padding: el.padding,
        cornerRadius: el.cornerRadius,
        width: el.width,
        height: el.height,
        x: el.x,
        y: el.y,
      };
    }
    out.push(main);
  }
  return out;
}

function migrateShape(raw: Record<string, unknown>, z: number): ShapeElement {
  const shapeType =
    raw.shapeType === 'roundedRect' ||
    raw.shapeType === 'ellipse' ||
    raw.shapeType === 'triangle' ||
    raw.shapeType === 'diamond' ||
    raw.shapeType === 'pentagon' ||
    raw.shapeType === 'hexagon' ||
    raw.shapeType === 'star' ||
    raw.shapeType === 'callout' ||
    raw.shapeType === 'parallelogram'
      ? raw.shapeType
      : 'rectangle';

  return {
    ...migrateBase(raw, z),
    type: 'shape',
    shapeType,
    fill: colorOrNull(raw.fill, DEFAULT_STYLE.fillColor),
    stroke: colorOrNull(raw.stroke, DEFAULT_STYLE.strokeColor),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
    cornerRadius: num(raw.cornerRadius, shapeType === 'roundedRect' ? 16 : 0),
    starPoints: num(raw.starPoints, 5),
    starInnerRatio: num(raw.starInnerRatio, 0.45),
    label: str(raw.label, ''),
    labelFontSize: num(raw.labelFontSize, 16),
    labelFontFamily: str(raw.labelFontFamily, DEFAULT_STYLE.fontFamily),
    labelFontWeight: raw.labelFontWeight === 'bold' ? 'bold' : 'normal',
    labelFontItalic: bool(raw.labelFontItalic, false),
    labelColor: str(raw.labelColor, DEFAULT_STYLE.textColor),
  };
}

function migrateDrawing(raw: Record<string, unknown>, z: number): DrawingElement {
  const points = Array.isArray(raw.points)
    ? raw.points.filter((p): p is number => typeof p === 'number')
    : [];
  return {
    ...migrateBase(raw, z),
    type: 'drawing',
    points,
    color: str(raw.color, DEFAULT_STYLE.strokeColor ?? '#1a1a1a'),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
  };
}

function migrateImage(raw: Record<string, unknown>, z: number): ImageElement {
  return {
    ...migrateBase(raw, z),
    type: 'image',
    src: str(raw.src, ''),
    naturalWidth: num(raw.naturalWidth, num(raw.width, 1)),
    naturalHeight: num(raw.naturalHeight, num(raw.height, 1)),
  };
}

function migrateEquation(raw: Record<string, unknown>, z: number): EquationElement {
  return {
    ...migrateBase(raw, z),
    type: 'equation',
    latex: str(raw.latex, ''),
    fontSize: num(raw.fontSize, 28),
    color: str(raw.color, DEFAULT_STYLE.textColor),
    displayMode: raw.displayMode === 'inline' ? 'inline' : 'display',
  };
}

function migrateGraph(raw: Record<string, unknown>, z: number): GraphElement {
  const viewportRaw = isObject(raw.viewport) ? raw.viewport : {};
  const settingsRaw = isObject(raw.settings) ? raw.settings : {};
  const expressionsRaw = Array.isArray(raw.expressions) ? raw.expressions : [];
  const pointsRaw = Array.isArray(raw.points) ? raw.points : [];

  const expressions = expressionsRaw
    .filter(isObject)
    .map((expr, index) => {
      const styleRaw = isObject(expr.style) ? expr.style : {};
      return {
        id: str(expr.id, `expr-${index}`),
        sourceText: migrateGraphSourceText(str(expr.sourceText, '')),
        visible: bool(expr.visible, true),
        domainMin:
          typeof expr.domainMin === 'number' && Number.isFinite(expr.domainMin)
            ? expr.domainMin
            : null,
        domainMax:
          typeof expr.domainMax === 'number' && Number.isFinite(expr.domainMax)
            ? expr.domainMax
            : null,
        style: {
          color: str(styleRaw.color, nextExpressionColor(index)),
          strokeWidth: num(styleRaw.strokeWidth, 2),
        },
      };
    });

  const points = pointsRaw.filter(isObject).map((p, index) => ({
    id: str(p.id, `pt-${index}`),
    x: num(p.x, 0),
    y: num(p.y, 0),
    visible: bool(p.visible, true),
    label: str(p.label, ''),
    color: str(p.color, '#111827'),
  }));

  let association: GraphElement['association'];
  if (isObject(raw.association)) {
    association = {
      placementMode:
        raw.association.placementMode === 'manual' ? 'manual' : 'auto',
      ...(typeof raw.association.associatedElementId === 'string'
        ? { associatedElementId: raw.association.associatedElementId }
        : {}),
      ...(typeof raw.association.order === 'number'
        ? { order: raw.association.order }
        : {}),
    };
  }

  return {
    ...migrateBase(raw, z),
    type: 'graph',
    expressions,
    points,
    viewport: {
      xMin: num(viewportRaw.xMin, DEFAULT_GRAPH_VIEWPORT.xMin),
      xMax: num(viewportRaw.xMax, DEFAULT_GRAPH_VIEWPORT.xMax),
      yMin: num(viewportRaw.yMin, DEFAULT_GRAPH_VIEWPORT.yMin),
      yMax: num(viewportRaw.yMax, DEFAULT_GRAPH_VIEWPORT.yMax),
    },
    settings: {
      showGrid: bool(settingsRaw.showGrid, DEFAULT_GRAPH_SETTINGS.showGrid),
      showXAxis: bool(settingsRaw.showXAxis, DEFAULT_GRAPH_SETTINGS.showXAxis),
      showYAxis: bool(settingsRaw.showYAxis, DEFAULT_GRAPH_SETTINGS.showYAxis),
      xAxisLabel: str(settingsRaw.xAxisLabel, ''),
      yAxisLabel: str(settingsRaw.yAxisLabel, ''),
      title: str(settingsRaw.title, ''),
    },
    ...(association ? { association } : {}),
  };
}

function migrateConnector(raw: Record<string, unknown>, z: number): ConnectorElement {
  const pts = Array.isArray(raw.points) ? raw.points : [0, 0, 1, 1];
  const points: [number, number, number, number] = [
    num(pts[0], 0),
    num(pts[1], 0),
    num(pts[2], 1),
    num(pts[3], 1),
  ];
  const connectorType = raw.connectorType === 'arrow' ? 'arrow' : 'line';
  let arrowHeads: ConnectorElement['arrowHeads'] = 'none';
  if (raw.arrowHeads === 'end' || raw.arrowHeads === 'both' || raw.arrowHeads === 'none') {
    arrowHeads = raw.arrowHeads;
  } else if (connectorType === 'arrow') {
    arrowHeads = 'end';
  }

  return {
    ...migrateBase(raw, z),
    type: 'connector',
    connectorType,
    points,
    stroke: str(raw.stroke, '#1a1a1a'),
    strokeWidth: num(raw.strokeWidth, DEFAULT_STYLE.strokeWidth),
    strokeStyle:
      raw.strokeStyle === 'dashed' || raw.strokeStyle === 'dotted'
        ? raw.strokeStyle
        : 'solid',
    arrowHeads,
    startBindingId:
      typeof raw.startBindingId === 'string' || raw.startBindingId === null
        ? (raw.startBindingId as string | null)
        : null,
    endBindingId:
      typeof raw.endBindingId === 'string' || raw.endBindingId === null
        ? (raw.endBindingId as string | null)
        : null,
  };
}

export function migrateElement(raw: unknown, index: number): CanvasElement | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'text':
      return migrateText(raw, index + 1);
    case 'equation':
      return migrateEquation(raw, index + 1);
    case 'shape':
      return migrateShape(raw, index + 1);
    case 'drawing':
      return migrateDrawing(raw, index + 1);
    case 'image':
      return migrateImage(raw, index + 1);
    case 'graph':
      return migrateGraph(raw, index + 1);
    case 'connector':
      return migrateConnector(raw, index + 1);
    default:
      return null;
  }
}

/** Normalize any supported document version into the current schema. */
export function migrateDocument(raw: unknown): CanvasDocument | null {
  if (!isObject(raw)) return null;
  if (!Array.isArray(raw.elements) || !isObject(raw.camera)) return null;

  const version = raw.version;
  if (
    version !== 1 &&
    version !== 2 &&
    version !== 3 &&
    version !== 4 &&
    version !== 5 &&
    version !== 6 &&
    version !== DOCUMENT_VERSION
  ) {
    return null;
  }

  const camera = raw.camera;
  if (
    typeof camera.x !== 'number' ||
    typeof camera.y !== 'number' ||
    typeof camera.zoom !== 'number'
  ) {
    return null;
  }

  const elements = raw.elements
    .map((el, i) => migrateElement(el, i))
    .filter((el): el is CanvasElement => el !== null);

  const flattened = flattenLegacyTextFeatures(elements);

  const existingId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;

  return {
    version: DOCUMENT_VERSION,
    id: existingId ?? nanoid(12),
    elements: flattened,
    camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
  };
}

export function styleFromElement(el: CanvasElement, style: StyleDefaults): StyleDefaults {
  switch (el.type) {
    case 'text':
      return {
        ...style,
        textColor: el.color,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        fontItalic: el.fontItalic,
        underline: el.underline,
        strikethrough: el.strikethrough,
        fontFamily: el.fontFamily,
        textAlignment: el.alignment,
        lineHeight: el.lineHeight,
        textBackgroundColor: el.backgroundColor,
        textPadding: el.padding,
        textCornerRadius: el.cornerRadius,
        opacity: el.opacity,
      };
    case 'equation':
      return {
        ...style,
        textColor: el.color,
        fontSize: el.fontSize,
        opacity: el.opacity,
      };
    case 'shape':
      return {
        ...style,
        fillColor: el.fill,
        strokeColor: el.stroke,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        cornerRadius: el.cornerRadius,
        opacity: el.opacity,
        fontSize: el.labelFontSize,
        fontFamily: el.labelFontFamily,
        fontWeight: el.labelFontWeight,
        fontItalic: el.labelFontItalic,
        textColor: el.labelColor,
      };
    case 'drawing':
      return {
        ...style,
        strokeColor: el.color,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        opacity: el.opacity,
      };
    case 'connector':
      return {
        ...style,
        strokeColor: el.stroke,
        strokeWidth: el.strokeWidth,
        strokeStyle: el.strokeStyle,
        opacity: el.opacity,
        arrowHeads: el.arrowHeads,
      };
    case 'image':
      return { ...style, opacity: el.opacity };
    case 'graph':
      return { ...style, opacity: el.opacity };
    default:
      return style;
  }
}

export { createEmptyDocument };
