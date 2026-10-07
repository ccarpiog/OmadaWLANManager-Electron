// Central redactor (docs/management-design.md §3 "Redaction"). Pure (no
// Electron), unit-tested in tests/unit/redact.test.ts. Every diagnostic that
// may echo a controller response or a request — the transport's HTTP error
// excerpt, OpenApiClient errors, logs — goes through this one module, so the
// password, the Open API Client Secret, access/refresh tokens, cookies, CSRF
// tokens and Wi-Fi passphrases never reach a log line, an error `detail` or
// the renderer.
//
// Two entry points:
// - redactValue(): a deep copy of a structured value (objects, arrays) with
//   the value of every sensitive key replaced by REDACTED, and every string
//   inside run through redactText();
// - redactText(): free text (error messages, response excerpts, header
//   dumps). It redacts `"key":"value"` / `'key':'value'` / `"key":123` JSON
//   pairs, `key=value` pairs (query strings, form bodies, cookies:
//   `client_secret=`, `access_token=`, `AccessToken=`, `TPOMADA_SESSIONID=`,
//   …), header-style `Key: value` lines (`Authorization:`, `Cookie:`,
//   `Csrf-Token:`, …) and `Bearer <token>` (TP-Link's `Bearer AK-…` API keys
//   included), plus any exact occurrence of the caller's known secrets, plus
//   bare TP-Link cloud token shapes (BARE_TPLINK_TOKEN: an access token
//   `AT-…` / `a1-AT-…`, a refresh token `RT-…` or an API key `AK-…` with at
//   least 16 letters or digits after the prefix) wherever they appear.
//
// Value forms (after a sensitive key, or after `Bearer`):
// - double- or single-quoted (`password="hunter 2"`, `AccessToken='AT'`):
//   everything up to the matching closing quote, backslash escapes included
//   (`"a\"b"`), whitespace included; the quoting is kept around REDACTED;
// - quoted with JSON-escaped quotes (`password=\"x y\"`, i.e. a `key="value"`
//   pair inside a JSON string): everything up to the end of the enclosing JSON
//   string (its next unescaped `"`);
// - unquoted `key=value` / Bearer: everything up to the next delimiter (`&`,
//   `;`, `,`, whitespace or the end), so no tail of the value survives;
// - unquoted JSON value: everything up to the next `,`, `}`, `]` or
//   whitespace (objects and arrays are walked into instead);
// - header-style line: the rest of the line, and when the value opens a quote,
//   through the closing quote even across lines.
// A quoted value with no closing quote (e.g. cut by an excerpt boundary) is
// redacted to the end of the text.
//
// A key is sensitive when, lowercased and stripped of everything but letters
// and digits, it CONTAINS one of SENSITIVE_KEY_FRAGMENTS (so `client_secret`,
// `clientSecret`, `Csrf-Token`, `set-cookie`, `access_token`, `securityKey`,
// `pskSetting`, `ppskSetting` and `TPOMADA_SESSIONID` all match, and so do the
// Wi-Fi passphrase spellings of the network writes — `passphrase` (the IPC
// field), `securityKey` (the Open API body), `psk`, `preSharedKey`, `wpaKey`).
// Over-redaction is accepted: these strings are diagnostics, never data the
// app relies on.
//
// The text scan is linear-time: a key is matched from a word start only, with
// a bounded length, and only the value of a SENSITIVE key is scanned (after
// any other key the scan resumes right after its separator, so a sensitive
// pair later on the same line is still found). No value pattern needs its
// closing delimiter, so a secret cut in half by an excerpt boundary is still
// redacted. Not covered (redactValue() covers both for structured data): a
// JSON key whose own quotes are escaped inside a JSON string
// (`"{\"password\":\"x\"}"`), and an array of bare values under a sensitive
// JSON key (`"tokens":["a","b"]`).

// The replacement for every redacted value
export const REDACTED = '[REDACTED]';

// Fragments that make a key sensitive (see the header). Compared against the
// key lowercased with every non-alphanumeric character removed.
export const SENSITIVE_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'cookie',
  'csrf',
  'authorization',
  'securitykey',
  'psk',
  'presharedkey',
  'wpakey',
  'sessionid'
];

// Depth cap for redactValue(): deeper values are replaced, never walked
const MAX_REDACT_DEPTH = 32;

// Key patterns (the key is the first capture group that matched; the match
// ends after the separator). Keys are at most 128 characters long (a longer
// word cannot be a key here) and, outside quotes, start at a word boundary
// (the lookbehinds).
// `"key" :` or `'key' :` (a JSON key, or a JavaScript/Python-style dump)
const JSON_KEY = /(?:"([^"\\\r\n]{1,128})"|'([^'\\\r\n]{1,128})')\s*:\s*/g;
// `key=` (query strings, form bodies, cookies, `AccessToken=…`)
const ASSIGNMENT_KEY = /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,128})\s*=\s*/g;
// `Key:` (header-style lines; a quoted JSON key never matches, because its
// closing quote sits between it and ':')
const HEADER_KEY = /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]{1,128})[ \t]*:[ \t]*/g;
// `Bearer ` (the scheme itself is the "key"; its value is always sensitive)
const BEARER_KEY = /(?<![A-Za-z0-9_-])(Bearer)\s+/gi;
// A bare TP-Link cloud credential token (Account Level Open API guide): an
// access token (`AT-…`, also with a short region prefix such as `a1-AT-…`),
// a refresh token (`RT-…`) or an API key (`AK-…`), with at least 16 letters
// or digits after the prefix (the documented ones have 32), redacted whole
const BARE_TPLINK_TOKEN = /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9]{1,4}-)?(?:AT|RT|AK)-[A-Za-z0-9]{16,}[A-Za-z0-9_-]*/g;

// Value patterns (sticky: matched exactly where a key's separator ends)
// A double-quoted string; backslash escapes (also a trailing lone backslash)
// are part of it, and the closing quote is optional (the value may be
// truncated)
const DOUBLE_QUOTED_VALUE = /"(?:[^"\\]|\\[\s\S]?)*"?/y;
// A single-quoted string (same rules)
const SINGLE_QUOTED_VALUE = /'(?:[^'\\]|\\[\s\S]?)*'?/y;
// A value opened by a JSON-escaped quote (`\"`, i.e. inside a JSON string):
// everything up to the end of that JSON string — its next unescaped `"` — or
// of the text
const ESCAPED_QUOTED_VALUE = /\\"(?:[^"\\]|\\[\s\S]?)*/y;
// An unquoted `key=value` (or Bearer) value: up to the next delimiter. A
// value that is exactly REDACTED (already redacted) is left alone
const UNQUOTED_VALUE = /(?!\[REDACTED\](?![^&;,\s]))[^&;,\s]+/y;
// An unquoted JSON value (number, boolean, null or a malformed bare word): up
// to the next `,`, `}`, `]` or whitespace; never an object or an array (their
// keys are matched on their own)
const JSON_BARE_VALUE = /(?![{[])[^\s,}\]]+/y;
// The value of a header-style line: an optional quoted part (which may span
// lines, or run to the end of the text when unterminated) and then the rest
// of the line. A value that is exactly REDACTED is left alone
const HEADER_VALUE = /(?!\[REDACTED\][ \t]*(?:[\r\n]|$))(?=\S)(?:"(?:[^"\\]|\\[\s\S]?)*"?|'(?:[^'\\]|\\[\s\S]?)*'?)?[^\r\n]*/y;

/**
 * One way a sensitive key's value can look, and what replaces it.
 */
interface ValueRule {
  // Sticky pattern matched exactly where the key's separator ends
  pattern: RegExp;
  replacement: string;
}

// Value rules after a JSON key: a string value stays a (same-quoted) string,
// a bare value becomes a JSON string
const JSON_VALUE_RULES: readonly ValueRule[] = [
  { pattern: DOUBLE_QUOTED_VALUE, replacement: `"${REDACTED}"` },
  { pattern: SINGLE_QUOTED_VALUE, replacement: `'${REDACTED}'` },
  { pattern: JSON_BARE_VALUE, replacement: `"${REDACTED}"` }
];

// Value rules after `key=` and after `Bearer`: quoted forms keep their quotes.
// Order matters: the escaped-quote rule must run before the unquoted one,
// which would otherwise stop at the first delimiter inside the quotes
const ASSIGNMENT_VALUE_RULES: readonly ValueRule[] = [
  { pattern: DOUBLE_QUOTED_VALUE, replacement: `"${REDACTED}"` },
  { pattern: SINGLE_QUOTED_VALUE, replacement: `'${REDACTED}'` },
  { pattern: ESCAPED_QUOTED_VALUE, replacement: `\\"${REDACTED}\\"` },
  { pattern: UNQUOTED_VALUE, replacement: REDACTED }
];

// Value rule after a header-style `Key:`
const HEADER_VALUE_RULES: readonly ValueRule[] = [{ pattern: HEADER_VALUE, replacement: REDACTED }];

/**
 * Tells whether a key (object property, header name, query parameter, JSON
 * key) names sensitive data. Case-insensitive; separators are ignored.
 * @param {string} key - The key to classify.
 * @returns {boolean} True when the key's value must be redacted.
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === '') {
    return false;
  }
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Replaces every exact occurrence of the given known secrets (e.g. the
 * client's own Client Secret and access token) in a text. Empty values are
 * ignored; longer secrets are replaced first so one secret that contains
 * another is replaced whole.
 * @param {string} text - The text to scrub.
 * @param {readonly (string | null | undefined)[]} knownSecrets - Secret values.
 * @returns {string} The scrubbed text.
 */
function scrubKnownSecrets(text: string, knownSecrets: readonly (string | null | undefined)[]): string {
  const secrets = knownSecrets
    .filter((secret): secret is string => typeof secret === 'string' && secret.length > 0)
    .sort((a, b) => b.length - a.length);
  let scrubbed = text;
  for (const secret of secrets) {
    scrubbed = scrubbed.split(secret).join(REDACTED);
  }
  return scrubbed;
} // End of function scrubKnownSecrets()

/**
 * Scans a text for keys (keyPattern: the key is its first capture group that
 * matched, the match ending after the separator) and replaces the value after
 * every SENSITIVE key with the replacement of the first value rule that
 * matches there. After any other key the scan resumes right after its
 * separator, so nothing it would have swallowed escapes the scan. Linear in
 * the text length.
 * @param {string} text - The text.
 * @param {RegExp} keyPattern - Global key pattern.
 * @param {readonly ValueRule[]} valueRules - Sticky value patterns, tried in order.
 * @param {(key: string) => boolean} [keyIsSensitive] - Key classifier
 *   (default isSensitiveKey()).
 * @returns {string} The text with the sensitive values replaced.
 */
function redactKeyedValues(
  text: string,
  keyPattern: RegExp,
  valueRules: readonly ValueRule[],
  keyIsSensitive: (key: string) => boolean = isSensitiveKey
): string {
  let output = '';
  let cursor = 0;
  keyPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(text)) !== null) {
    if (!keyIsSensitive(match[1] ?? match[2] ?? '')) {
      continue; // lastIndex already sits right after the separator
    }
    const valueStart = match.index + match[0].length;
    for (const rule of valueRules) {
      rule.pattern.lastIndex = valueStart;
      const value = rule.pattern.exec(text);
      if (value !== null && value[0].length > 0) {
        output += text.slice(cursor, valueStart) + rule.replacement;
        cursor = valueStart + value[0].length;
        keyPattern.lastIndex = cursor;
        break;
      }
    } // End of the loop that tries each value rule
  } // End of the loop over the keys found in the text
  return output + text.slice(cursor);
} // End of function redactKeyedValues()

/**
 * Redacts secrets in free text: JSON pairs, `key=value` pairs, header-style
 * lines and Bearer tokens whose key is sensitive (isSensitiveKey()), quoted
 * or not, and first every exact occurrence of the known secrets. Idempotent.
 * @param {string} text - The text to redact (non-strings are stringified).
 * @param {readonly (string | null | undefined)[]} [knownSecrets] - Exact
 *   secret values to remove as well (e.g. the Client Secret, the token).
 * @returns {string} The redacted text.
 */
export function redactText(text: string, knownSecrets: readonly (string | null | undefined)[] = []): string {
  let redacted = typeof text === 'string' ? text : String(text);
  // Known secrets first, so no pattern can split one before it is matched
  redacted = scrubKnownSecrets(redacted, knownSecrets);
  // JSON pairs: a string value stays a string, a bare value becomes one;
  // objects and arrays are walked into (their keys are matched later)
  redacted = redactKeyedValues(redacted, JSON_KEY, JSON_VALUE_RULES);
  redacted = redactKeyedValues(redacted, ASSIGNMENT_KEY, ASSIGNMENT_VALUE_RULES);
  redacted = redactKeyedValues(redacted, BEARER_KEY, ASSIGNMENT_VALUE_RULES, () => true);
  redacted = redactKeyedValues(redacted, HEADER_KEY, HEADER_VALUE_RULES);
  // Bare cloud tokens without a key in front (e.g. echoed in a message)
  redacted = redacted.replace(BARE_TPLINK_TOKEN, REDACTED);
  return redacted;
} // End of function redactText()

/**
 * Returns a redacted deep copy of a value: the value of every sensitive key
 * (at any depth, in objects and inside arrays) becomes REDACTED, every string
 * goes through redactText(), Errors become `{ name, message }` with the
 * message redacted, cycles become '[Circular]' and anything deeper than
 * MAX_REDACT_DEPTH becomes '[Truncated]'. Functions and symbols are dropped
 * (as JSON.stringify would). The input is never mutated.
 * @param {unknown} value - The value to redact.
 * @param {readonly (string | null | undefined)[]} [knownSecrets] - Exact
 *   secret values to remove from every string as well.
 * @returns {unknown} The redacted copy.
 */
export function redactValue(value: unknown, knownSecrets: readonly (string | null | undefined)[] = []): unknown {
  const seen = new WeakSet<object>();

  /**
   * Redacts one value at a given depth.
   * @param {unknown} current - The value.
   * @param {number} depth - Nesting depth (0 = the root).
   * @returns {unknown} The redacted copy.
   */
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') {
      return redactText(current, knownSecrets);
    }
    if (current === null || typeof current !== 'object') {
      return typeof current === 'function' || typeof current === 'symbol' ? undefined : current;
    }
    if (depth >= MAX_REDACT_DEPTH) {
      return '[Truncated]';
    }
    if (seen.has(current)) {
      return '[Circular]';
    }
    seen.add(current);
    if (current instanceof Error) {
      return { name: current.name, message: redactText(current.message, knownSecrets) };
    }
    if (Array.isArray(current)) {
      return current.map((item) => walk(item, depth + 1));
    }
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        copy[key] = REDACTED;
      } else {
        const redactedItem = walk(item, depth + 1);
        if (redactedItem !== undefined) {
          copy[key] = redactedItem;
        }
      }
    } // End of the loop that copies the object's entries
    return copy;
  }; // End of function walk()

  return walk(value, 0);
} // End of function redactValue()

/**
 * Returns the redacted message of a thrown value (an Error's message, or the
 * value stringified), for logs and error details.
 * @param {unknown} error - The thrown value.
 * @param {readonly (string | null | undefined)[]} [knownSecrets] - Exact
 *   secret values to remove as well.
 * @returns {string} The redacted message.
 */
export function redactErrorMessage(error: unknown, knownSecrets: readonly (string | null | undefined)[] = []): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(message, knownSecrets);
}
