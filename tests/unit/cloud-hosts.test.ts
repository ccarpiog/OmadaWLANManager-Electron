// Tests for the TP-Link cloud host allowlist (src/main/cloud-hosts.ts) and the
// cloud network path (src/main/cloud-transport.ts): the region base URLs, the
// serverHost allowlist (https, default port, no userinfo, path, query,
// fragment, trailing-dot or look-alike tricks), the transport guard that
// refuses every non-allowlisted origin before anything is sent, and the cloud
// session's wiring (its own in-memory partition, no verify proc). No network:
// the inner transport is a recorder.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Session } from 'electron';
import {
  allowlistedCloudOrigin,
  CLOUD_API_HOSTS,
  CLOUD_REGIONS,
  cloudBaseUrl,
  DEFAULT_CLOUD_REGION,
  isAllowlistedCloudUrl,
  isCloudApiHostname,
  isCloudRegion
} from '../../src/main/cloud-hosts';
import {
  CLOUD_ORIGIN_REFUSED_MESSAGE,
  CLOUD_SESSION_PARTITION,
  createAllowlistedCloudTransport,
  createCloudSession
} from '../../src/main/cloud-transport';
import type { OmadaHttpRequest, OmadaTransport } from '../../src/main/omada-transport';

const EUW = 'https://euw1-omada-northbound.tplinkcloud.com';

describe('cloud regions and base URLs', () => {
  test('three regions, EUW by default, each with its documented base URL', () => {
    assert.deepEqual(CLOUD_REGIONS, ['aps', 'euw', 'use']);
    assert.equal(DEFAULT_CLOUD_REGION, 'euw');
    assert.equal(cloudBaseUrl('aps'), 'https://aps1-omada-northbound.tplinkcloud.com');
    assert.equal(cloudBaseUrl('euw'), EUW);
    assert.equal(cloudBaseUrl('use'), 'https://use1-omada-northbound.tplinkcloud.com');
    for (const value of ['EUW', 'eu', '', null, 1]) {
      assert.equal(isCloudRegion(value), false, String(value));
    }
    assert.throws(() => cloudBaseUrl('xx' as unknown as 'euw'), /Unknown cloud region/);
  });

  test('isCloudApiHostname(): exactly the three hosts, any case; nothing else', () => {
    for (const host of Object.values(CLOUD_API_HOSTS)) {
      assert.equal(isCloudApiHostname(host), true, host);
      assert.equal(isCloudApiHostname(host.toUpperCase()), true, host);
    }
    for (const host of [
      'euw1-omada-northbound.tplinkcloud.com.',
      'evil.euw1-omada-northbound.tplinkcloud.com',
      'euw1-omada-northbound.tplinkcloud.com.evil.example',
      'euw2-omada-northbound.tplinkcloud.com',
      'omada-northbound-docs-beta.tplinkcloud.com',
      'tplinkcloud.com',
      '192.168.1.130',
      ''
    ]) {
      assert.equal(isCloudApiHostname(host), false, host);
    }
  });
});

describe('allowlistedCloudOrigin(): the serverHost allowlist', () => {
  test('the documented forms are accepted and normalized to the origin', () => {
    assert.equal(allowlistedCloudOrigin('https://aps1-omada-northbound.tplinkcloud.com'), 'https://aps1-omada-northbound.tplinkcloud.com');
    assert.equal(allowlistedCloudOrigin(`${EUW}/`), EUW);
    assert.equal(allowlistedCloudOrigin(`${EUW}:443`), EUW, 'the explicit default port is the default port');
    assert.equal(allowlistedCloudOrigin('https://EUW1-Omada-Northbound.TPLinkCloud.com'), EUW);
    assert.equal(allowlistedCloudOrigin('https://use1-omada-northbound.tplinkcloud.com/'), 'https://use1-omada-northbound.tplinkcloud.com');
  });

  test('anything else is refused (scheme, port, userinfo, path, query, fragment, encoding, look-alikes, non-strings)', () => {
    const refused: unknown[] = [
      'http://euw1-omada-northbound.tplinkcloud.com',
      'euw1-omada-northbound.tplinkcloud.com',
      '//euw1-omada-northbound.tplinkcloud.com',
      `${EUW}:8443`,
      `${EUW}:444`,
      'https://user@euw1-omada-northbound.tplinkcloud.com',
      'https://user:pass@euw1-omada-northbound.tplinkcloud.com',
      'https://evil.example@euw1-omada-northbound.tplinkcloud.com',
      'https://euw1-omada-northbound.tplinkcloud.com@evil.example',
      `${EUW}/v1`,
      `${EUW}/v1/cloudaccess`,
      `${EUW}/.`,
      `${EUW}?x=1`,
      `${EUW}?`,
      `${EUW}#x`,
      `${EUW}#`,
      `${EUW}\\`,
      'https:\\\\euw1-omada-northbound.tplinkcloud.com',
      ` ${EUW}`,
      `${EUW} `,
      `${EUW}\n`,
      'https://euw1-omada-northbound.tplinkcloud.com.',
      'https://euw1-omada-northbound.tplinkcloud.com.evil.example',
      'https://evil-euw1-omada-northbound.tplinkcloud.com',
      'https://euw1%2domada-northbound.tplinkcloud.com',
      'https://xn--euw1-omada-northbound-9xb.tplinkcloud.com',
      'https://192.168.1.130',
      'https://127.0.0.1',
      'https://omada-northbound-docs-beta.tplinkcloud.com',
      '',
      null,
      undefined,
      42,
      { toString: () => EUW },
      [EUW]
    ];
    for (const value of refused) {
      assert.equal(allowlistedCloudOrigin(value), null, JSON.stringify(String(value)));
    }
  }); // End of test "anything else is refused..."
});

describe('isAllowlistedCloudUrl(): the cloud transport guard', () => {
  test('request URLs on an allowlisted origin pass, whatever the path and query', () => {
    for (const url of [
      `${EUW}/authorize/account/token?type=get_tokens`,
      `${EUW}/v1/organizations?page=1&pageSize=100`,
      `${EUW}/v1/cloudaccess/7B069516D97677D0BCA8E643F334A1A3F182A1/openapi/v1/5ffc0460d2816b0d09b531cd27c106a8/sites?page=1&pageSize=100`,
      'https://aps1-omada-northbound.tplinkcloud.com:443/v1/organizations'
    ]) {
      assert.equal(isAllowlistedCloudUrl(url), true, url);
    }
  });

  test('other origins, schemes, ports and userinfo are refused', () => {
    for (const url of [
      'https://192.168.1.130:8043/openapi/v1/x/sites',
      'https://127.0.0.1:8443/v1/organizations',
      'http://euw1-omada-northbound.tplinkcloud.com/v1/organizations',
      'https://euw1-omada-northbound.tplinkcloud.com:8443/v1/organizations',
      'https://u:p@euw1-omada-northbound.tplinkcloud.com/v1/organizations',
      'https://euw1-omada-northbound.tplinkcloud.com.evil.example/v1',
      'https://omada-northbound-docs-beta.tplinkcloud.com/api/markdowns/x',
      'not a url',
      '',
      `${EUW}/${'x'.repeat(5000)}`
    ]) {
      assert.equal(isAllowlistedCloudUrl(url), false, url.slice(0, 80));
    }
  });
});

/**
 * An inner transport that records what reaches it.
 * @returns {{ transport: OmadaTransport; sent: OmadaHttpRequest[] }} The recorder.
 */
function recordingTransport(): { transport: OmadaTransport; sent: OmadaHttpRequest[] } {
  const sent: OmadaHttpRequest[] = [];
  return {
    sent,
    transport: {
      send: async (request) => {
        sent.push(request);
        return { statusCode: 200, body: '{"errorCode":0}' };
      }
    }
  };
}

describe('createAllowlistedCloudTransport()', () => {
  test('an allowlisted URL reaches the inner transport; any other is refused with fixed text before it, the token never leaves', async () => {
    const { transport, sent } = recordingTransport();
    const guarded = createAllowlistedCloudTransport(transport);
    const ok = await guarded.send({ method: 'GET', url: `${EUW}/v1/organizations?page=1&pageSize=100`, headers: { Authorization: 'AccessToken=AT-x' } }, () => undefined);
    assert.equal(ok.statusCode, 200);
    for (const url of ['https://evil.example/v1/organizations', 'https://192.168.1.130:8043/openapi/v1/x/sites', `http://${CLOUD_API_HOSTS.euw}/v1/organizations`]) {
      await assert.rejects(
        guarded.send({ method: 'GET', url, headers: { Authorization: 'AccessToken=AT-secret-token' } }, () => undefined),
        (error: unknown) => error instanceof Error && error.message === CLOUD_ORIGIN_REFUSED_MESSAGE && !error.message.includes('evil')
      );
    }
    assert.equal(sent.length, 1, 'only the allowlisted request was sent');
    assert.equal(sent[0].url, `${EUW}/v1/organizations?page=1&pageSize=100`);
  }); // End of test "an allowlisted URL reaches the inner transport..."
});

describe('createCloudSession()', () => {
  test('the cloud session is its own in-memory partition, with any verify proc removed (Chromium\'s own verification)', () => {
    const partitions: string[] = [];
    const procs: unknown[] = [];
    const fakeSession = {
      setCertificateVerifyProc: (proc: unknown) => {
        procs.push(proc);
      }
    } as unknown as Session;
    const created = createCloudSession((partition) => {
      partitions.push(partition);
      return fakeSession;
    });
    assert.equal(created, fakeSession);
    assert.deepEqual(partitions, [CLOUD_SESSION_PARTITION]);
    assert.equal(CLOUD_SESSION_PARTITION.startsWith('persist:'), false, 'in memory: nothing on disk');
    assert.notEqual(CLOUD_SESSION_PARTITION, 'omada-controller-tls-1', 'never a controller partition');
    assert.deepEqual(procs, [null]);
  }); // End of test "the cloud session is its own in-memory partition..."
});
