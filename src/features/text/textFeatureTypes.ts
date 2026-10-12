/** Serializable TextElement feature types (no runtime helpers — safe for canvas.ts). */

export const TEXT_COMMENT_TYPES = [
  'explanation',
  'correction',
  'suggestion',
  'question',
] as const;
export type TextCommentType = (typeof TEXT_COMMENT_TYPES)[number];

export const TEXT_NOTE_TYPES = [
  'extra_information',
  'important',
  'caution',
  'reference',
] as const;
export type TextNoteType = (typeof TEXT_NOTE_TYPES)[number];

export const TEXT_HIGHLIGHT_STYLES = [
  'important',
  'definition',
  'warning',
  'emphasis',
] as const;
export type TextHighlightStyle = (typeof TEXT_HIGHLIGHT_STYLES)[number];

export type TextTitle = {
  id: string;
  text: string;
};

export type TextNote = {
  id: string;
  text: string;
  noteType: TextNoteType;
  layoutMode: 'auto' | 'manual';
  offsetX?: number;
  offsetY?: number;
  order: number;
};

export type TextCommentAnchor = {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  status: 'resolved' | 'unresolved';
};

export type TextComment = {
  id: string;
  anchor: TextCommentAnchor;
  text: string;
  commentType: TextCommentType;
  displayState: 'collapsed' | 'open';
  panelOffsetX?: number;
  panelOffsetY?: number;
};
