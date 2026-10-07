// Tests for the controller switcher's pure model
// (src/renderer/controller-switcher-model.ts, inbox item I-1c2a; the switcher
// UI is I-1c2b): the entries (the local controller first as "This network"
// only when configured, then the cloud controllers sorted by name with a
// "Cloud" tag, the local duplicate hidden — listed once, as local —, each
// disabled reason, the active entry marked, an active controller the list
// does not show kept), the cloud status of a failed list with the local entry
// still usable, the "Connect through TP-Link cloud" decision (offered only for
// an unreachable local controller whose omadacId a complete list shows online
// and usable), the busy predicate, the text of a refused cloud connect, main's
// connection target parsed fail-closed, and the es / en texts.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toCloudController, validateCloudOrganization } from '../../src/main/cloud-account-model';
import { cloudRefusalDetail } from '../../src/main/connection-manager';
import { describeCloudSessionError } from '../../src/main/cloud-controller-session';
import type { CloudController, CloudControllerReason, ConnectionResult } from '../../src/shared/types';
import { CLOUD_REASON_TEXT, parseCloudAccessResult, type ParsedCloudResult } from '../../src/renderer/cloud-form';
import {
  buildControllerSwitcher,
  cloudConnectFailureKey,
  cloudFallbackTarget,
  isLocalUnreachable,
  isSwitcherBusy,
  localOmadacIdOf,
  parseConnectionTarget,
  SWITCHER_CLOUD_FAILURE_TEXT,
  SWITCHER_TEXT,
  type SwitcherActivity,
  type SwitcherInput,
} from '../../src/renderer/controller-switcher-model';
import { translations, type Translations } from '../../src/renderer/i18n-strings';
import fourOrganizations from '../fixtures/cloud/organizations-four.json';

const LOCAL_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00';
const REMOTE_ID = '4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d';

/**
 * Builds a controller DTO.
 * @param {string} omadacId - Its omadacId.
 * @param {string} name - Its name.
 * @param {CloudControllerReason | null} [reason] - Why it cannot be used (null: usable).
 * @returns {CloudController} The DTO.
 */
function controller(omadacId: string, name: string, reason: CloudControllerReason | null = null): CloudController {
  return { omadacId, name, online: reason !== 'offline', version: reason === 'versionUnknown' ? null : '6.3.0.45', connectable: reason === null, reason };
}

// The stub's four-organization account: the local duplicate, one offline,
// one below 6.3, one connectable (in TP-Link's order, not by name)
const FOUR: CloudController[] = [
  controller(LOCAL_ID, 'Omada red antigua (Proxmox)'),
  controller('3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a', 'OC200 Planta 3', 'offline'),
  controller('2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', 'OC200 Planta 2', 'versionTooOld'),
  controller(REMOTE_ID, 'OC200 Planta 4'),
];

/**
 * A successful parsed list.
 * @param {CloudController[]} controllers - The controllers.
 * @param {boolean} [truncated] - Whether the list may be incomplete.
 * @returns {ParsedCloudResult} The parsed reply.
 */
function listed(controllers: CloudController[], truncated = false): ParsedCloudResult {
  return { ok: true, controllers, truncated, localOmadacId: LOCAL_ID };
}

/**
 * A switcher input: a configured local controller on screen, the four
 * organizations, the local omadacId known.
 * @param {Partial<SwitcherInput>} overrides - Fields to change.
 * @returns {SwitcherInput} The input.
 */
function inputOf(overrides: Partial<SwitcherInput>): SwitcherInput {
  return { localConfigured: true, localName: '192.168.1.130:8043', cloud: listed(FOUR), localOmadacId: LOCAL_ID, active: { kind: 'local' }, ...overrides };
}

const IDLE: SwitcherActivity = {
  isApplyingChange: false,
  isManagingApGroup: false,
  isManagingNetwork: false,
  isConnecting: false,
  isDisconnecting: false,
  isSavingSettings: false,
  isResettingCertificate: false,
};

describe('buildControllerSwitcher(): the entries', () => {
  test('local first ("This network"), then the cloud controllers by name with their versions; the local duplicate is listed once, as local', () => {
    const model = buildControllerSwitcher(inputOf({}));
    assert.deepEqual(model.entries.map((entry) => [entry.key, entry.kind, entry.name]), [
      ['local', 'local', '192.168.1.130:8043'],
      ['cloud:2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', 'cloud', 'OC200 Planta 2'],
      ['cloud:3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a', 'cloud', 'OC200 Planta 3'],
      [`cloud:${REMOTE_ID}`, 'cloud', 'OC200 Planta 4'],
    ]);
    assert.deepEqual(model.entries[0].target, { kind: 'local' });
    assert.deepEqual(model.entries[3].target, { kind: 'cloud', omadacId: REMOTE_ID });
    assert.equal(model.entries[3].version, '6.3.0.45');
    assert.deepEqual(model.cloud, { kind: 'listed', truncated: false });
    assert.equal(SWITCHER_TEXT.local, 'thisNetwork');
    assert.equal(translations.en.thisNetwork, 'This network');
    assert.equal(translations.en.controllerSwitcherCloudTag, 'Cloud');
  });

  test('each reason disables its entry with the I-1c1 reason text; a usable one has none', () => {
    const reasons: CloudControllerReason[] = ['notController', 'incompleteEntry', 'unsupportedHost', 'versionUnknown', 'versionTooOld', 'offline'];
    const controllers = [...reasons.map((reason, index) => controller(`${index}0`.repeat(16), `Org ${index}`, reason)), controller(REMOTE_ID, 'Org usable')];
    const model = buildControllerSwitcher(inputOf({ cloud: listed(controllers) }));
    for (const reason of reasons) {
      const entry = model.entries.find((candidate) => candidate.reason === reason);
      assert.ok(entry !== undefined, reason);
      assert.equal(entry.usable, false, reason);
      assert.equal(entry.reasonKey, CLOUD_REASON_TEXT[reason], reason);
    }
    const usable = model.entries.find((entry) => entry.name === 'Org usable');
    assert.equal(usable?.usable, true);
    assert.equal(usable?.reasonKey, null);
    assert.equal(model.entries[0].usable, true, 'the local entry');
  });

  test('sorted by name case- and accent-insensitively, numbers by value; the same name falls back to the omadacId', () => {
    const controllers = [
      controller('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', 'planta 10'),
      controller('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', 'Álamo'),
      controller('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3', 'Planta 9'),
      controller('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5', 'Zeta'),
      controller('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4', 'Zeta'),
    ];
    const model = buildControllerSwitcher(inputOf({ localConfigured: false, cloud: listed(controllers) }));
    assert.deepEqual(model.entries.map((entry) => entry.key), [
      'cloud:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
      'cloud:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3',
      'cloud:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2',
      'cloud:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4',
      'cloud:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5',
    ]);
  });

  test('without a local controller (cloud-only) there is no local entry, and the organization with the old local omadacId is an ordinary cloud entry', () => {
    const model = buildControllerSwitcher(inputOf({ localConfigured: false, localName: null, active: { kind: 'cloud', omadacId: REMOTE_ID } }));
    assert.equal(model.entries.some((entry) => entry.kind === 'local'), false);
    assert.equal(model.entries.length, 4);
    assert.ok(model.entries.some((entry) => entry.key === `cloud:${LOCAL_ID}`));
  });

  test('an unknown local omadacId hides nothing (the duplicate shows as a cloud entry)', () => {
    const model = buildControllerSwitcher(inputOf({ localOmadacId: null }));
    assert.equal(model.entries.length, 5);
    assert.ok(model.entries.some((entry) => entry.key === `cloud:${LOCAL_ID}`));
    assert.equal(buildControllerSwitcher(inputOf({ localOmadacId: 'not an id' })).entries.length, 5);
  });
});

describe('buildControllerSwitcher(): the active entry', () => {
  test('local active; a cloud controller active; nothing active when the target is unknown', () => {
    const local = buildControllerSwitcher(inputOf({}));
    assert.deepEqual(local.entries.filter((entry) => entry.active).map((entry) => entry.key), ['local']);
    const remote = buildControllerSwitcher(inputOf({ active: { kind: 'cloud', omadacId: REMOTE_ID } }));
    assert.deepEqual(remote.entries.filter((entry) => entry.active).map((entry) => entry.key), [`cloud:${REMOTE_ID}`]);
    assert.ok(remote.entries.every((entry) => entry.viaCloud === false));
    assert.deepEqual(buildControllerSwitcher(inputOf({ active: null })).entries.filter((entry) => entry.active), []);
  });

  test('the local controller reached through its cloud duplicate: the local entry is active, marked viaCloud, and the duplicate stays hidden', () => {
    const model = buildControllerSwitcher(inputOf({ active: { kind: 'cloud', omadacId: LOCAL_ID } }));
    assert.equal(model.entries[0].key, 'local');
    assert.equal(model.entries[0].active, true);
    assert.equal(model.entries[0].viaCloud, true);
    assert.deepEqual(model.entries[0].target, { kind: 'local' }, 'choosing it connects directly');
    assert.equal(model.entries.some((entry) => entry.key === `cloud:${LOCAL_ID}`), false);
    assert.equal(model.entries.filter((entry) => entry.active).length, 1);
  });

  test('an active cloud controller the list does not show is kept (listed: false), with the connected name when known', () => {
    const missing = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const model = buildControllerSwitcher(inputOf({ active: { kind: 'cloud', omadacId: missing }, activeName: 'OC200 Sótano' }));
    const entry = model.entries.find((candidate) => candidate.active);
    assert.deepEqual(entry, {
      key: `cloud:${missing}`, target: { kind: 'cloud', omadacId: missing }, kind: 'cloud', name: 'OC200 Sótano', version: null,
      usable: true, reason: null, reasonKey: null, active: true, viaCloud: false, listed: false,
    });
    // A failed list: the active one is still there, its name unknown → last
    const failed = buildControllerSwitcher(inputOf({ cloud: parseCloudAccessResult({ success: false, error: 'rateLimited' }), active: { kind: 'cloud', omadacId: missing } }));
    assert.deepEqual(failed.entries.map((candidate) => [candidate.key, candidate.name, candidate.listed]), [['local', '192.168.1.130:8043', true], [`cloud:${missing}`, null, false]]);
  });

  test('an active controller that is listed but not usable now stays marked (and disabled with its reason)', () => {
    const offlineId = '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a';
    const entry = buildControllerSwitcher(inputOf({ active: { kind: 'cloud', omadacId: offlineId } })).entries.find((candidate) => candidate.active);
    assert.equal(entry?.key, `cloud:${offlineId}`);
    assert.equal(entry?.usable, false);
    assert.equal(entry?.reason, 'offline');
  });
});

describe('buildControllerSwitcher(): a failed or absent cloud list', () => {
  test('no list asked for: no cloud entry, status none; the local entry usable', () => {
    const model = buildControllerSwitcher(inputOf({ cloud: null }));
    assert.deepEqual(model.cloud, { kind: 'none' });
    assert.deepEqual(model.entries.map((entry) => [entry.key, entry.usable, entry.active]), [['local', true, true]]);
  });

  test('each failure is a status with its text (Settings-pointing for the credential problems); the local entry stays usable', () => {
    const cases: Array<[unknown, string, keyof Translations]> = [
      [{ success: false, error: 'rateLimited', diagnostic: 'rateLimited, errorCode -7132' }, 'rateLimited', 'cloudTestRateLimited'],
      [{ success: false, error: 'credentialInvalid', diagnostic: 'credentialInvalid, errorCode -52602' }, 'credentialExpired', 'cloudConnectCredentialExpired'],
      [{ success: false, error: 'credentialInvalid', diagnostic: 'credentialInvalid, errorCode -90106' }, 'credentialWrong', 'cloudConnectCredentialInvalid'],
      [{ success: false, error: 'notConfigured' }, 'notConfigured', 'cloudConnectNotConfigured'],
      [{ success: false, error: 'superseded' }, 'superseded', 'cloudListSuperseded'],
      [{ success: false, error: 'quotaExceeded', diagnostic: 'errorCode -90114' }, 'unknownError', 'cloudListFailed'],
      [{ success: false, error: 'timeout', diagnostic: 'timeout' }, 'timeout', 'cloudTestTimeout'],
      ['garbage', 'failed', 'cloudListFailed'],
    ];
    for (const [reply, display, textKey] of cases) {
      const model = buildControllerSwitcher(inputOf({ cloud: parseCloudAccessResult(reply) }));
      assert.equal(model.cloud.kind, 'failed', JSON.stringify(reply));
      if (model.cloud.kind !== 'failed') continue;
      assert.equal(model.cloud.display, display, JSON.stringify(reply));
      assert.equal(model.cloud.textKey, textKey, JSON.stringify(reply));
      assert.deepEqual(model.entries.map((entry) => [entry.key, entry.usable]), [['local', true]], JSON.stringify(reply));
    }
    const rate = buildControllerSwitcher(inputOf({ cloud: parseCloudAccessResult(cases[0][0]) }));
    assert.equal(rate.cloud.kind === 'failed' ? rate.cloud.detail : null, 'rateLimited, errorCode -7132');
  });

  test('a possibly incomplete list is shown with its flag', () => {
    assert.deepEqual(buildControllerSwitcher(inputOf({ cloud: listed(FOUR, true) })).cloud, { kind: 'listed', truncated: true });
  });
});

describe('cloudFallbackTarget(): "Connect through TP-Link cloud"', () => {
  const UNREACHABLE: ConnectionResult = { success: false, error: 'connectError', detail: 'No se pudo conectar al controlador: net::ERR_CONNECTION_REFUSED', unreachable: true };

  test('offered for an unreachable local controller whose omadacId a complete list shows online and usable', () => {
    assert.deepEqual(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(FOUR), localOmadacId: LOCAL_ID }), { kind: 'cloud', omadacId: LOCAL_ID });
    assert.equal(isLocalUnreachable(UNREACHABLE), true);
  });

  test('never for an unknown local omadacId, a certificate or credential failure, another failure, or a success', () => {
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(FOUR), localOmadacId: null }), null, 'never learned');
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(FOUR), localOmadacId: 'local' }), null);
    const others: unknown[] = [
      { success: false, error: 'certificateUntrusted', certificate: { host: 'h', fingerprint: 'f' }, trustNonce: 'n' },
      { success: false, error: 'certificateChanged', certificate: { host: 'h', fingerprint: 'f', pinnedFingerprint: 'p' } },
      { success: false, error: 'connectError', detail: 'Error de autenticación' },
      { success: false, error: 'connectError', detail: 'HTTP 503: Service Unavailable' },
      { success: false, error: 'configIncomplete' },
      { success: false, error: 'connectionSuperseded' },
      { success: true, sessionNonce: 'a'.repeat(32) },
      { success: false, error: 'connectError', detail: 'offline', unreachable: 'true' },
      null,
    ];
    for (const localResult of others) {
      assert.equal(cloudFallbackTarget({ localResult, cloud: listed(FOUR), localOmadacId: LOCAL_ID }), null, JSON.stringify(localResult));
    }
  });

  test('never when the duplicate is offline or unusable, missing, or the list failed or may be incomplete', () => {
    const offline = [controller(LOCAL_ID, 'Omada', 'offline'), controller(REMOTE_ID, 'Other')];
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(offline), localOmadacId: LOCAL_ID }), null, 'offline duplicate');
    const old = [controller(LOCAL_ID, 'Omada', 'versionTooOld')];
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(old), localOmadacId: LOCAL_ID }), null, 'below 6.3');
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(FOUR.slice(1)), localOmadacId: LOCAL_ID }), null, 'not listed');
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: listed(FOUR, true), localOmadacId: LOCAL_ID }), null, 'incomplete list: main would refuse');
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: parseCloudAccessResult({ success: false, error: 'rateLimited' }), localOmadacId: LOCAL_ID }), null);
    assert.equal(cloudFallbackTarget({ localResult: UNREACHABLE, cloud: null, localOmadacId: LOCAL_ID }), null);
  });

  test('localOmadacIdOf() reads it from a successful parsed reply only', () => {
    assert.equal(localOmadacIdOf(listed(FOUR)), LOCAL_ID);
    assert.equal(localOmadacIdOf({ ok: true, controllers: FOUR, truncated: false }), null);
    assert.equal(localOmadacIdOf(parseCloudAccessResult({ success: false, error: 'timeout' })), null);
    assert.equal(localOmadacIdOf(null), null);
  });
});

describe('isSwitcherBusy(): disabled while an operation owns the session', () => {
  test('a move, an AP-group, Wi-Fi network or binding write, a connect / switch, a disconnect, a save or a certificate reset', () => {
    assert.equal(isSwitcherBusy(IDLE), false);
    for (const flag of Object.keys(IDLE) as Array<keyof SwitcherActivity>) {
      assert.equal(isSwitcherBusy({ ...IDLE, [flag]: true }), true, flag);
    }
    // A data load or refresh does not disable it (the renderer state's other flags are ignored)
    assert.equal(isSwitcherBusy({ ...IDLE, isLoadingData: true } as SwitcherActivity), false);
    assert.equal(SWITCHER_TEXT.busy, 'controllerSwitcherBusy');
  });
});

describe('cloudConnectFailureKey(): the text of a refused cloud connect', () => {
  /**
   * A refused cloud connect with the given detail.
   * @param {string} detail - The code-first detail.
   * @returns {ConnectionResult} The result.
   */
  function refused(detail: string): ConnectionResult {
    return { success: false, error: 'connectError', detail };
  }

  test('-7132 (also inside a session failure), offline and an expired / deleted credential (-52602) have their texts', () => {
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('rateLimited', 'rateLimited, errorCode -7132'))), 'cloudTestRateLimited');
    assert.equal(cloudConnectFailureKey(refused(describeCloudSessionError('requestFailed', 'sites: apiError, errorCode -7132', 'rateLimited'))), 'cloudTestRateLimited');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('offline'))), 'cloudConnectOffline');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('credentialInvalid', 'credentialInvalid, errorCode -52602'))), 'cloudConnectCredentialExpired');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('credentialInvalid', 'credentialInvalid, errorCode -90112'))), 'cloudConnectCredentialExpired');
    assert.match(translations.en.cloudConnectCredentialExpired, /Settings → TP-Link cloud/);
    assert.match(translations.es.cloudConnectCredentialExpired, /Ajustes → Nube de TP-Link/);
    assert.match(translations.en.cloudTestRateLimited, /too many requests/);
    assert.match(translations.en.cloudConnectOffline, /offline/);
  });

  test('the other codes: a refused credential, none saved, an unknown controller, the session codes; anything else is null (generic text)', () => {
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('credentialInvalid', 'credentialInvalid, errorCode -90106'))), 'cloudConnectCredentialInvalid');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('tokenRejected'))), 'cloudConnectCredentialInvalid');
    assert.equal(cloudConnectFailureKey(refused(describeCloudSessionError('requestFailed', 'sites: invalidCredentials, HTTP 401', 'invalidCredentials'))), 'cloudConnectCredentialInvalid');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('notConfigured'))), 'cloudConnectNotConfigured');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('unknownController'))), 'cloudConnectUnknownController');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('versionTooOld'))), 'cloudSessionErrorVersionTooOld');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('versionUnknown'))), 'cloudSessionErrorVersionUnknown');
    assert.equal(cloudConnectFailureKey(refused(describeCloudSessionError('noSites', '', null))), 'cloudSessionErrorNoSites');
    assert.equal(cloudConnectFailureKey(refused(cloudRefusalDetail('listIncomplete', 'organization list incomplete'))), 'cloudSessionErrorListIncomplete');
    for (const detail of [cloudRefusalDetail('httpError', 'httpError, HTTP 503'), cloudRefusalDetail('cloudUnavailable'), 'HTTP 503: Service Unavailable', 'net::ERR_CONNECTION_REFUSED', '']) {
      assert.equal(cloudConnectFailureKey(refused(detail)), null, detail);
    }
    for (const other of [{ success: true }, { success: false, error: 'connectionSuperseded' }, { success: false, error: 'connectError' }, null, 'x']) {
      assert.equal(cloudConnectFailureKey(other), null, JSON.stringify(other));
    }
  });
});

describe('parseConnectionTarget(): main\'s current target, fail-closed', () => {
  test('"local" or an omadacId; anything else is null', () => {
    assert.deepEqual(parseConnectionTarget('local'), { kind: 'local' });
    assert.deepEqual(parseConnectionTarget(REMOTE_ID), { kind: 'cloud', omadacId: REMOTE_ID });
    for (const raw of [undefined, null, '', 'a b', 7, { kind: 'local' }, 'x'.repeat(65)]) {
      assert.equal(parseConnectionTarget(raw), null, JSON.stringify(raw));
    }
  });
});

describe('the switcher\'s texts (es and en)', () => {
  test('every key the model hands out exists, non-empty and different, in both languages', () => {
    const keys = new Set<keyof Translations>([
      ...Object.values(SWITCHER_TEXT),
      ...Object.values(SWITCHER_CLOUD_FAILURE_TEXT),
      'cloudConnectOffline', 'cloudConnectCredentialExpired', 'cloudConnectCredentialInvalid', 'cloudConnectNotConfigured', 'cloudConnectUnknownController',
      'apGroupUnknown', 'apGroupNotReported',
    ]);
    for (const key of keys) {
      assert.ok(translations.es[key].trim() !== '' && translations.en[key].trim() !== '', key);
      assert.notEqual(translations.es[key], translations.en[key], key);
    }
    assert.equal(translations.en.connectThroughCloud, 'Connect through TP-Link cloud');
    assert.equal(translations.es.connectThroughCloud, 'Conectar a través de la nube de TP-Link');
  });

  test('the four-organization fixture as main builds it: the stub\'s smoke account in another order sorts the same way', () => {
    const dtos = fourOrganizations.page.result.data.map((entry) => toCloudController(validateCloudOrganization(entry)));
    const model = buildControllerSwitcher({ localConfigured: false, localName: null, cloud: { ok: true, controllers: dtos, truncated: false }, localOmadacId: null, active: null });
    const names = model.entries.map((entry) => entry.name ?? '');
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })));
    assert.equal(model.entries.length, dtos.length);
  });
});
