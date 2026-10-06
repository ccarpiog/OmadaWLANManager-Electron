// Controller URL validation/normalization. Pure (no Electron, no filesystem),
// so it is unit-tested directly (tests/unit/url.test.ts); config.ts applies it
// to every URL it saves.

/**
 * Validates and normalizes a controller URL: it must parse, use HTTPS (plain
 * HTTP would send credentials unencrypted), and carry no embedded credentials
 * or fragment — not even an empty one ("https://host/#": URL.hash is '' for
 * it, so the serialized href is checked too); a trailing slash is stripped.
 * The renderer applies the same rules (validateControllerUrl() in
 * src/renderer/validation.ts) — keep both in sync.
 * @param {unknown} raw - The URL as received (typed by the user / over IPC).
 * @returns {string | null} The normalized URL, or null when invalid.
 */
export function normalizeControllerUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  // A '#' can only survive URL parsing as the fragment delimiter, so its
  // presence in the href means a (possibly empty) fragment
  if (parsed.username || parsed.password || parsed.hash || parsed.href.includes('#')) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function normalizeControllerUrl()

/**
 * Tells whether a candidate controller URL designates the same controller as
 * the stored one, comparing normalized forms (a stored URL written by an older
 * version may still carry e.g. a trailing slash). An empty or invalid stored
 * URL never matches. Credentials, the site id and the certificate pin are
 * scoped to the stored URL (saveConfig() in config.ts); the renderer mirrors
 * this check (isSameControllerUrl() in src/renderer/validation.ts).
 * @param {string} storedUrl - The URL currently stored in the config.
 * @param {string} candidateUrl - The URL about to be saved.
 * @returns {boolean} True when both normalize to the same URL.
 */
export function isSameControllerUrl(storedUrl: string, candidateUrl: string): boolean {
  const stored = normalizeControllerUrl(storedUrl);
  return stored !== null && stored === normalizeControllerUrl(candidateUrl);
}
