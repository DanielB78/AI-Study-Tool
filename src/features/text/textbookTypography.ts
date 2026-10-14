/**
 * Shared textbook typography tokens.
 * Equation size is derived from body text so math stays only slightly larger
 * than surrounding paragraphs.
 */

/** Body paragraph size (matches TEXT_COMPONENT_STYLES.main_text). */
export const TEXTBOOK_BODY_FONT_SIZE = 15;

/** Caption / symbol-definition size (matches TEXT_COMPONENT_STYLES.caption). */
export const TEXTBOOK_SYMBOL_DEF_FONT_SIZE = 13;

/**
 * Display EquationElement font size ≈ 1.13 × body.
 * Kept as a rounded world-space integer; resize must not change it.
 */
export const TEXTBOOK_EQUATION_FONT_SCALE = 1.13;
export const TEXTBOOK_EQUATION_FONT_SIZE = Math.round(
  TEXTBOOK_BODY_FONT_SIZE * TEXTBOOK_EQUATION_FONT_SCALE,
); // 17
