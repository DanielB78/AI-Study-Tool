/**
 * Safe syntax highlighting for TextElement code blocks.
 * highlight.js is used for presentation only — never execute code.
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('py', python);
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('js', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('ts', typescript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('sh', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('c', c);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c++', cpp);
  hljs.registerLanguage('java', java);
  registered = true;
}

/** Canonical language ids we advertise / style for. */
export const HIGHLIGHT_LANGUAGE_ALIASES: Record<string, string> = {
  python: 'python',
  py: 'python',
  javascript: 'javascript',
  js: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  json: 'json',
  html: 'html',
  xml: 'xml',
  css: 'css',
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  java: 'java',
  text: 'text',
  plain: 'text',
  plaintext: 'text',
};

export function normalizeCodeLanguage(
  language: string | null | undefined,
): string | null {
  if (!language) return null;
  const key = language.trim().toLowerCase();
  if (!key) return null;
  return HIGHLIGHT_LANGUAGE_ALIASES[key] ?? key;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlight source to HTML. Always escapes; never returns executable markup.
 * Unknown languages fall back to escaped plaintext.
 */
export function highlightCodeToHtml(
  code: string,
  language: string | null | undefined,
): { html: string; language: string | null; highlighted: boolean } {
  ensureRegistered();
  const lang = normalizeCodeLanguage(language);
  if (!lang || lang === 'text' || !hljs.getLanguage(lang)) {
    return { html: escapeHtml(code), language: lang, highlighted: false };
  }
  try {
    const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
    return { html: result.value, language: lang, highlighted: true };
  } catch {
    return { html: escapeHtml(code), language: lang, highlighted: false };
  }
}
