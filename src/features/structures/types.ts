/**
 * User-defined note structures — reusable layouts for AI-filled notes.
 * Stored outside CanvasDocument (library persists across boards).
 */

import type { FontWeight, TextAlignment } from '../../types/canvas';

export const NOTE_STRUCTURE_VERSION = 1 as const;

export type StructureFieldContentType = 'text' | 'equation';

/** Style subset reused from TextElement when instantiating TEXT fields. */
export interface StructureFieldStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: FontWeight;
  fontItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  color: string;
  alignment: TextAlignment;
  lineHeight: number;
  backgroundColor: string | null;
  padding: number;
  cornerRadius: number;
}

/**
 * Geometry relative to the structure's top-left origin, in structure pixels
 * (not world canvas coordinates). Instantiation adds structure origin.
 */
export interface NoteStructureField {
  id: string;
  label: string;
  /** AI instruction — what the model should put in this slot. */
  instruction: string;
  contentType: StructureFieldContentType;
  required: boolean;
  relativeX: number;
  relativeY: number;
  relativeWidth: number;
  relativeHeight: number;
  zIndex: number;
  style: StructureFieldStyle;
}

export interface NoteStructure {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Structure design canvas bounds (relative coordinate space). */
  width: number;
  height: number;
  fields: NoteStructureField[];
  version: typeof NOTE_STRUCTURE_VERSION;
}

export const DEFAULT_STRUCTURE_FIELD_STYLE: StructureFieldStyle = {
  fontSize: 16,
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontWeight: 'normal',
  fontItalic: false,
  underline: false,
  strikethrough: false,
  color: '#1a1a1a',
  alignment: 'left',
  lineHeight: 1.35,
  backgroundColor: '#ffffff',
  padding: 10,
  cornerRadius: 8,
};

export const DEFAULT_STRUCTURE_WIDTH = 640;
export const DEFAULT_STRUCTURE_HEIGHT = 480;
