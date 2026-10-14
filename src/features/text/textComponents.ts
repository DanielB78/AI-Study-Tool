/**
 * Textbook-style TextElement components.
 * The LLM chooses type + content; the app owns style and placement.
 */

import type { FontWeight, TextAlignment, TextElement } from '../../types/canvas';
import { createBaseFields } from '../../utils/ids';
import { plainTextToRichText, richTextToPlainText, type RichTextDocument } from './richText';
import { TextElementAutoSizer, type TextStyleConfig } from './textAutoSizer';

export const TEXT_COMPONENT_TYPES = [
  'main_text',
  'title',
  'definition',
  'example',
  'warning',
  'linked_comment',
  'exercise',
  /** Muted description below a GraphElement. */
  'caption',
  /** Key mathematical/physical observation associated with a graph. */
  'key_observation',
] as const;

export type TextComponentType = (typeof TEXT_COMPONENT_TYPES)[number];

/** Semantic role of a TextElement relative to its associated element. */
export const COMPONENT_ROLES = [
  'graph_title',
  'graph_caption',
  'graph_observation',
  'graph_comment',
  /** General textbook components attached to a GraphElement. */
  'graph_explanation',
  'graph_definition',
  'graph_example',
  'graph_warning',
  'graph_exercise',
  'attached_graph_parent',
  /** Textbook components attached to an EquationElement. */
  'equation_title',
  'equation_lead_in',
  'equation_step_explanation',
  'equation_symbol_definitions',
  'equation_interpretation',
  'equation_warning',
] as const;
export type ComponentRole = (typeof COMPONENT_ROLES)[number];

/** Equation-associated semantic component kinds (agent + UI). */
export const EQUATION_COMPONENT_KINDS = [
  'title',
  'lead_in',
  'step_explanation',
  'symbol_definitions',
  'interpretation',
  'warning',
] as const;
export type EquationComponentKind = (typeof EQUATION_COMPONENT_KINDS)[number];

export function isEquationComponentKind(v: string): v is EquationComponentKind {
  return (EQUATION_COMPONENT_KINDS as readonly string[]).includes(v);
}

/** Map equation component kind → TextComponentType + role. */
export function equationComponentMapping(kind: EquationComponentKind): {
  componentType: TextComponentType;
  role: ComponentRole;
  defaultLabel: string | null;
} {
  switch (kind) {
    case 'title':
      return { componentType: 'title', role: 'equation_title', defaultLabel: null };
    case 'lead_in':
      return {
        componentType: 'main_text',
        role: 'equation_lead_in',
        defaultLabel: null,
      };
    case 'step_explanation':
      // Normal textbook paragraph (~15px, left, no chrome).
      return {
        componentType: 'main_text',
        role: 'equation_step_explanation',
        defaultLabel: null,
      };
    case 'symbol_definitions':
      // Smaller muted "where …" clarifications (~13px), not bordered cards.
      return {
        componentType: 'caption',
        role: 'equation_symbol_definitions',
        defaultLabel: 'where',
      };
    case 'interpretation':
      // Closing textbook paragraph — same body style as step explanations.
      return {
        componentType: 'main_text',
        role: 'equation_interpretation',
        defaultLabel: null,
      };
    case 'warning':
      return {
        componentType: 'warning',
        role: 'equation_warning',
        defaultLabel: 'Warning',
      };
  }
}

/** Map textbook component type → graph-association role. */
export function graphRoleForComponentType(
  component: TextComponentType,
): ComponentRole | null {
  switch (component) {
    case 'title':
      return 'graph_title';
    case 'caption':
      return 'graph_caption';
    case 'key_observation':
      return 'graph_observation';
    case 'linked_comment':
      return 'graph_comment';
    case 'main_text':
      return 'graph_explanation';
    case 'definition':
      return 'graph_definition';
    case 'example':
      return 'graph_example';
    case 'warning':
      return 'graph_warning';
    case 'exercise':
      return 'graph_exercise';
    default:
      return null;
  }
}

/** Components creatable via add_text_to_graph (specialised ops cover the rest). */
export const GRAPH_ATTACHABLE_COMPONENT_TYPES = [
  'main_text',
  'definition',
  'example',
  'warning',
  'exercise',
] as const satisfies readonly TextComponentType[];

export type GraphAttachableComponentType =
  (typeof GRAPH_ATTACHABLE_COMPONENT_TYPES)[number];

export function isGraphAttachableComponentType(
  v: string,
): v is GraphAttachableComponentType {
  return (GRAPH_ATTACHABLE_COMPONENT_TYPES as readonly string[]).includes(v);
}

export const TEXT_COMPONENT_VARIANTS = [
  'warning',
  'common_mistake',
  'important_caution',
] as const;
export type TextComponentVariant = (typeof TEXT_COMPONENT_VARIANTS)[number];

export type ComponentPlacementMode = 'auto' | 'manual';

/** Persistent component metadata on a TextElement. */
export type TextComponentMeta = {
  /**
   * Logical association to another canvas element (TextElement or GraphElement).
   */
  associatedElementId?: string;
  placementMode: ComponentPlacementMode;
  /** Display label override (e.g. "Definition", "Example 1"). */
  label?: string;
  /** Semantic variant for warning-like components. */
  variant?: TextComponentVariant;
  /** Auto numbering for example / exercise. */
  number?: number;
  /** Role relative to the associated element (graph chrome, etc.). */
  role?: ComponentRole;
  /** Linked-comment anchor on a TextElement phrase. */
  anchor?: {
    targetElementId: string;
    blockId: string;
    start: number;
    end: number;
    quote: string;
    status: 'resolved' | 'unresolved';
  };
  /** Linked-comment / annotation anchor on a GraphElement feature. */
  graphAnchor?: {
    targetGraphId: string;
    expressionId?: string;
    pointId?: string;
    /** Mathematical x (graph coords), not canvas pixels. */
    x?: number;
    status: 'resolved' | 'unresolved';
  };
};

export type TextComponentStylePreset = {
  fontSize: number;
  fontWeight: FontWeight;
  fontItalic: boolean;
  color: string;
  backgroundColor: string | null;
  /** null = no border stroke */
  borderColor: string | null;
  borderWidth: number;
  /** Optional left accent bar (warning / comment). */
  accentBorderColor: string | null;
  accentBorderWidth: number;
  padding: number;
  cornerRadius: number;
  alignment: TextAlignment;
  lineHeight: number;
  defaultWidth: number;
  /** Label shown above body (null = no chrome label). */
  defaultLabel: string | null;
};

export const TEXT_COMPONENT_STYLES: Record<TextComponentType, TextComponentStylePreset> = {
  main_text: {
    fontSize: 15,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: null,
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 12,
    cornerRadius: 0,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 360,
    defaultLabel: null,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: null,
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 4,
    cornerRadius: 0,
    alignment: 'left',
    lineHeight: 1.25,
    defaultWidth: 360,
    defaultLabel: null,
  },
  definition: {
    fontSize: 15,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: null,
    borderColor: '#CBD5E1',
    borderWidth: 1,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 14,
    cornerRadius: 8,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 360,
    defaultLabel: 'Definition',
  },
  example: {
    fontSize: 15,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: '#F1F5F9',
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 15,
    cornerRadius: 8,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 360,
    defaultLabel: 'Example',
  },
  warning: {
    fontSize: 15,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: '#FFFBEB',
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: '#F59E0B',
    accentBorderWidth: 3,
    padding: 12,
    cornerRadius: 6,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 340,
    defaultLabel: 'Warning',
  },
  linked_comment: {
    fontSize: 13,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#334155',
    backgroundColor: '#F8FAFC',
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: '#D4A017',
    accentBorderWidth: 3,
    padding: 10,
    cornerRadius: 6,
    alignment: 'left',
    lineHeight: 1.4,
    defaultWidth: 220,
    defaultLabel: 'Comment',
  },
  exercise: {
    fontSize: 15,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: null,
    borderColor: '#CBD5E1',
    borderWidth: 1,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 16,
    cornerRadius: 8,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 380,
    defaultLabel: 'Exercise',
  },
  caption: {
    fontSize: 13,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#64748B',
    backgroundColor: null,
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 6,
    cornerRadius: 0,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 400,
    defaultLabel: null,
  },
  key_observation: {
    fontSize: 14,
    fontWeight: 'normal',
    fontItalic: false,
    color: '#1a1a1a',
    backgroundColor: '#F1F5F9',
    borderColor: null,
    borderWidth: 0,
    accentBorderColor: null,
    accentBorderWidth: 0,
    padding: 14,
    cornerRadius: 8,
    alignment: 'left',
    lineHeight: 1.45,
    defaultWidth: 400,
    defaultLabel: 'Key Observation',
  },
};

/** Format symbol definitions into compact textbook "where:" text. */
export function formatSymbolDefinitions(
  symbols: Array<{ symbol: string; definition: string; unit?: string }>,
): string {
  const lines = symbols
    .map((s) => {
      const sym = s.symbol.trim();
      const def = s.definition.trim();
      if (!sym || !def) return '';
      const unit = s.unit?.trim();
      return unit ? `${sym} — ${def} (${unit})` : `${sym} — ${def}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return '';
  // Single associated TextElement — never one box per variable.
  return lines.join('\n');
}

export function isTextComponentType(v: unknown): v is TextComponentType {
  return typeof v === 'string' && (TEXT_COMPONENT_TYPES as readonly string[]).includes(v);
}

export function labelForComponent(
  type: TextComponentType,
  meta?: TextComponentMeta | null,
): string | null {
  if (meta?.label?.trim()) return meta.label.trim();
  const preset = TEXT_COMPONENT_STYLES[type];
  if (type === 'warning') {
    if (meta?.variant === 'common_mistake') return 'Common Mistake';
    if (meta?.variant === 'important_caution') return 'Important Caution';
    return 'Warning';
  }
  if ((type === 'example' || type === 'exercise') && meta?.number != null) {
    return `${preset.defaultLabel} ${meta.number}`;
  }
  return preset.defaultLabel;
}

export function styleConfigFromPreset(preset: TextComponentStylePreset): TextStyleConfig {
  return {
    fontSize: preset.fontSize,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: preset.fontWeight,
    fontItalic: preset.fontItalic,
    underline: false,
    lineHeight: preset.lineHeight,
    color: preset.color,
    padding: preset.padding,
  };
}

/** Extra height for chrome label above body. */
export function componentLabelExtraHeight(
  type: TextComponentType,
  meta?: TextComponentMeta | null,
): number {
  const label = labelForComponent(type, meta);
  if (!label) return 0;
  return Math.round(TEXT_COMPONENT_STYLES[type].fontSize * 0.85) + 10;
}

export function measureTextComponent(opts: {
  componentType: TextComponentType;
  text: string;
  richText?: RichTextDocument;
  meta?: TextComponentMeta | null;
  availableWidth?: number;
}): { width: number; height: number } {
  const preset = TEXT_COMPONENT_STYLES[opts.componentType];
  const style = styleConfigFromPreset(preset);
  const measured = TextElementAutoSizer.measure({
    content: { text: opts.text, richText: opts.richText },
    availableWidth: opts.availableWidth ?? preset.defaultWidth,
    style,
    autoSized: true,
    limits: {
      minWidth: Math.min(200, preset.defaultWidth),
      maxWidth: Math.max(preset.defaultWidth, 520),
      defaultWidth: preset.defaultWidth,
      compactMinWidth: 160,
    },
  });
  const labelExtra = componentLabelExtraHeight(opts.componentType, opts.meta);
  return {
    width: measured.width,
    height: measured.height + labelExtra,
  };
}

export function applyComponentStyleToElement(
  el: TextElement,
  componentType: TextComponentType,
  meta?: TextComponentMeta,
): TextElement {
  const preset = TEXT_COMPONENT_STYLES[componentType];
  return {
    ...el,
    componentType,
    componentMeta: {
      placementMode: meta?.placementMode ?? 'auto',
      ...(meta?.associatedElementId
        ? { associatedElementId: meta.associatedElementId }
        : {}),
      ...(meta?.label ? { label: meta.label } : {}),
      ...(meta?.variant ? { variant: meta.variant } : {}),
      ...(meta?.number != null ? { number: meta.number } : {}),
      ...(meta?.role ? { role: meta.role } : {}),
      ...(meta?.anchor ? { anchor: meta.anchor } : {}),
      ...(meta?.graphAnchor ? { graphAnchor: meta.graphAnchor } : {}),
    },
    fontSize: preset.fontSize,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: preset.fontWeight,
    fontItalic: preset.fontItalic,
    color: preset.color,
    backgroundColor: preset.backgroundColor,
    padding: preset.padding,
    cornerRadius: preset.cornerRadius,
    alignment: preset.alignment,
    lineHeight: preset.lineHeight,
    metadata: {
      ...el.metadata,
      componentType,
      borderColor: preset.borderColor,
      borderWidth: preset.borderWidth,
      accentBorderColor: preset.accentBorderColor,
      accentBorderWidth: preset.accentBorderWidth,
    },
  };
}

export function createTextComponentElement(opts: {
  componentType: TextComponentType;
  text: string;
  richText?: RichTextDocument;
  position: { x: number; y: number };
  zIndex: number;
  width?: number;
  meta?: TextComponentMeta;
  metadata?: Record<string, unknown>;
}): TextElement {
  const preset = TEXT_COMPONENT_STYLES[opts.componentType];
  const richText = opts.richText;
  const plain = richText ? richTextToPlainText(richText) : opts.text;
  const size = measureTextComponent({
    componentType: opts.componentType,
    text: plain,
    richText,
    meta: opts.meta,
    availableWidth: opts.width ?? preset.defaultWidth,
  });
  const base = createBaseFields({
    x: opts.position.x,
    y: opts.position.y,
    width: size.width,
    height: size.height,
    zIndex: opts.zIndex,
    opacity: 1,
    metadata: {
      createdBy: 'ai',
      source: 'agent',
      autoSize: true,
      ...(opts.metadata ?? {}),
    },
  });
  const el: TextElement = {
    ...base,
    type: 'text',
    text: plain,
    ...(richText ? { richText } : {}),
    fontSize: preset.fontSize,
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontWeight: preset.fontWeight,
    fontItalic: preset.fontItalic,
    underline: false,
    strikethrough: false,
    color: preset.color,
    alignment: preset.alignment,
    lineHeight: preset.lineHeight,
    backgroundColor: preset.backgroundColor,
    padding: preset.padding,
    cornerRadius: preset.cornerRadius,
  };
  return applyComponentStyleToElement(el, opts.componentType, opts.meta);
}

/** Spacing constants (world units) for auto placement. */
export const COMPONENT_LAYOUT = {
  titleGap: 14,
  stackGap: 18,
  commentGap: 16,
  sideGap: 20,
} as const;

export function getComponentType(el: TextElement): TextComponentType {
  if (el.componentType && isTextComponentType(el.componentType)) {
    return el.componentType;
  }
  const fromMeta = el.metadata?.componentType;
  if (isTextComponentType(fromMeta)) return fromMeta;
  return 'main_text';
}

/** Ensure plain content becomes a simple rich-text doc when useful. */
export function contentToRichText(text: string): RichTextDocument {
  return plainTextToRichText(text);
}
