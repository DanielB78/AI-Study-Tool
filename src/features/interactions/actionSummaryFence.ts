/**
 * Extract / strip the trailing :::summary … ::: fence from an LLM response.
 *
 * Same enclosure style as :::graph — the marker is never canvas content.
 * Fence-aware: ignores :::summary inside ``` / ~~~ code fences.
 */

import {
  isFenceCloseLine,
  parseFenceOpenLine,
  stripMarkdownDocumentFence,
} from '../ai/contentFirst/markdownFences';

const SUMMARY_OPEN = /^:::summary\s*$/i;

export type ExtractedActionSummary = {
  /** Trimmed summary body, or null when no fence was present. */
  summary: string | null;
  /** Response with the summary fence removed (document fence still unwrapped). */
  body: string;
  /** True when a :::summary fence was found (even if body was empty). */
  found: boolean;
};

/**
 * Find the last top-level :::summary … ::: block and strip it.
 * Prefer placing the fence at the end of the response.
 */
export function extractActionSummary(raw: string): ExtractedActionSummary {
  const unwrapped = stripMarkdownDocumentFence(raw);
  const lines = unwrapped.replace(/\r\n/g, '\n').split('\n');

  let fenceOpen: ReturnType<typeof parseFenceOpenLine> = null;
  let lastSummary: { start: number; end: number; body: string } | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (fenceOpen) {
      if (isFenceCloseLine(line, fenceOpen)) {
        fenceOpen = null;
      }
      i += 1;
      continue;
    }

    const open = parseFenceOpenLine(line);
    if (open) {
      fenceOpen = open;
      i += 1;
      continue;
    }

    if (SUMMARY_OPEN.test(line.trim())) {
      const start = i;
      const buf: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (lines[i]!.trim() === ':::') {
          closed = true;
          break;
        }
        // Nested code fences inside the summary body are unlikely but keep literal.
        buf.push(lines[i]!);
        i += 1;
      }
      if (!closed) {
        // Unclosed — leave as-is; caller / parser may surface other errors.
        break;
      }
      lastSummary = {
        start,
        end: i, // index of closing :::
        body: buf.join('\n').trim(),
      };
      i += 1; // past closing :::
      continue;
    }

    i += 1;
  }

  if (!lastSummary) {
    return { summary: null, body: unwrapped, found: false };
  }

  const before = lines.slice(0, lastSummary.start);
  const after = lines.slice(lastSummary.end + 1);
  // Drop a single trailing blank line left by removing the fence.
  while (before.length > 0 && before[before.length - 1]!.trim() === '') {
    before.pop();
  }
  const body = [...before, ...after].join('\n').replace(/^\n+|\n+$/g, '');
  const summary = lastSummary.body.trim() || null;
  return { summary, body, found: true };
}

/** Wrap a summary in the canonical fence (for tests / regenerating prompts). */
export function formatActionSummaryFence(summary: string): string {
  return `:::summary\n${summary.trim()}\n:::`;
}
