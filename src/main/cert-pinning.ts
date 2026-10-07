// Certificate trust-on-first-use (TOFU) pinning: the decision logic. Pure (no
// Electron, no filesystem — only Node's crypto for the fingerprint), so it is
// unit-tested directly (tests/unit/cert-pinning.test.ts). The Electron glue
// that feeds it lives in cert-verify.ts; index.ts wires that glue into both
// session.setCertificateVerifyProc() and app 'certificate-error', so both
// apply exactly the same decision.
//
// Decision rules (todo.md 4.4):
// - Hosts other than the configured controller's hostname keep Chromium's own
//   verdict (the app never weakens verification for anything else).
// - A certificate Chromium already trusts (net::OK, e.g. a CA-issued or
//   Let's Encrypt certificate) is accepted normally: TOFU governs ONLY the
//   self-signed bypass, so routine CA renewals never look like a mismatch.
// - Only the failure classes a self-signed controller certificate produces
//   (isSelfSignedVerificationResult()) are eligible for TOFU at all; anything
//   else (revoked, weak signature, ...) keeps Chromium's rejection.
// - An eligible certificate for the configured host is accepted ONLY when its
//   SHA-256 fingerprint equals the pin stored for the configured origin; with
//   no pin it is rejected as "first use", with a different pin as "mismatch".
// The verify proc only learns the hostname (no port), so the pin is what
// binds the bypass to one certificate: another port on the same host that
// presents a different certificate is rejected as a mismatch.
// - A TP-Link cloud API host (isCloudApiHostname(), cloud-hosts.ts) always
//   keeps Chromium's verdict, even when it is (absurdly) the configured
//   controller's hostname: no pin can ever accept a certificate for it. The
//   cloud requests use their own session without any verify proc
//   (cloud-transport.ts); this rule covers the other sessions and app
//   'certificate-error'.

import { X509Certificate } from 'crypto';
import { isCloudApiHostname } from './cloud-hosts';

/**
 * The trusted certificate stored in the config: one record, because the app
 * is single-controller and a controller URL change clears it.
 */
export interface CertificatePin {
  // Normalized origin of the controller URL the pin belongs to
  // (e.g. "https://192.168.1.130:8043")
  origin: string;
  // SHA-256 fingerprint of the leaf certificate's DER, colon-separated
  // uppercase hex (see FINGERPRINT_REGEX)
  sha256: string;
  // ISO 8601 timestamp of the user's "Trust and connect" decision
  trustedAt: string;
}

/**
 * What to do with one certificate verification:
 * - 'default': not a TOFU case — Chromium's own verdict stands;
 * - 'accept': the certificate matches the pin — accept it;
 * - 'reject-first-use': eligible, but nothing is pinned for the configured
 *   origin yet — reject and let the user confirm the fingerprint;
 * - 'reject-mismatch': eligible, but a DIFFERENT certificate is pinned —
 *   reject ("certificate changed");
 * - 'reject': eligible, but no fingerprint could be computed — reject.
 */
export type CertificateDecision =
  | { action: 'default' }
  | { action: 'accept' }
  | { action: 'reject-first-use'; fingerprint: string }
  | { action: 'reject-mismatch'; fingerprint: string; pinnedFingerprint: string }
  | { action: 'reject' };

/**
 * Input of decideCertificate().
 */
export interface CertificateDecisionInput {
  // Hostname the certificate was presented for (no port: Electron's verify
  // request does not carry one)
  hostname: string;
  // Chromium's own verification result, e.g. "net::OK" or
  // "net::ERR_CERT_AUTHORITY_INVALID"
  verificationResult: string;
  // Presented leaf certificate's fingerprint (computeCertificateFingerprint()),
  // or null when it could not be computed
  fingerprint: string | null;
  // The configured controller URL ('' when none is configured)
  configuredUrl: string;
  // The stored pin, or null when none is stored
  pin: CertificatePin | null;
}

/**
 * A rejection the user may act on, recorded by the verify proc so that
 * OMADA_CONNECT can turn the resulting TLS failure into a specific error.
 */
export interface CertificatePinRejection {
  kind: 'first-use' | 'mismatch';
  // Hostname the certificate was presented for (normalized, see normalizeHostname())
  hostname: string;
  // Presented certificate's fingerprint
  fingerprint: string;
  // Stored fingerprint (mismatch only)
  pinnedFingerprint?: string;
}

// Chromium verification results eligible for TOFU: the failure classes a
// self-signed Omada controller certificate actually produces (untrusted
// issuer, name mismatch, expired). Anything else — revoked, weak signature,
// etc. — is never offered TOFU and never bypassed
export const SELF_SIGNED_VERIFICATION_ERRORS: readonly string[] = [
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID',
  'ERR_CERT_DATE_INVALID'
];

// A SHA-256 fingerprint as displayed and stored: 32 bytes as colon-separated
// uppercase hex pairs (exactly Node's X509Certificate.fingerprint256 format).
// The renderer applies the same pattern (src/renderer/validation.ts — keep
// both in sync)
export const FINGERPRINT_REGEX = /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/;

// Length cap for a stored trustedAt timestamp (an ISO 8601 string is ~24
// characters; the cap only rejects absurd values from a hand-edited file)
const MAX_TRUSTED_AT_LENGTH = 64;

/**
 * Returns true when a Chromium certificate verification result is one of the
 * failure classes expected from a self-signed controller certificate.
 * Substring match so the check tolerates the "net::" prefix Chromium adds.
 * @param {string} verificationResult - Result string from the verify proc.
 * @returns {boolean} True when the failure class is eligible for TOFU.
 */
export function isSelfSignedVerificationResult(verificationResult: string): boolean {
  return SELF_SIGNED_VERIFICATION_ERRORS.some((code) => verificationResult.includes(code));
}

/**
 * Validates a fingerprint string (see FINGERPRINT_REGEX).
 * @param {unknown} value - Candidate fingerprint.
 * @returns {value is string} True when the value is a well-formed fingerprint.
 */
export function isValidFingerprint(value: unknown): value is string {
  return typeof value === 'string' && FINGERPRINT_REGEX.test(value);
}

/**
 * Computes the SHA-256 fingerprint of a certificate's DER encoding from its
 * PEM text (Electron's Certificate.data; the first certificate in the PEM is
 * the leaf), formatted as colon-separated uppercase hex.
 * @param {unknown} pem - PEM-encoded certificate.
 * @returns {string | null} The fingerprint, or null when the PEM is unusable.
 */
export function computeCertificateFingerprint(pem: unknown): string | null {
  if (typeof pem !== 'string' || pem.length === 0) {
    return null;
  }
  try {
    const fingerprint = new X509Certificate(pem).fingerprint256;
    return isValidFingerprint(fingerprint) ? fingerprint : null;
  } catch {
    return null;
  }
} // End of function computeCertificateFingerprint()

/**
 * Returns the origin (scheme + host + port) of an https controller URL, which
 * is what a pin is scoped to.
 * @param {string} url - The controller URL (normally already normalized).
 * @returns {string | null} The origin, or null for a missing/invalid/non-https URL.
 */
export function controllerOriginOf(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname ? parsed.origin : null;
  } catch {
    return null;
  }
} // End of function controllerOriginOf()

/**
 * Normalizes a hostname for comparison: lower-cased, with the brackets of an
 * IPv6 literal removed (URL.hostname keeps them; Chromium may not).
 * @param {string} hostname - Hostname as given by a URL or by Chromium.
 * @returns {string} The comparable hostname.
 */
export function normalizeHostname(hostname: string): string {
  const lower = (hostname || '').toLowerCase();
  return lower.startsWith('[') && lower.endsWith(']') ? lower.slice(1, -1) : lower;
}

/**
 * Validates a pin read from the config file: an object with an https origin,
 * a well-formed fingerprint and a short string timestamp.
 * @param {unknown} raw - The parsed value.
 * @returns {raw is CertificatePin} True when the value is a usable pin.
 */
export function isValidCertificatePin(raw: unknown): raw is CertificatePin {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.origin === 'string' &&
    controllerOriginOf(candidate.origin) === candidate.origin &&
    isValidFingerprint(candidate.sha256) &&
    typeof candidate.trustedAt === 'string' &&
    candidate.trustedAt.length > 0 &&
    candidate.trustedAt.length <= MAX_TRUSTED_AT_LENGTH
  );
} // End of function isValidCertificatePin()

/**
 * Returns the pinned fingerprint that applies to the configured controller:
 * the stored pin's fingerprint when the pin belongs to the configured origin,
 * else null (a pin for another origin never applies).
 * @param {string} configuredUrl - The configured controller URL.
 * @param {CertificatePin | null} pin - The stored pin.
 * @returns {string | null} The applicable pinned fingerprint, or null.
 */
export function pinnedFingerprintFor(configuredUrl: string, pin: CertificatePin | null): string | null {
  const origin = controllerOriginOf(configuredUrl);
  if (!origin || !pin || pin.origin !== origin || !isValidFingerprint(pin.sha256)) {
    return null;
  }
  return pin.sha256;
} // End of function pinnedFingerprintFor()

/**
 * Decides what to do with one certificate verification (see the decision
 * rules at the top of this file).
 * @param {CertificateDecisionInput} input - Hostname, Chromium's result, the
 *   presented fingerprint, the configured URL and the stored pin.
 * @returns {CertificateDecision} The decision.
 */
export function decideCertificate(input: CertificateDecisionInput): CertificateDecision {
  if (isCloudApiHostname(normalizeHostname(input.hostname))) {
    // A TP-Link cloud API host: Chromium's verdict, never a TOFU exception
    return { action: 'default' };
  }
  const configuredOrigin = controllerOriginOf(input.configuredUrl);
  if (!configuredOrigin) {
    // Nothing configured: there is no controller to make an exception for
    return { action: 'default' };
  }
  const configuredHostname = normalizeHostname(new URL(configuredOrigin).hostname);
  if (!input.hostname || normalizeHostname(input.hostname) !== configuredHostname) {
    // Any other host keeps Chromium's verdict
    return { action: 'default' };
  }
  if (!isSelfSignedVerificationResult(input.verificationResult || '')) {
    // Trusted by Chromium (accepted normally) or a failure class TOFU never
    // covers (rejected normally)
    return { action: 'default' };
  }
  if (!isValidFingerprint(input.fingerprint)) {
    return { action: 'reject' };
  }
  const pinned = pinnedFingerprintFor(input.configuredUrl, input.pin);
  if (pinned === null) {
    return { action: 'reject-first-use', fingerprint: input.fingerprint };
  }
  if (pinned === input.fingerprint) {
    return { action: 'accept' };
  }
  return { action: 'reject-mismatch', fingerprint: input.fingerprint, pinnedFingerprint: pinned };
} // End of function decideCertificate()

/**
 * Decision for app 'certificate-error' (webContents loads), which, unlike the
 * verify proc, knows the full URL: the URL's origin must equal the configured
 * origin exactly (anything else keeps Chromium's rejection), then the same
 * decideCertificate() rules apply with the URL's hostname.
 * @param {object} input - The failing URL, Chromium's error string, the
 *   presented fingerprint, the configured URL and the stored pin.
 * @param {string} input.url - URL whose load hit the certificate error.
 * @param {string} input.error - Chromium's error, e.g. "net::ERR_CERT_AUTHORITY_INVALID".
 * @param {string | null} input.fingerprint - Presented certificate's fingerprint.
 * @param {string} input.configuredUrl - The configured controller URL.
 * @param {CertificatePin | null} input.pin - The stored pin.
 * @returns {CertificateDecision} The decision ('default' = keep the rejection).
 */
export function decideCertificateError(input: {
  url: string;
  error: string;
  fingerprint: string | null;
  configuredUrl: string;
  pin: CertificatePin | null;
}): CertificateDecision {
  const configuredOrigin = controllerOriginOf(input.configuredUrl);
  let requestOrigin: string | null = null;
  let requestHostname = '';
  try {
    const parsed = new URL(input.url);
    requestOrigin = parsed.origin;
    requestHostname = parsed.hostname;
  } catch {
    // Malformed URL: keep Chromium's rejection
  }
  if (!configuredOrigin || requestOrigin !== configuredOrigin) {
    return { action: 'default' };
  }
  return decideCertificate({
    hostname: requestHostname,
    verificationResult: input.error,
    fingerprint: input.fingerprint,
    configuredUrl: input.configuredUrl,
    pin: input.pin
  });
} // End of function decideCertificateError()
