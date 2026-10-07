// Tests for certificate trust-on-first-use pinning: the pure decision module
// (src/main/cert-pinning.ts) and the verification glue that both Electron
// hooks use (src/main/cert-verify.ts, driven here with fake sessions and
// certificates — it imports only TYPES from electron). The empirical
// Chromium behaviour (verdict cache, pooled connections) is covered by the
// opt-in TLS probe in tests/tls-probe/.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Certificate, Session } from 'electron';
import {
  CertificatePin,
  CertificatePinRejection,
  computeCertificateFingerprint,
  controllerOriginOf,
  decideCertificate,
  decideCertificateError,
  isSelfSignedVerificationResult,
  isValidCertificatePin,
  normalizeHostname,
  pinnedFingerprintFor
} from '../../src/main/cert-pinning';
import {
  CertificateTrustSource,
  ControllerTlsSessions,
  evaluateCertificate,
  isCertificateErrorAllowed,
  verifyProcResult
} from '../../src/main/cert-verify';
import certificateFixture from '../fixtures/certs/self-signed-controller.json';

const CONTROLLER_URL = 'https://192.168.1.130:8043';
const CONTROLLER_ORIGIN = 'https://192.168.1.130:8043';
const FINGERPRINT_A = certificateFixture.sha256;
const FINGERPRINT_B = Array.from({ length: 32 }, () => 'AB').join(':');
const SELF_SIGNED = 'net::ERR_CERT_AUTHORITY_INVALID';

/**
 * Builds a pin for the controller origin.
 * @param {string} sha256 - Pinned fingerprint.
 * @param {string} [origin] - Pinned origin.
 * @returns {CertificatePin} The pin.
 */
function pinOf(sha256: string, origin = CONTROLLER_ORIGIN): CertificatePin {
  return { origin, sha256, trustedAt: '2026-10-06T10:00:00.000Z' };
}

/**
 * Runs decideCertificate() for the configured controller with overrides.
 * @param {Partial<Parameters<typeof decideCertificate>[0]>} overrides - Fields to change.
 * @returns {ReturnType<typeof decideCertificate>} The decision.
 */
function decide(overrides: Partial<Parameters<typeof decideCertificate>[0]>): ReturnType<typeof decideCertificate> {
  return decideCertificate({
    hostname: '192.168.1.130',
    verificationResult: SELF_SIGNED,
    fingerprint: FINGERPRINT_A,
    configuredUrl: CONTROLLER_URL,
    pin: null,
    ...overrides
  });
}

describe('computeCertificateFingerprint', () => {
  test('SHA-256 of the DER from a fixture PEM equals the openssl fingerprint (colon-separated uppercase hex)', () => {
    assert.equal(computeCertificateFingerprint(certificateFixture.pem), certificateFixture.sha256);
  });

  test('unusable input yields null', () => {
    for (const value of ['', 'not a pem', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----', null, undefined, 42]) {
      assert.equal(computeCertificateFingerprint(value), null, String(value));
    }
  });
}); // End of the describe block for computeCertificateFingerprint

describe('decideCertificate', () => {
  test('first use: self-signed certificate for the configured host and no pin -> rejected as first use', () => {
    assert.deepEqual(decide({ pin: null }), { action: 'reject-first-use', fingerprint: FINGERPRINT_A });
  });

  test('match: the pinned fingerprint -> accepted', () => {
    assert.deepEqual(decide({ pin: pinOf(FINGERPRINT_A) }), { action: 'accept' });
  });

  test('mismatch: a different fingerprint than the pin -> rejected as mismatch with both fingerprints', () => {
    assert.deepEqual(decide({ fingerprint: FINGERPRINT_B, pin: pinOf(FINGERPRINT_A) }), {
      action: 'reject-mismatch',
      fingerprint: FINGERPRINT_B,
      pinnedFingerprint: FINGERPRINT_A
    });
  });

  test('CA-trusted certificate (net::OK) keeps Chromium\'s verdict, with or without a pin (renewals never mismatch)', () => {
    assert.deepEqual(decide({ verificationResult: 'net::OK', pin: null }), { action: 'default' });
    assert.deepEqual(decide({ verificationResult: 'net::OK', fingerprint: FINGERPRINT_B, pin: pinOf(FINGERPRINT_A) }), { action: 'default' });
  });

  test('other hosts keep Chromium\'s verdict', () => {
    assert.deepEqual(decide({ hostname: '192.168.1.131' }), { action: 'default' });
    assert.deepEqual(decide({ hostname: 'evil.example', pin: pinOf(FINGERPRINT_A) }), { action: 'default' });
    assert.deepEqual(decide({ hostname: '' }), { action: 'default' });
  });

  test('failure classes outside the self-signed set are never offered TOFU (even with a matching pin)', () => {
    for (const result of ['net::ERR_CERT_REVOKED', 'net::ERR_CERT_WEAK_SIGNATURE_ALGORITHM', 'net::ERR_CERT_INVALID', 'net::ERR_CERT_SYMANTEC_LEGACY', '']) {
      assert.deepEqual(decide({ verificationResult: result, pin: pinOf(FINGERPRINT_A) }), { action: 'default' }, result);
    }
  });

  test('every self-signed failure class is eligible', () => {
    for (const result of ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID', 'net::ERR_CERT_DATE_INVALID']) {
      assert.equal(isSelfSignedVerificationResult(result), true, result);
      assert.deepEqual(decide({ verificationResult: result }), { action: 'reject-first-use', fingerprint: FINGERPRINT_A }, result);
    }
  });

  test('a pin stored for another origin never applies (first use for this origin)', () => {
    assert.deepEqual(decide({ pin: pinOf(FINGERPRINT_A, 'https://192.168.1.130:9443') }), { action: 'reject-first-use', fingerprint: FINGERPRINT_A });
  });

  test('a different port of the same host presenting another certificate is a mismatch (the pin binds the certificate)', () => {
    // The verify proc only sees the hostname; the configured origin has port 8043
    assert.deepEqual(decide({ fingerprint: FINGERPRINT_B, pin: pinOf(FINGERPRINT_A) }).action, 'reject-mismatch');
  });

  test('no controller configured -> Chromium\'s verdict', () => {
    assert.deepEqual(decide({ configuredUrl: '' }), { action: 'default' });
    assert.deepEqual(decide({ configuredUrl: 'http://192.168.1.130:8043' }), { action: 'default' });
  });

  test('eligible certificate without a computable fingerprint is rejected', () => {
    assert.deepEqual(decide({ fingerprint: null }), { action: 'reject' });
    assert.deepEqual(decide({ fingerprint: 'zz', pin: pinOf(FINGERPRINT_A) }), { action: 'reject' });
  });

  test('hostnames compare case-insensitively and without IPv6 brackets', () => {
    assert.equal(normalizeHostname('[::1]'), '::1');
    assert.deepEqual(decide({ configuredUrl: 'https://[::1]:8043', hostname: '::1' }).action, 'reject-first-use');
    assert.deepEqual(decide({ configuredUrl: 'https://[::1]:8043', hostname: '[::1]' }).action, 'reject-first-use');
    assert.deepEqual(decide({ configuredUrl: 'https://Omada.Example.com', hostname: 'omada.example.com' }).action, 'reject-first-use');
  });

  test('a TP-Link cloud API host keeps Chromium\'s verdict even when it is the configured host with a matching pin (inbox I-1a)', () => {
    for (const host of ['euw1-omada-northbound.tplinkcloud.com', 'APS1-omada-northbound.tplinkcloud.com', 'use1-omada-northbound.tplinkcloud.com']) {
      const configuredUrl = `https://${host.toLowerCase()}`;
      const pin = pinOf(FINGERPRINT_A, configuredUrl);
      assert.deepEqual(decide({ hostname: host, configuredUrl, pin }), { action: 'default' }, host);
      assert.deepEqual(decide({ hostname: host, configuredUrl, pin: null }), { action: 'default' }, 'no first-use dialog either');
      assert.equal(
        decideCertificateError({ url: `${configuredUrl}/v1/organizations`, error: SELF_SIGNED, fingerprint: FINGERPRINT_A, configuredUrl, pin }).action,
        'default',
        host
      );
    }
    // A look-alike is just another host: still a TOFU case when configured
    assert.equal(decide({ hostname: 'euw1-omada-northbound.tplinkcloud.com.evil.example', configuredUrl: 'https://euw1-omada-northbound.tplinkcloud.com.evil.example' }).action, 'reject-first-use');
  }); // End of test "a TP-Link cloud API host keeps Chromium's verdict..."
}); // End of the describe block for decideCertificate

describe('decideCertificateError (webContents certificate-error)', () => {
  /**
   * Runs decideCertificateError() for the configured controller.
   * @param {string} url - Failing URL.
   * @param {CertificatePin | null} pin - Stored pin.
   * @returns {string} The decision action.
   */
  const action = (url: string, pin: CertificatePin | null): string =>
    decideCertificateError({ url, error: SELF_SIGNED, fingerprint: FINGERPRINT_A, configuredUrl: CONTROLLER_URL, pin }).action;

  test('requires the exact configured origin, then applies the same pin rules', () => {
    assert.equal(action('https://192.168.1.130:8043/api/info', pinOf(FINGERPRINT_A)), 'accept');
    assert.equal(action('https://192.168.1.130:8043/api/info', null), 'reject-first-use');
    assert.equal(action('https://192.168.1.130:9999/api/info', pinOf(FINGERPRINT_A)), 'default');
    assert.equal(action('https://192.168.1.13:8043/', pinOf(FINGERPRINT_A)), 'default');
    assert.equal(action('not a url', pinOf(FINGERPRINT_A)), 'default');
  });
}); // End of the describe block for decideCertificateError

describe('pin helpers', () => {
  test('controllerOriginOf: https origins only', () => {
    assert.equal(controllerOriginOf('https://192.168.1.130:8043/omada'), CONTROLLER_ORIGIN);
    assert.equal(controllerOriginOf('https://omada.example.com:443'), 'https://omada.example.com');
    assert.equal(controllerOriginOf('http://192.168.1.130:8043'), null);
    assert.equal(controllerOriginOf(''), null);
    assert.equal(controllerOriginOf('nope'), null);
  });

  test('isValidCertificatePin: shape, https origin without path, fingerprint format, timestamp', () => {
    assert.equal(isValidCertificatePin(pinOf(FINGERPRINT_A)), true);
    assert.equal(isValidCertificatePin({ ...pinOf(FINGERPRINT_A), origin: 'http://192.168.1.130:8043' }), false);
    assert.equal(isValidCertificatePin({ ...pinOf(FINGERPRINT_A), origin: 'https://192.168.1.130:8043/path' }), false);
    assert.equal(isValidCertificatePin({ ...pinOf(FINGERPRINT_A), sha256: FINGERPRINT_A.toLowerCase() }), false);
    assert.equal(isValidCertificatePin({ ...pinOf(FINGERPRINT_A), trustedAt: '' }), false);
    assert.equal(isValidCertificatePin({ ...pinOf(FINGERPRINT_A), trustedAt: 'x'.repeat(65) }), false);
    assert.equal(isValidCertificatePin(null), false);
    assert.equal(isValidCertificatePin('pin'), false);
  });

  test('pinnedFingerprintFor: only a pin for the configured origin applies', () => {
    assert.equal(pinnedFingerprintFor(CONTROLLER_URL, pinOf(FINGERPRINT_A)), FINGERPRINT_A);
    assert.equal(pinnedFingerprintFor(`${CONTROLLER_URL}/omada`, pinOf(FINGERPRINT_A)), FINGERPRINT_A);
    assert.equal(pinnedFingerprintFor('https://192.168.1.131:8043', pinOf(FINGERPRINT_A)), null);
    assert.equal(pinnedFingerprintFor(CONTROLLER_URL, null), null);
    assert.equal(pinnedFingerprintFor('', pinOf(FINGERPRINT_A)), null);
  });
}); // End of the describe block for pin helpers

// ============================================================================
// Verification glue (cert-verify.ts)
// ============================================================================

/**
 * A trust source backed by plain fields, recording rejections.
 * @param {CertificatePin | null} pin - Stored pin.
 * @returns {CertificateTrustSource & { rejections: CertificatePinRejection[]; pin: CertificatePin | null }} The source.
 */
function fakeSource(pin: CertificatePin | null): CertificateTrustSource & { rejections: CertificatePinRejection[]; pin: CertificatePin | null } {
  const source = {
    pin,
    rejections: [] as CertificatePinRejection[],
    getConfiguredUrl: () => CONTROLLER_URL,
    getCertificatePin: () => source.pin,
    onPinRejection: (rejection: CertificatePinRejection) => {
      source.rejections.push(rejection);
    }
  };
  return source;
} // End of function fakeSource()

/**
 * A fake Electron Certificate carrying the fixture PEM.
 * @returns {Certificate} The certificate.
 */
function fixtureCertificate(): Certificate {
  return { data: certificateFixture.pem } as unknown as Certificate;
}

describe('cert-verify: the decision both Electron hooks apply', () => {
  test('evaluateCertificate computes the fingerprint from the certificate and records first-use rejections', () => {
    const source = fakeSource(null);
    const decision = evaluateCertificate(source, '192.168.1.130', SELF_SIGNED, fixtureCertificate());
    assert.deepEqual(decision, { action: 'reject-first-use', fingerprint: FINGERPRINT_A });
    assert.deepEqual(source.rejections, [{ kind: 'first-use', hostname: '192.168.1.130', fingerprint: FINGERPRINT_A }]);
  });

  test('evaluateCertificate records mismatches with the pinned fingerprint, and nothing for accept/default', () => {
    const source = fakeSource(pinOf(FINGERPRINT_B));
    assert.equal(evaluateCertificate(source, '192.168.1.130', SELF_SIGNED, fixtureCertificate()).action, 'reject-mismatch');
    assert.deepEqual(source.rejections, [{ kind: 'mismatch', hostname: '192.168.1.130', fingerprint: FINGERPRINT_A, pinnedFingerprint: FINGERPRINT_B }]);
    source.pin = pinOf(FINGERPRINT_A);
    assert.equal(evaluateCertificate(source, '192.168.1.130', SELF_SIGNED, fixtureCertificate()).action, 'accept');
    assert.equal(evaluateCertificate(source, 'other.example', SELF_SIGNED, fixtureCertificate()).action, 'default');
    assert.equal(evaluateCertificate(source, '192.168.1.130', 'net::OK', fixtureCertificate()).action, 'default');
    assert.equal(source.rejections.length, 1);
  });

  test('verifyProcResult: accept -> 0, default -> -3 (Chromium decides), every rejection -> -2', () => {
    assert.equal(verifyProcResult({ action: 'accept' }), 0);
    assert.equal(verifyProcResult({ action: 'default' }), -3);
    assert.equal(verifyProcResult({ action: 'reject' }), -2);
    assert.equal(verifyProcResult({ action: 'reject-first-use', fingerprint: FINGERPRINT_A }), -2);
    assert.equal(verifyProcResult({ action: 'reject-mismatch', fingerprint: FINGERPRINT_A, pinnedFingerprint: FINGERPRINT_B }), -2);
  });

  test('isCertificateErrorAllowed: allowed only for the configured origin with the pinned certificate', () => {
    const source = fakeSource(pinOf(FINGERPRINT_A));
    assert.equal(isCertificateErrorAllowed(source, `${CONTROLLER_URL}/x`, SELF_SIGNED, fixtureCertificate()), true);
    assert.equal(isCertificateErrorAllowed(source, 'https://192.168.1.130:1234/x', SELF_SIGNED, fixtureCertificate()), false);
    assert.equal(isCertificateErrorAllowed(source, `${CONTROLLER_URL}/x`, 'net::ERR_CERT_REVOKED', fixtureCertificate()), false);
    source.pin = null;
    assert.equal(isCertificateErrorAllowed(source, `${CONTROLLER_URL}/x`, SELF_SIGNED, fixtureCertificate()), false);
    assert.deepEqual(source.rejections.map((rejection) => rejection.kind), ['first-use']);
  });
}); // End of the describe block for cert-verify

describe('ControllerTlsSessions', () => {
  /**
   * A fake session recording the verify proc and closeAllConnections() calls.
   */
  interface FakeSession {
    partition: string;
    proc: ((request: { hostname: string; verificationResult: string; certificate: Certificate }, callback: (result: number) => void) => void) | null;
    closed: number;
  }

  test('installs the verify proc on a fresh in-memory partition and replaces it on reset, closing the old one', async () => {
    const created: FakeSession[] = [];
    /**
     * Fake session.fromPartition().
     * @param {string} partition - Partition name.
     * @returns {Session} The fake session.
     */
    const fromPartition = (partition: string): Session => {
      const fake: FakeSession = { partition, proc: null, closed: 0 };
      created.push(fake);
      return {
        setCertificateVerifyProc: (proc: FakeSession['proc']) => {
          fake.proc = proc;
        },
        closeAllConnections: async () => {
          fake.closed++;
        }
      } as unknown as Session;
    };
    const source = fakeSource(null);
    const sessions = new ControllerTlsSessions(fromPartition, source, 'test-tls');
    assert.equal(created.length, 1);
    assert.equal(created[0].partition, 'test-tls-1');
    assert.ok(!created[0].partition.startsWith('persist:'));
    assert.ok(created[0].proc, 'verify proc installed on the first session');
    const first = sessions.session;

    // The installed proc applies the decision: first use -> -2 and recorded
    let verdict: number | null = null;
    created[0].proc?.({ hostname: '192.168.1.130', verificationResult: SELF_SIGNED, certificate: fixtureCertificate() }, (result) => {
      verdict = result;
    });
    assert.equal(verdict, -2);
    assert.equal(source.rejections.length, 1);

    await sessions.reset();
    assert.equal(created.length, 2);
    assert.equal(created[1].partition, 'test-tls-2');
    assert.ok(created[1].proc, 'verify proc installed on the new session');
    assert.notEqual(sessions.session, first);
    assert.equal(created[0].closed, 1, 'old session connections closed');
    assert.equal(created[1].closed, 0);
  }); // End of test "installs the verify proc on a fresh in-memory partition..."
}); // End of the describe block for ControllerTlsSessions
