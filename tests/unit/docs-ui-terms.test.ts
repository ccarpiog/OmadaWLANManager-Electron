// The UI terms quoted in the user-facing docs (phase 20b, todo.md 4.13):
// docs/user-guide.md and docs/live-test-checklist.md quote every interface
// term as a bold English / Spanish pair (`**Settings** / **Ajustes**`), and
// the user guide also lists the main terms in its "English UI | Spanish UI"
// table. Each pair must be the en and the es text of ONE key of the
// renderer's string tables (src/renderer/i18n-strings.ts), verbatim; a
// `{placeholder}` of a template stands for any non-empty text (e.g.
// "Move 4 APs" for "Move {count} APs", "…" for a name). A line break inside
// a quoted term (Markdown wraps long lines) counts as one space; fenced code
// blocks are ignored.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { translations } from '../../src/renderer/i18n-strings';
import type { Translations } from '../../src/renderer/i18n-strings';

/** One quoted English / Spanish pair. */
interface TermPair {
  en: string;
  es: string;
}

// A bold English term, " / ", and a bold Spanish term (on whitespace-normalized text)
const INLINE_PAIR_REGEX = /\*\*([^*]+?)\*\* \/ \*\*([^*]+?)\*\*/g;

// The header row of the user guide's term table
const TERM_TABLE_HEADER_REGEX = /^\|\s*English UI\s*\|\s*Spanish UI\s*\|\s*$/;

const KEYS = Object.keys(translations.en) as (keyof Translations)[];

/**
 * Reads a file under docs/ (the tests run from the project root).
 * @param {string} name - File name under docs/.
 * @returns {string} The file's text.
 */
function readDoc(name: string): string {
  return readFileSync(path.join(process.cwd(), 'docs', name), 'utf8');
}

/**
 * Removes the fenced code blocks of a Markdown text (shell snippets are not
 * UI quotes).
 * @param {string} markdown - The Markdown text.
 * @returns {string} The text without its code blocks.
 */
function withoutCodeBlocks(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, ' ');
}

/**
 * Builds a matcher for one UI string: the literal parts verbatim, each
 * `{placeholder}` any non-empty text, anchored at both ends.
 * @param {string} template - The UI string of one language.
 * @returns {RegExp} The matcher.
 */
function templateMatcher(template: string): RegExp {
  const literals = template.split(/\{[A-Za-z0-9]+\}/);
  const escaped = literals.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.+?')}$`, 'u');
}

/**
 * Finds the string key whose en text matches `pair.en` AND whose es text
 * matches `pair.es`.
 * @param {TermPair} pair - The quoted pair.
 * @returns {string | null} The first matching key, or null.
 */
function findKey(pair: TermPair): string | null {
  for (const key of KEYS) {
    if (templateMatcher(translations.en[key]).test(pair.en) && templateMatcher(translations.es[key]).test(pair.es)) {
      return key;
    }
  }
  return null;
}

/**
 * Collects every bold English / Spanish pair of a Markdown text, outside its
 * code blocks, with runs of whitespace (line breaks included) collapsed.
 * @param {string} markdown - The Markdown text.
 * @returns {TermPair[]} The pairs, in document order.
 */
function inlinePairs(markdown: string): TermPair[] {
  const text = withoutCodeBlocks(markdown).replace(/\s+/g, ' ');
  return [...text.matchAll(INLINE_PAIR_REGEX)].map((match) => ({ en: match[1].trim(), es: match[2].trim() }));
}

/**
 * Collects the rows of the user guide's "English UI | Spanish UI" table.
 * @param {string} markdown - The Markdown text.
 * @returns {TermPair[]} The table's pairs (empty when the table is missing).
 */
function termTableRows(markdown: string): TermPair[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => TERM_TABLE_HEADER_REGEX.test(line));
  if (start === -1) {
    return [];
  }
  const rows: TermPair[] = [];
  // Skip the header and the |---|---| separator; the table ends at the first non-row line
  for (let index = start + 2; index < lines.length && lines[index].startsWith('|'); index++) {
    const cells = lines[index].split('|').map((cell) => cell.trim());
    rows.push({ en: cells[1], es: cells[2] });
  }
  return rows;
}

/**
 * The pairs that match no key, as "en / es" lines for the failure message.
 * @param {TermPair[]} pairs - The quoted pairs.
 * @returns {string[]} The unmatched pairs.
 */
function unmatched(pairs: TermPair[]): string[] {
  return pairs.filter((pair) => findKey(pair) === null).map((pair) => `${pair.en} / ${pair.es}`);
}

describe('docs UI terms: the matcher', () => {
  test('a template matches its filled-in text and nothing looser', () => {
    assert.equal(templateMatcher('Move {count} APs').test('Move 4 APs'), true);
    assert.equal(templateMatcher('Move {count} APs').test('Move APs'), false);
    assert.equal(templateMatcher('Group "{name}" created.').test('Group "…" created.'), true);
    assert.equal(templateMatcher('Settings').test('Settings → Management access'), false);
    assert.equal(templateMatcher('(unchanged)').test('(unchanged)'), true);
  });

  test('a pair must be the en and es text of the SAME key', () => {
    assert.equal(findKey({ en: 'Settings', es: 'Ajustes' }), 'settings');
    assert.equal(findKey({ en: 'Move 4 APs', es: 'Mover 4 AP' }), 'moveMany');
    assert.equal(findKey({ en: 'Settings', es: 'Ajuste' }), null);
    // Both texts exist, but under different keys
    assert.equal(findKey({ en: 'Settings', es: 'Guardar' }), null);
  });

  test('pairs are found across line breaks and outside code blocks only', () => {
    const markdown = 'Open **Connection\n  settings** / **Ajustes de\nconexión**.\n```sh\n**Save** / **Nope**\n```\n';
    assert.deepEqual(inlinePairs(markdown), [{ en: 'Connection settings', es: 'Ajustes de conexión' }]);
  });
});

describe('docs UI terms: docs/user-guide.md', () => {
  const guide = readDoc('user-guide.md');

  test('the "English UI | Spanish UI" table lists only verbatim es/en pairs', () => {
    const rows = termTableRows(guide);
    assert.ok(rows.length >= 30, `expected the term table with at least 30 rows, found ${rows.length}`);
    assert.deepEqual(unmatched(rows), []);
  });

  test('every bold English / Spanish pair in the text is one key\'s en and es text', () => {
    const pairs = inlinePairs(guide);
    assert.ok(pairs.length >= 80, `expected at least 80 quoted pairs, found ${pairs.length}`);
    assert.deepEqual(unmatched(pairs), []);
  });
});

describe('docs UI terms: docs/live-test-checklist.md', () => {
  const checklist = readDoc('live-test-checklist.md');

  test('every bold English / Spanish pair is one key\'s en and es text', () => {
    const pairs = inlinePairs(checklist);
    assert.ok(pairs.length >= 150, `expected at least 150 quoted pairs, found ${pairs.length}`);
    assert.deepEqual(unmatched(pairs), []);
  });
});
