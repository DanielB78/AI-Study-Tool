/**
 * Parse top-level :::json directives and pair each with its following Markdown body.
 *
 * Format:
 *   :::json
 *   {"action":"edit","target_id":"text_12"}
 *   :::
 *
 *   Markdown body until the next top-level :::json or EOF.
 *
 * Distinguishes :::json from :::graph. Ignores markers inside ``` fences.
 */

import {
  isFenceCloseLine,
  parseFenceOpenLine,
  stripMarkdownDocumentFence,
} from './markdownFences';
import type {
  ContentFirstEnvelope,
  ContentJsonInstruction,
  ContentJsonSegment,
} from './types';
import { ContentParseError } from './types';

/** Strip optional whole-document ```markdown fence (same rules as contentParser). */
export function stripContentFence(raw: string): string {
  return stripMarkdownDocumentFence(raw);
}

function parseJsonInstruction(jsonText: string): ContentJsonInstruction {
  const trimmed = jsonText.trim();
  if (!trimmed) {
    throw new ContentParseError(
      'invalid_json',
      ':::json block is empty — expected a JSON object.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'parse error';
    throw new ContentParseError(
      'invalid_json',
      `Malformed JSON in :::json block: ${detail}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ContentParseError(
      'invalid_json',
      ':::json block must contain a JSON object.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const action = obj.action;
  if (action !== 'edit' && action !== 'add_text') {
    throw new ContentParseError(
      'unsupported_action',
      `Unsupported :::json action "${String(action)}". Only "edit" and "add_text" are supported.`,
    );
  }

  const targetId = obj.target_id;
  if (typeof targetId !== 'string' || !targetId.trim()) {
    throw new ContentParseError(
      'missing_target',
      `:::json action "${action}" requires a non-empty string target_id.`,
    );
  }

  if (action === 'edit') {
    const extra = Object.keys(obj).filter(
      (k) => k !== 'action' && k !== 'target_id',
    );
    if (extra.length > 0) {
      // Allow unknown keys only if we want leniency — reject coordinates/style early.
      const banned = extra.filter((k) =>
        /^(x|y|width|height|font|color|row|column|placement|style)/i.test(k),
      );
      if (banned.length > 0) {
        throw new ContentParseError(
          'invalid_instruction',
          `:::json edit must not include layout/style fields (${banned.join(', ')}).`,
        );
      }
    }
    return { action: 'edit', target_id: targetId.trim() };
  }

  const position = obj.position;
  if (position !== 'above' && position !== 'below') {
    throw new ContentParseError(
      'invalid_instruction',
      ':::json add_text requires position "above" or "below".',
    );
  }

  return {
    action: 'add_text',
    target_id: targetId.trim(),
    position,
  };
}

/**
 * Split a content-first LLM response into preamble + JSON instruction segments.
 * Does not parse Markdown bodies — only pairs them with validated JSON instructions.
 */
export function splitContentFirstEnvelope(raw: string): ContentFirstEnvelope {
  const source = stripContentFence(raw ?? '');
  if (!source.trim()) {
    throw new ContentParseError('empty', 'Content response is empty.');
  }

  const lines = source.split('\n');
  const preambleLines: string[] = [];
  const segments: ContentJsonSegment[] = [];

  let i = 0;
  let openFence: ReturnType<typeof parseFenceOpenLine> | null = null;
  let current: ContentJsonInstruction | null = null;
  let bodyLines: string[] = [];

  const flushSegment = () => {
    if (!current) return;
    const markdown = bodyLines.join('\n');
    if (!markdown.trim()) {
      throw new ContentParseError(
        'empty_body',
        `:::json ${current.action} on "${current.target_id}" has an empty Markdown body.`,
      );
    }
    segments.push({ instruction: current, markdown });
    current = null;
    bodyLines = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Track fenced code blocks (``` / ~~~, matching length) so :::json inside is inert.
    if (openFence) {
      if (isFenceCloseLine(line, openFence)) {
        openFence = null;
      }
      if (current) bodyLines.push(line);
      else preambleLines.push(line);
      i += 1;
      continue;
    }
    const fenceOpen = parseFenceOpenLine(line);
    if (fenceOpen) {
      openFence = fenceOpen;
      if (current) bodyLines.push(line);
      else preambleLines.push(line);
      i += 1;
      continue;
    }

    if (!openFence && /^:::json\s*$/i.test(trimmed)) {
      flushSegment();
      i += 1;
      const jsonBuf: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== ':::') {
        // Do not treat nested fences specially inside the JSON block itself.
        jsonBuf.push(lines[i]!);
        i += 1;
      }
      if (i >= lines.length) {
        throw new ContentParseError(
          'unclosed_marker',
          'Unclosed :::json marker (expected a closing ::: line).',
        );
      }
      i += 1; // closing :::
      current = parseJsonInstruction(jsonBuf.join('\n'));
      bodyLines = [];
      continue;
    }

    if (current) bodyLines.push(line);
    else preambleLines.push(line);
    i += 1;
  }

  if (openFence) {
    throw new ContentParseError('unclosed_fence', 'Unclosed fenced code block.');
  }

  flushSegment();

  return {
    preamble: preambleLines.join('\n'),
    segments,
    raw: source,
  };
}

/** True when the response contains at least one top-level :::json directive. */
export function hasJsonDirectives(raw: string): boolean {
  try {
    const env = splitContentFirstEnvelope(raw);
    return env.segments.length > 0;
  } catch {
    // Malformed JSON directives still "look like" content-first with json.
    return /^:::json\s*$/m.test(stripContentFence(raw));
  }
}
