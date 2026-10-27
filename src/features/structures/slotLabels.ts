/**
 * Deterministic slot directive labels for :::structure matching.
 *
 * The LLM uses natural-language descriptions as markers. Templates keep stable
 * slot IDs internally; matching is by normalised directive label — never fuzzy.
 */

/** Reserved marker names that cannot be used as slot descriptions. */
export const RESERVED_STRUCTURE_MARKERS = new Set([
  'structure',
  'endstructure',
  'graph',
  'json',
  'definition',
  'example',
  'warning',
  'exercise',
]);

/**
 * Collapse internal whitespace, trim, and reject control characters.
 * Matching is case-sensitive after normalisation (whitespace only).
 */
export function normalizeSlotDescription(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * User-facing directive label used after `:::`.
 * Same as the normalised description for this initial implementation.
 */
export function directiveLabelFromDescription(description: string): string {
  return normalizeSlotDescription(description);
}

export type SlotLabelValidationIssue =
  | { code: 'empty'; message: string }
  | { code: 'multiline_raw'; message: string }
  | { code: 'reserved'; message: string; label: string }
  | { code: 'duplicate'; message: string; label: string }
  | { code: 'too_long'; message: string; label: string };

const MAX_LABEL_LENGTH = 200;

/**
 * Validate that generative slot descriptions are unique and usable as markers.
 */
export function validateSlotDescriptions(
  descriptions: readonly string[],
): SlotLabelValidationIssue[] {
  const issues: SlotLabelValidationIssue[] = [];
  const seen = new Map<string, number>();

  descriptions.forEach((raw, index) => {
    if (/\r|\n/.test(raw.trim()) && raw.includes('\n')) {
      issues.push({
        code: 'multiline_raw',
        message: `Slot description #${index + 1} must be a single line.`,
      });
    }
    const label = directiveLabelFromDescription(raw);
    if (!label) {
      issues.push({
        code: 'empty',
        message: `Slot description #${index + 1} is empty.`,
      });
      return;
    }
    if (label.length > MAX_LABEL_LENGTH) {
      issues.push({
        code: 'too_long',
        message: `Slot description #${index + 1} exceeds ${MAX_LABEL_LENGTH} characters.`,
        label,
      });
    }
    const reservedKey = label.toLowerCase();
    if (RESERVED_STRUCTURE_MARKERS.has(reservedKey)) {
      issues.push({
        code: 'reserved',
        message: `Slot description "${label}" conflicts with a reserved marker.`,
        label,
      });
    }
    const prev = seen.get(label);
    if (prev != null) {
      issues.push({
        code: 'duplicate',
        message: `Duplicate slot description "${label}" (slots #${prev + 1} and #${index + 1}).`,
        label,
      });
    } else {
      seen.set(label, index);
    }
  });

  return issues;
}

/**
 * Resolve an LLM marker to a unique slot id using exact normalised labels.
 * Throws with a clear message on unknown / ambiguous markers.
 */
export function matchSlotLabelToId(
  marker: string,
  slots: ReadonlyArray<{ id: string; description: string }>,
): string {
  const label = directiveLabelFromDescription(marker);
  if (!label) {
    throw new Error('Empty structure slot marker.');
  }

  const matches = slots.filter(
    (s) => directiveLabelFromDescription(s.description) === label,
  );

  if (matches.length === 0) {
    throw new Error(
      `Unknown structure slot "${label}". Use the exact content description from the selected template.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous structure slot "${label}" matches ${matches.length} template slots.`,
    );
  }
  return matches[0]!.id;
}

/** Escape a label for display in prompt examples (backticks / fences). */
export function formatSlotMarkerForPrompt(description: string): string {
  return `:::${directiveLabelFromDescription(description)}`;
}
