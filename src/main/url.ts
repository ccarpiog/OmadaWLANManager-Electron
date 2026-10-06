// Controller URL validation/normalization. Pure (no Electron, no filesystem),
// so it is unit-tested directly (tests/unit/url.test.ts); config.ts applies it
// to every URL it saves.

/**
 * Validates and normalizes a controller URL: it must parse, use HTTPS (plain
 * HTTP would send credentials unencrypted), and carry no embedded credentials
 * or fragment; a trailing slash is stripped. The renderer applies the same
 * rules (validateControllerUrl() in src/renderer/settings-modal.ts) — keep
 * both in sync.
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
  if (parsed.username || parsed.password || parsed.hash) {
    return null;
  }
  let normalized = parsed.toString();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
} // End of function normalizeControllerUrl()
