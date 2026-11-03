/**
 * Extract / strip the trailing :::summary … ::: fence from an LLM response.
 *
 * Same enclosure style as :::graph — the marker is never canvas content.
 *
 * Supports both placements called out by the content-first apply path:
 * - Inside the pasteable ```markdown wrapper (preferred in the system prompt)
 * - Immediately after the closing ```markdown fence
 *
 * Educational ``` / ~~~ fences are left alone: a :::summary that is not the
 * trailing end-of-response fence is not stripped.
 */

import { stripMarkdownDocumentFence } from '../ai/contentFirst/markdownFences';

const SUMMARY_OPEN = /^:::summary\s*$/i;

export type ExtractedActionSummary = {
  /** Trimmed summary body, or null when no fence was present. */
  summary: string | null;
  /** Response with the summary fence removed and document fence unwrapped. */
  body: string;
  /** True when a :::summary fence was found (even if body was empty). */
  found: boolean;
};

type Peeled = {
  found: boolean;
  summary: string | null;
  /** Text with the trailing summary fence removed (not yet document-unwrapped). */
  remainder: string;
};

/**
 * If the last non-blank line is `:::`, peel the preceding :::summary block.
 */
function peelTrailingSummaryBlock(text: string): Peeled {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let end = lines.length - 1;
  while (end >= 0 && !(lines[end] ?? '').trim()) end -= 1;

  if (end < 0 || (lines[end] ?? '').trim() !== ':::') {
    return { found: false, summary: null, remainder: text };
  }

  let start = end - 1;
  while (start >= 0 && !SUMMARY_OPEN.test((lines[start] ?? '').trim())) {
    start -= 1;
  }

  if (start < 0 || !SUMMARY_OPEN.test((lines[start] ?? '').trim())) {
    return { found: false, summary: null, remainder: text };
  }

  const summaryBody = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  const before = lines.slice(0, start);
  while (before.length > 0 && !(before[before.length - 1] ?? '').trim()) {
    before.pop();
  }

  return {
    found: true,
    summary: summaryBody || null,
    remainder: before.join('\n'),
  };
}

/**
 * Peel a trailing :::summary … ::: block, then unwrap any ```markdown wrapper.
 */
export function extractActionSummary(raw: string): ExtractedActionSummary {
  const text = raw.replace(/^\uFEFF/, '');

  // Pass 1: summary after (or without) the document wrapper — last non-blank is :::.
  const afterWrapper = peelTrailingSummaryBlock(text);
  if (afterWrapper.found) {
    return {
      summary: afterWrapper.summary,
      body: stripMarkdownDocumentFence(afterWrapper.remainder).replace(
        /^\n+|\n+$/g,
        '',
      ),
      found: true,
    };
  }

  // Pass 2: summary inside ```markdown … ``` — unwrap first, then peel.
  const unwrapped = stripMarkdownDocumentFence(text);
  const insideWrapper = peelTrailingSummaryBlock(unwrapped);
  if (insideWrapper.found) {
    return {
      summary: insideWrapper.summary,
      body: insideWrapper.remainder.replace(/^\n+|\n+$/g, ''),
      found: true,
    };
  }

  return {
    summary: null,
    body: unwrapped,
    found: false,
  };
}

/** Wrap a summary in the canonical fence (for tests / regenerating prompts). */
export function formatActionSummaryFence(summary: string): string {
  return `:::summary\n${summary.trim()}\n:::`;
}
