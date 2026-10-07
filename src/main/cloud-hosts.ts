// TP-Link cloud API hosts (Account Level Open API, docs/omada-cloud-openapi.md
// §2 and §8). Pure and import-free at runtime, so cert-pinning.ts, the smoke
// stub and the TLS probe can load it; unit-tested in tests/unit/cloud-hosts.test.ts.
//
// - Regions: the cloud account's region picks the account-level base URL
//   (`https://<region>1-omada-northbound.tplinkcloud.com`).
// - The serverHost allowlist: an organization's `serverHost` is used only when
//   it is exactly `https://` + one of CLOUD_API_HOSTS (default port, no
//   userinfo, path, query or fragment); anything else lists that organization
//   as unsupported. The access token is never sent anywhere else: the cloud
//   transport refuses every URL whose origin is not an allowlisted one
//   (isAllowlistedCloudUrl(), cloud-transport.ts), and the certificate code
//   never makes a TOFU exception for these hosts (cert-pinning.ts).

import type { CloudRegion } from '../shared/types';

// The cloud account regions, in display order, and the default (the user's
// account is on EUW, spec D5)
export const CLOUD_REGIONS: readonly CloudRegion[] = ['aps', 'euw', 'use'];
export const DEFAULT_CLOUD_REGION: CloudRegion = 'euw';

// The account-level API host of each region (TP-Link's "Open API Access
// Guide", §2.1). These three hostnames are the whole allowlist
export const CLOUD_API_HOSTS: Readonly<Record<CloudRegion, string>> = {
  aps: 'aps1-omada-northbound.tplinkcloud.com',
  euw: 'euw1-omada-northbound.tplinkcloud.com',
  use: 'use1-omada-northbound.tplinkcloud.com'
};

// The only accepted spelling of a serverHost before parsing: `https://`, a
// hostname of letters, digits, dots and hyphens, an optional explicit default
// port and an optional trailing slash. No userinfo ('@'), other port, path,
// query, fragment, percent-encoding, backslash or white space can pass
const SERVER_HOST_SHAPE = /^https:\/\/[A-Za-z0-9.-]{1,253}(?::443)?\/?$/;

// Upper bound for a URL checked by isAllowlistedCloudUrl() (defense against
// absurd values; real request URLs are far shorter)
const MAX_CLOUD_URL_LENGTH = 4096;

/**
 * Type guard for the cloud regions.
 * @param {unknown} value - Candidate value (config file or IPC).
 * @returns {value is CloudRegion} True when the value is a supported region.
 */
export function isCloudRegion(value: unknown): value is CloudRegion {
  return typeof value === 'string' && (CLOUD_REGIONS as readonly string[]).includes(value);
}

/**
 * Returns the account-level base URL of a region (no trailing slash).
 * @param {CloudRegion} region - The region.
 * @returns {string} E.g. "https://euw1-omada-northbound.tplinkcloud.com".
 * @throws {Error} On an unknown region.
 */
export function cloudBaseUrl(region: CloudRegion): string {
  if (!isCloudRegion(region)) {
    throw new Error('Unknown cloud region');
  }
  return `https://${CLOUD_API_HOSTS[region]}`;
}

/**
 * Tells whether a hostname is one of the allowlisted cloud API hosts
 * (case-insensitive; a trailing dot or any other spelling is not).
 * @param {string} hostname - A hostname (no port).
 * @returns {boolean} True for exactly one of CLOUD_API_HOSTS.
 */
export function isCloudApiHostname(hostname: string): boolean {
  if (typeof hostname !== 'string') {
    return false;
  }
  const lower = hostname.toLowerCase();
  return Object.values(CLOUD_API_HOSTS).includes(lower);
}

/**
 * Applies the serverHost allowlist to the value an organization reports: it
 * must be spelled `https://<host>` (SERVER_HOST_SHAPE: optionally `:443` and a
 * trailing slash) and parse as https on the default port, without userinfo,
 * path, query or fragment, with a hostname that is exactly one of
 * CLOUD_API_HOSTS.
 * @param {unknown} serverHost - The raw `serverHost` field.
 * @returns {string | null} The normalized origin ("https://<host>"), or null
 *   when the value is absent or not allowlisted.
 */
export function allowlistedCloudOrigin(serverHost: unknown): string | null {
  if (typeof serverHost !== 'string' || !SERVER_HOST_SHAPE.test(serverHost)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(serverHost);
  } catch {
    return null;
  }
  const plain =
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    parsed.pathname === '/' &&
    parsed.search === '' &&
    parsed.hash === '';
  if (!plain || !isCloudApiHostname(parsed.hostname)) {
    return null;
  }
  return `https://${parsed.hostname}`;
} // End of function allowlistedCloudOrigin()

/**
 * The cloud transport's guard (defense in depth): tells whether a request URL
 * goes to an allowlisted cloud API origin — https, the default port, no
 * userinfo, an allowlisted hostname. The path and query are the caller's.
 * @param {string} url - The absolute request URL.
 * @returns {boolean} True when the request may be sent.
 */
export function isAllowlistedCloudUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_CLOUD_URL_LENGTH) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.username === '' &&
    parsed.password === '' &&
    parsed.port === '' &&
    isCloudApiHostname(parsed.hostname) &&
    parsed.origin === `https://${parsed.hostname}`
  );
} // End of function isAllowlistedCloudUrl()
